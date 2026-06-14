import { showMessage } from "siyuan";
import { readDir, getFileBlob } from "@/utils/siyuan";
import { extractOwnerAndRepo, fetchRemoteTree, batchCommit, computeGitBlobSHA } from "@/utils/github";
import { RepoInfo, DialogElement, FileChange, SyncStats } from "@/types";
import PromiseLimitPool from "@/libs/promise-pool";

/** 并发上传数 */
const CONCURRENCY = 5;

/** 同步配置（独立于 DOM） */
export interface SyncConfigInput {
    repoInfo: RepoInfo;
    branch: string;
    authToken: string;
    commitTemplate: string;
    dirs: string[];
    /** 安静模式，不弹出消息 */
    silent?: boolean;
    /** 中断令牌，cancelled 变为 true 时停止推送 */
    cancelToken?: { cancelled: boolean };
}

/**
 * 从配置对象执行同步（不依赖 DOM）
 * 供自动同步定时器和手动同步共用
 */
export async function performSyncFromConfig(config: SyncConfigInput): Promise<boolean> {
    const { repoInfo, branch, authToken, commitTemplate, dirs, silent, cancelToken } = config;
    const msg = (text: string) => { if (!silent) showMessage(text); };
    /** 即使静默模式也显示——用于关键失败 */
    const alert = (text: string) => showMessage(text);
    const cancelled = () => cancelToken?.cancelled ?? false;

    try {
        const commitMessage = commitTemplate.replace(/\{\{date\}\}/g, new Date().toLocaleString());

        // ──── 阶段 1: 获取远端全量文件 SHA（2 次 API）────
        msg('获取远端文件列表...');
        const remoteTree = await fetchRemoteTree(repoInfo.owner, repoInfo.repo, branch, authToken);
        if (!remoteTree) {
            alert('获取远端文件列表失败，请检查网络和配置');
            return false;
        }
        if (cancelled()) { msg('推送已中断'); return false; }

        // ──── 阶段 2: 遍历本地目录，收集所有文件 ────
        const localFiles: Array<{ fullPath: string; relativePath: string }> = [];
        const allDirs = [...dirs, 'assets'];

        async function collectFiles(dirPath: string): Promise<void> {
            try {
                const items = await readDir(dirPath);
                if (!items || !Array.isArray(items)) return;
                for (const item of items) {
                    const fp = `${dirPath}/${item.name}`;
                    if (item.type === 'dir' || item.isDir) {
                        await collectFiles(fp);
                    } else {
                        localFiles.push({
                            fullPath: fp,
                            relativePath: fp.replace(/^\/data\//, ''),
                        });
                    }
                }
            } catch {
                // 目录可能不存在，静默跳过
            }
        }

        for (const dir of allDirs) {
            let d = dir.trim().replace(/^\/|\/$/g, '').replace(/\/+\//g, '/');
            d = `/data/${d}`.replace(/\/$/, '');
            await collectFiles(d);
        }

        if (localFiles.length === 0) {
            msg('本地没有文件可同步');
            return true;
        }
        if (cancelled()) { msg('推送已中断'); return false; }

        // ──── 阶段 3: 并行计算 SHA，生成变更列表 ────
        msg(`对比 ${localFiles.length} 个文件...`);
        const stats: SyncStats = { total: localFiles.length, uploaded: 0, deleted: 0, skipped: 0, failed: 0 };

        const pool = new PromiseLimitPool<FileChange | null>(CONCURRENCY);

        for (const file of localFiles) {
            pool.add(async () => {
                try {
                    const blob = await getFileBlob(file.fullPath);
                    if (!blob) return null;

                    const arrayBuffer = await blob.arrayBuffer();
                    const content = new Uint8Array(arrayBuffer);
                    const localSha = await computeGitBlobSHA(content);
                    const remoteSha = remoteTree.files.get(file.relativePath);

                    if (remoteSha === localSha) {
                        stats.skipped++;
                        return null;
                    }

                    const base64 = await blobToBase64(blob);
                    stats.uploaded++;
                    return {
                        path: file.relativePath,
                        content,
                        base64,
                        action: remoteSha ? 'update' as const : 'add' as const,
                    };
                } catch (error) {
                    console.error(`处理文件 ${file.relativePath} 失败:`, error);
                    stats.failed++;
                    return null;
                }
            });
        }

        const changeResults = await pool.awaitAll();
        const changes: FileChange[] = changeResults.filter((c): c is FileChange => c !== null);

        // ──── 阶段 3.5: 标记远端多余文件为删除 ────
        const localPaths = new Set(localFiles.map(f => f.relativePath));
        for (const [remotePath] of remoteTree.files) {
            const inScope = allDirs.some(dir => remotePath === dir || remotePath.startsWith(dir + '/'));
            if (!inScope) continue;
            if (!localPaths.has(remotePath)) {
                changes.push({
                    path: remotePath,
                    content: new Uint8Array(0),
                    base64: '',
                    action: 'delete' as const,
                });
                stats.deleted++;
            }
        }

        stats.total = changes.length;

        if (changes.length === 0) {
            msg(`同步完成：${stats.skipped} 个文件未变更，无需推送`);
            return true;
        }
        if (cancelled()) { msg('推送已中断'); return false; }

        // ──── 阶段 4: 批量提交 ────
        const success = await batchCommit(
            repoInfo.owner, repoInfo.repo, branch, authToken,
            changes, commitMessage,
            (text) => msg(text)
        );

        if (success) {
            const parts: string[] = [];
            if (stats.uploaded) parts.push(`上传 ${stats.uploaded}`);
            if (stats.deleted) parts.push(`删除 ${stats.deleted}`);
            if (stats.skipped) parts.push(`跳过 ${stats.skipped}`);
            if (stats.failed) parts.push(`失败 ${stats.failed}`);
            msg(`同步完成！${parts.join('，')}`);
            return true;
        } else {
            alert('推送失败，请检查网络和配置');
            return false;
        }

    } catch (error) {
        console.error('同步异常:', error);
        alert('同步失败');
        return false;
    }
}

/**
 * 从对话框 DOM 读取配置后执行同步
 */
export async function performSync(dialog: DialogElement): Promise<boolean> {
    const notesDir = (dialog.element.querySelector('#workspaceDir') as HTMLInputElement).value.trim();
    if (!notesDir) { showMessage('请先填写笔记目录'); return false; }

    const dirs = notesDir.split(',').map(d => d.trim()).filter(d => d !== '');

    const repositoryUrl = (dialog.element.querySelector('#repositoryUrl') as HTMLInputElement).value.trim();
    if (!repositoryUrl) { showMessage('请先填写 GitHub 仓库地址'); return false; }

    const repoInfo = extractOwnerAndRepo(repositoryUrl);
    if (!repoInfo) { showMessage('GitHub 仓库地址格式不正确'); return false; }

    const branch = (dialog.element.querySelector('#branch') as HTMLInputElement).value.trim() || 'main';
    const authToken = (dialog.element.querySelector('#authToken') as HTMLInputElement).value.trim();
    if (!authToken) { showMessage('请先填写 Personal Access Token'); return false; }

    const commitTemplate = (dialog.element.querySelector('#commitTemplate') as HTMLInputElement).value.trim() || "同步笔记更新：{{date}}";

    return performSyncFromConfig({ repoInfo, branch, authToken, commitTemplate, dirs });
}

/** Blob → base64 (strip data URL prefix) */
async function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const dataUrl = reader.result as string;
            resolve(dataUrl.split(',')[1]);
        };
        reader.onerror = () => reject(new Error('读取文件失败'));
        reader.readAsDataURL(blob);
    });
}

/** Git 同步逻辑钩子 */
export function useGitSync() {
    return { performSync, performSyncFromConfig };
}
