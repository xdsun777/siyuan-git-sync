import { Dialog, showMessage } from "siyuan";
import { readDir, getFileBlob, writeFileWithDirs } from "@/utils/siyuan";
import { extractOwnerAndRepo, fetchRemoteTree, downloadBlobBySha, computeGitBlobSHA, validateToken } from "@/utils/github";
import { RepoInfo, DialogElement } from "@/types";
import PromiseLimitPool from "@/libs/promise-pool";

/** 并发数 */
const CONCURRENCY = 5;

/** 待拉取文件项 */
export interface PullFileItem {
    path: string;
    sha: string;
    type: 'new' | 'modified';
}

/** 拉取配置（独立于 DOM） */
export interface PullConfigInput {
    repoInfo: RepoInfo;
    branch: string;
    authToken: string;
    dirs: string[];
    /** 安静模式，只显示冲突弹窗，不弹进度/结果消息 */
    silent?: boolean;
}

/**
 * 从配置对象执行拉取更新（不依赖 DOM）
 * 对比远端与本地，差异文件通过冲突弹窗让用户逐文件选择
 */
export async function performPullUpdateFromConfig(config: PullConfigInput): Promise<boolean> {
    const { repoInfo, branch, authToken, dirs, silent } = config;
    const msg = (text: string) => { if (!silent) showMessage(text); };
    const alert = (text: string) => showMessage(text);

    try {
        // ──── 阶段 0: 验证 Token ────
        const validation = await validateToken(authToken);
        if (!validation.valid) {
            alert(validation.error || 'Token 验证失败');
            return false;
        }

        // ──── 阶段 1: 获取远端文件树 ────
        msg('获取远端文件列表...');
        const remoteTree = await fetchRemoteTree(repoInfo.owner, repoInfo.repo, branch, authToken);
        if (!remoteTree) {
            alert('获取远端文件列表失败，请检查网络和配置');
            return false;
        }

        // ──── 阶段 2: 收集本地文件并计算 SHA ────
        const allDirs = [...dirs, 'assets'];
        const localFiles: Array<{ fullPath: string; relativePath: string }> = [];

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
            } catch { /* 目录可能不存在 */ }
        }

        for (const dir of allDirs) {
            let d = dir.trim().replace(/^\/|\/$/g, '').replace(/\/+\//g, '/');
            d = `/data/${d}`.replace(/\/$/, '');
            await collectFiles(d);
        }

        // ──── 阶段 3: 并行计算本地 SHA，对比差异 ────
        msg(`对比 ${localFiles.length} 个本地文件...`);
        const pullFiles: PullFileItem[] = [];
        const remoteInScope = new Set<string>();
        for (const [remotePath] of remoteTree.files) {
            for (const dir of allDirs) {
                if (remotePath === dir || remotePath.startsWith(dir + '/')) {
                    remoteInScope.add(remotePath);
                    break;
                }
            }
        }

        const localShaMap = new Map<string, string>();
        const pool = new PromiseLimitPool<{ path: string; sha: string } | null>(CONCURRENCY);
        for (const file of localFiles) {
            pool.add(async () => {
                try {
                    const blob = await getFileBlob(file.fullPath);
                    if (!blob) return null;
                    const arrayBuffer = await blob.arrayBuffer();
                    const content = new Uint8Array(arrayBuffer);
                    const sha = await computeGitBlobSHA(content);
                    return { path: file.relativePath, sha };
                } catch { return null; }
            });
        }
        const shaResults = await pool.awaitAll();
        for (const r of shaResults) {
            if (r) localShaMap.set(r.path, r.sha);
        }

        for (const remotePath of remoteInScope) {
            const remoteSha = remoteTree.files.get(remotePath)!;
            const localSha = localShaMap.get(remotePath);
            if (!localSha) {
                pullFiles.push({ path: remotePath, sha: remoteSha, type: 'new' });
            } else if (localSha !== remoteSha) {
                pullFiles.push({ path: remotePath, sha: remoteSha, type: 'modified' });
            }
        }

        if (pullFiles.length === 0) {
            msg('本地已是最新，无需更新');
            return true;
        }

        // ──── 阶段 4: 冲突选择弹窗 ────
        const selectedPaths = await showConflictDialog(pullFiles);
        if (selectedPaths === null || selectedPaths.length === 0) {
            msg(selectedPaths === null ? '已取消' : '未选择任何文件');
            return true;
        }

        const selectedSet = new Set(selectedPaths);
        const selectedFiles = pullFiles.filter(f => selectedSet.has(f.path));

        // ──── 阶段 5: 并行下载 ────
        msg(`下载 ${selectedFiles.length} 个文件...`);
        const downloadPool = new PromiseLimitPool<{ path: string; content: Uint8Array } | null>(CONCURRENCY);
        for (const file of selectedFiles) {
            downloadPool.add(async () => {
                const content = await downloadBlobBySha(repoInfo.owner, repoInfo.repo, file.sha, authToken);
                if (!content) { console.error(`下载失败: ${file.path}`); return null; }
                return { path: file.path, content };
            });
        }
        const downloadResults = await downloadPool.awaitAll();
        const downloadedFiles = downloadResults.filter((f): f is { path: string; content: Uint8Array } => f !== null);
        const downloadFailed = selectedFiles.length - downloadedFiles.length;

        if (downloadedFiles.length === 0) {
            alert('所有文件下载失败，请检查网络');
            return false;
        }

        // ──── 阶段 6: 并行写入本地 ────
        msg('写入本地文件...');
        let writeSuccess = 0, writeFailed = 0;
        const writePool = new PromiseLimitPool<boolean>(CONCURRENCY);
        for (const file of downloadedFiles) {
            writePool.add(async () => await writeFileWithDirs(file.path, file.content));
        }
        const writeResults = await writePool.awaitAll();
        for (const ok of writeResults) { if (ok) writeSuccess++; else writeFailed++; }

        const totalFailed = downloadFailed + writeFailed;
        msg(`拉取完成：成功 ${writeSuccess} 个${totalFailed > 0 ? `，失败 ${totalFailed} 个` : ''}`);
        return true;

    } catch (error) {
        console.error('拉取更新异常:', error);
        alert('拉取更新失败');
        return false;
    }
}

/**
 * 从对话框 DOM 读取配置后执行拉取更新
 */
export async function performPullUpdate(dialog: DialogElement): Promise<boolean> {
    const notesDir = (dialog.element.querySelector('#workspaceDir') as HTMLInputElement).value.trim();
    if (!notesDir) { showMessage('请先填写笔记目录'); return false; }

    const repositoryUrl = (dialog.element.querySelector('#repositoryUrl') as HTMLInputElement).value.trim();
    if (!repositoryUrl) { showMessage('请先填写 GitHub 仓库地址'); return false; }

    const repoInfo = extractOwnerAndRepo(repositoryUrl);
    if (!repoInfo) { showMessage('GitHub 仓库地址格式不正确'); return false; }

    const branch = (dialog.element.querySelector('#branch') as HTMLInputElement).value.trim() || 'main';
    const authToken = (dialog.element.querySelector('#authToken') as HTMLInputElement).value.trim();
    if (!authToken) { showMessage('请先填写 Personal Access Token'); return false; }

    const dirs = notesDir.split(',').map(d => d.trim()).filter(d => d !== '');

    return performPullUpdateFromConfig({ repoInfo, branch, authToken, dirs });
}

/**
 * 显示冲突选择弹窗
 * @returns 用户选中的文件路径数组，null 表示取消
 */
function showConflictDialog(files: PullFileItem[]): Promise<string[] | null> {
    return new Promise((resolve) => {
        const newCount = files.filter(f => f.type === 'new').length;
        const modifiedCount = files.filter(f => f.type === 'modified').length;

        const buildRow = (f: PullFileItem, index: number) => `
            <tr>
                <td style="padding: 4px 8px; text-align: center;">
                    <input type="checkbox" 
                           id="pull_file_${index}" 
                           class="b3-checkbox pull-file-checkbox" 
                           ${f.type === 'new' ? 'checked' : ''}
                           data-path="${escapeHtml(f.path)}" />
                </td>
                <td style="padding: 4px 8px; font-size: 13px;">
                    <label for="pull_file_${index}" style="cursor: pointer; word-break: break-all;">
                        ${escapeHtml(f.path)}
                    </label>
                </td>
                <td style="padding: 4px 8px; text-align: center; font-size: 12px;">
                    <span style="color: ${f.type === 'new' ? '#52c41a' : '#faad14'};">
                        ${f.type === 'new' ? '新增' : '修改'}
                    </span>
                </td>
            </tr>`;

        const dialog = new Dialog({
            title: `拉取远程更新 — ${files.length} 个文件 (${newCount} 新增, ${modifiedCount} 修改)`,
            content: `<div class="b3-dialog__content" style="padding: 16px;">
                <div style="margin-bottom: 12px; display: flex; gap: 8px; align-items: center;">
                    <button id="pullSelectAll" class="b3-btn b3-btn--text" style="font-size: 12px;">全选</button>
                    <button id="pullDeselectAll" class="b3-btn b3-btn--text" style="font-size: 12px;">取消全选</button>
                    <span style="flex: 1;"></span>
                    <span style="font-size: 12px; color: #888;">勾选需要拉取的文件</span>
                </div>
                <div style="max-height: 50vh; overflow-y: auto; border: 1px solid var(--b3-theme-surface-lighter); border-radius: 4px;">
                    <table style="width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr style="background: var(--b3-theme-surface);">
                                <th style="width: 40px; padding: 6px 8px; text-align: center; font-size: 12px;">选择</th>
                                <th style="padding: 6px 8px; text-align: left; font-size: 12px;">文件路径</th>
                                <th style="width: 50px; padding: 6px 8px; text-align: center; font-size: 12px;">状态</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${files.map((f, i) => buildRow(f, i)).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
            <div class="b3-dialog__action" style="padding: 12px 16px;">
                <button id="pullCancelBtn" class="b3-button b3-button--cancel">取消</button>
                <div class="fn__space"></div>
                <button id="pullConfirmBtn" class="b3-button b3-button--text">确认拉取</button>
            </div>`,
            width: window.innerWidth < 900 ? '92vw' : '700px',
            height: 'auto',
        });

        const getCheckboxes = () =>
            Array.from(dialog.element.querySelectorAll('.pull-file-checkbox')) as HTMLInputElement[];

        // 全选
        dialog.element.querySelector('#pullSelectAll')?.addEventListener('click', () => {
            getCheckboxes().forEach(cb => { cb.checked = true; });
        });

        // 取消全选
        dialog.element.querySelector('#pullDeselectAll')?.addEventListener('click', () => {
            getCheckboxes().forEach(cb => { cb.checked = false; });
        });

        // 确认
        dialog.element.querySelector('#pullConfirmBtn')?.addEventListener('click', () => {
            const selected = getCheckboxes()
                .filter(cb => cb.checked)
                .map(cb => cb.dataset.path!);
            dialog.destroy();
            resolve(selected);
        });

        // 取消
        dialog.element.querySelector('#pullCancelBtn')?.addEventListener('click', () => {
            dialog.destroy();
            resolve(null);
        });
    });
}

function escapeHtml(str: string): string {
    const map: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    };
    return str.replace(/[&<>"']/g, c => map[c]);
}

/**
 * 拉取更新功能钩子
 */
export function usePullUpdates() {
    return { performPullUpdate, performPullUpdateFromConfig };
}
