import { showMessage } from "siyuan";
import { readDir, getFileBlob } from "@/utils/siyuan";
import { extractOwnerAndRepo, fetchRemoteTree, batchCommit, computeGitBlobSHA } from "@/utils/github";
import { RepoInfo, DialogElement, FileChange, SyncStats } from "@/types";
import PromiseLimitPool from "@/libs/promise-pool";

/** 并发上传数 */
const CONCURRENCY = 5;

/**
 * 执行同步操作（优化版）
 * 
 * 流程:
 *   1. 一次性获取远端全量文件 SHA
 *   2. 遍历本地文件，并行计算本地 Git blob SHA
 *   3. 本地 SHA vs 远端 SHA 对比，跳过未变更文件
 *   4. 将变更文件（新增/修改）+ 删除文件打包为一次 Git commit 推送
 */
export async function performSync(dialog: DialogElement): Promise<boolean> {
    const notesDir = (dialog.element.querySelector('#workspaceDir') as HTMLInputElement).value.trim();
    if (!notesDir) { showMessage('请先填写笔记目录'); return false; }

    try {
        // 解析配置
        const dirs = notesDir.split(',').map(d => d.trim()).filter(d => d !== '');

        const repositoryUrl = (dialog.element.querySelector('#repositoryUrl') as HTMLInputElement).value.trim();
        if (!repositoryUrl) { showMessage('请先填写 GitHub 仓库地址'); return false; }

        const repoInfo = extractOwnerAndRepo(repositoryUrl);
        if (!repoInfo) { showMessage('GitHub 仓库地址格式不正确'); return false; }

        const branch = (dialog.element.querySelector('#branch') as HTMLInputElement).value.trim() || 'main';
        const authToken = (dialog.element.querySelector('#authToken') as HTMLInputElement).value.trim();
        if (!authToken) { showMessage('请先填写 Personal Access Token'); return false; }

        const commitTemplate = (dialog.element.querySelector('#commitTemplate') as HTMLInputElement).value.trim() || "同步笔记更新：{{date}}";
        const commitMessage = commitTemplate.replace(/\{\{date\}\}/g, new Date().toLocaleString());

        // ──── 阶段 1: 获取远端全量文件 SHA（2 次 API）────
        showMessage('获取远端文件列表...');
        const remoteTree = await fetchRemoteTree(repoInfo.owner, repoInfo.repo, branch, authToken);
        if (!remoteTree) {
            showMessage('获取远端文件列表失败，请检查网络和配置');
            return false;
        }

        // ──── 阶段 2: 遍历本地目录，收集所有文件 ────
        const localFiles: Array<{ fullPath: string; relativePath: string }> = [];
        const allDirs = [...dirs, 'assets'];  // 始终包含 assets

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
            showMessage('本地没有文件可同步');
            return true;
        }

        // ──── 阶段 3: 并行计算 SHA，生成变更列表 ────
        showMessage(`对比 ${localFiles.length} 个文件...`);
        const stats: SyncStats = { total: localFiles.length, uploaded: 0, deleted: 0, skipped: 0, failed: 0 };

        const pool = new PromiseLimitPool<FileChange | null>(CONCURRENCY);

        for (const file of localFiles) {
            pool.add(async () => {
                try {
                    const blob = await getFileBlob(file.fullPath);
                    if (!blob) return null;

                    // 读取文件原始字节
                    const arrayBuffer = await blob.arrayBuffer();
                    const content = new Uint8Array(arrayBuffer);

                    // 计算本地 Git blob SHA
                    const localSha = await computeGitBlobSHA(content);
                    const remoteSha = remoteTree.files.get(file.relativePath);

                    // SHA 相同 → 跳过
                    if (remoteSha === localSha) {
                        stats.skipped++;
                        return null;
                    }

                    // 生成 base64（给 Git blob API 使用）
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
            // 仅处理用户配置目录范围内的文件，避免误删仓库中其他文件
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
            showMessage(`同步完成：${stats.skipped} 个文件未变更，无需推送`);
            return true;
        }

        // ──── 阶段 4: 批量提交 ────
        const success = await batchCommit(
            repoInfo.owner, repoInfo.repo, branch, authToken,
            changes, commitMessage,
            (msg) => showMessage(msg)
        );

        if (success) {
            const parts: string[] = [];
            if (stats.uploaded) parts.push(`上传 ${stats.uploaded}`);
            if (stats.deleted) parts.push(`删除 ${stats.deleted}`);
            if (stats.skipped) parts.push(`跳过 ${stats.skipped}`);
            if (stats.failed) parts.push(`失败 ${stats.failed}`);
            showMessage(`同步完成！${parts.join('，')}`);
            return true;
        } else {
            showMessage('推送失败，请检查网络和配置');
            return false;
        }

    } catch (error) {
        console.error('同步异常:', error);
        showMessage('同步失败');
        return false;
    }
}

/**
 * Blob → base64 (strip data URL prefix)
 */
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

/**
 * Git 同步逻辑钩子
 */
export function useGitSync() {
    return { performSync };
}
