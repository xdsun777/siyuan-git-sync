import { showMessage } from "siyuan";
import { readDir, putFile, createDirectory } from "@/utils/siyuan";
import { extractOwnerAndRepo, fetchRemoteTree, downloadBlobBySha } from "@/utils/github";
import { getMimeType } from "@/utils/file";
import { DialogElement } from "@/types";
import PromiseLimitPool from "@/libs/promise-pool";

/** 并发数 */
const CONCURRENCY = 5;

/**
 * 执行覆盖本地操作
 * 从远程仓库下载指定目录的文件，覆盖本地对应文件
 */
export async function performOverride(dialog: DialogElement): Promise<boolean> {
    // ──── 读取表单配置 ────
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

    try {
        // ──── 阶段 1: 获取远程文件树 ────
        showMessage('获取远程文件列表...');
        const remoteTree = await fetchRemoteTree(repoInfo.owner, repoInfo.repo, branch, authToken);
        if (!remoteTree) {
            showMessage('获取远程文件列表失败，请检查网络和配置');
            return false;
        }

        // ──── 阶段 2: 按用户目录过滤 ────
        const allDirs = [...dirs, 'assets'];
        const targetFiles: Array<{ path: string; sha: string }> = [];
        for (const [filePath, sha] of remoteTree.files) {
            for (const dir of allDirs) {
                if (filePath === dir || filePath.startsWith(dir + '/')) {
                    targetFiles.push({ path: filePath, sha });
                    break;
                }
            }
        }

        if (targetFiles.length === 0) {
            showMessage('远程仓库中没有匹配的文件，请检查目录配置');
            return true;
        }

        // ──── 阶段 3: 并行下载 ────
        showMessage(`下载 ${targetFiles.length} 个文件...`);
        const downloadPool = new PromiseLimitPool<{ path: string; content: Uint8Array } | null>(CONCURRENCY);

        for (const file of targetFiles) {
            downloadPool.add(async () => {
                const content = await downloadBlobBySha(repoInfo.owner, repoInfo.repo, file.sha, authToken);
                if (!content) {
                    console.error(`下载失败: ${file.path}`);
                    return null;
                }
                return { path: file.path, content };
            });
        }

        const downloadResults = await downloadPool.awaitAll();
        const downloadedFiles = downloadResults.filter(
            (f): f is { path: string; content: Uint8Array } => f !== null
        );
        const downloadFailed = targetFiles.length - downloadedFiles.length;

        if (downloadedFiles.length === 0) {
            showMessage('所有文件下载失败，请检查网络');
            return false;
        }

        // ──── 阶段 4: 并行写入本地 ────
        showMessage('写入本地文件...');
        let writeSuccess = 0;
        let writeFailed = 0;

        const writePool = new PromiseLimitPool<boolean>(CONCURRENCY);
        for (const file of downloadedFiles) {
            writePool.add(async () => {
                const ok = await writeLocalFile(file.path, file.content);
                return ok;
            });
        }

        const writeResults = await writePool.awaitAll();
        for (const ok of writeResults) {
            if (ok) writeSuccess++;
            else writeFailed++;
        }

        const totalFailed = downloadFailed + writeFailed;
        showMessage(`文件覆盖完成：成功 ${writeSuccess} 个${totalFailed > 0 ? `，失败 ${totalFailed} 个` : ''}`);
        return true;

    } catch (error) {
        console.error('覆盖本地异常:', error);
        showMessage('覆盖本地失败');
        return false;
    }
}

/**
 * 将文件内容写入思源本地文件系统
 */
async function writeLocalFile(filePath: string, content: Uint8Array): Promise<boolean> {
    try {
        const localFilePath = `/data/${filePath}`;

        // 确保父目录存在
        const dirPath = localFilePath.substring(0, localFilePath.lastIndexOf('/'));
        try {
            await readDir(dirPath);
        } catch {
            await createDirectory(dirPath);
        }

        const mimeType = getMimeType(filePath);
        const blob = new Blob([content as BlobPart], { type: mimeType });
        await putFile(localFilePath, false, blob);
        return true;
    } catch (error) {
        console.error(`写入文件 ${filePath} 失败:`, error);
        return false;
    }
}

/**
 * 覆盖本地功能钩子
 */
export function useOverrideLocal() {
    return { performOverride };
}
