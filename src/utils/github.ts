/**
 * GitHub API 工具函数
 * 桌面端 Electron 环境无 CORS 限制，直接 fetch 调用
 */

import {
    RepoInfo, RemoteFilesResult,
    GitHubFileResponse, GitHubCommitResponse, GitHubTreeResponse,
    SyncStats, FileChange, RemoteTreeResult
} from "@/types";

/* ========== 基础工具 ========== */

function getAuthHeaders(token: string): Record<string, string> {
    return {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
    };
}

export function extractOwnerAndRepo(url: string): RepoInfo | null {
    const match = url.match(/https:\/\/github\.com\/(.*?)\/(.*?)\.git$/);
    if (match) return { owner: match[1], repo: match[2] };
    return null;
}

/**
 * 计算 Git blob SHA-1
 * Git blob 格式: "blob <字节数>\0<内容>"
 */
export async function computeGitBlobSHA(content: Uint8Array): Promise<string> {
    const header = new TextEncoder().encode(`blob ${content.length}\0`);
    const combined = new Uint8Array(header.length + content.length);
    combined.set(header);
    combined.set(content, header.length);

    const hashBuffer = await crypto.subtle.digest('SHA-1', combined);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ========== 远端仓库查询（一次性获取全量文件树） ========== */

/**
 * 获取分支最新提交信息及递归文件树
 * 返回: { commitSha, treeSha, files: Map<路径, sha>, truncated }
 */
export async function fetchRemoteTree(owner: string, repo: string, branch: string, token: string): Promise<RemoteTreeResult | null> {
    try {
        // 1. 获取分支最新 commit
        const commitUrl = `https://api.github.com/repos/${owner}/${repo}/commits/${branch}`;
        const commitResp = await fetch(commitUrl, { method: 'GET', headers: getAuthHeaders(token) });
        if (!commitResp.ok) throw new Error(`获取提交失败: ${commitResp.status}`);
        const commitData = await commitResp.json() as GitHubCommitResponse;

        // 2. 递归获取文件树
        const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${commitData.sha}?recursive=1`;
        const treeResp = await fetch(treeUrl, { method: 'GET', headers: getAuthHeaders(token) });
        if (!treeResp.ok) throw new Error(`获取文件树失败: ${treeResp.status}`);

        const treeData = await treeResp.json() as GitHubTreeResponse;
        const files = new Map<string, string>();
        if (treeData.tree) {
            for (const item of treeData.tree) {
                if (item.type === 'blob') {
                    files.set(item.path, item.sha);
                }
            }
        }

        return {
            commitSha: commitData.sha,
            treeSha: treeData.sha,
            files,
            truncated: treeData.truncated,
        };
    } catch (error) {
        console.error('获取远程文件树失败:', error);
        return null;
    }
}

/* ========== Git Database API：批量提交 ========== */

/** 认证错误，用于中断批量操作 */
class AuthError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AuthError';
    }
}

/**
 * 创建 Git blob 对象（上传文件内容）
 * 401/403 时抛出 AuthError 以中断整个批量提交
 */
async function createBlob(owner: string, repo: string, content: string, token: string): Promise<string> {
    const url = `https://api.github.com/repos/${owner}/${repo}/git/blobs`;
    const resp = await fetch(url, {
        method: 'POST',
        headers: getAuthHeaders(token),
        body: JSON.stringify({ content, encoding: 'base64' }),
    });
    if (!resp.ok) {
        const err = await resp.json().catch(() => ({ message: resp.statusText }));
        const msg = err.message || resp.statusText;
        if (resp.status === 401 || resp.status === 403) {
            throw new AuthError(msg);
        }
        throw new Error(msg);
    }
    const data = await resp.json();
    return data.sha;
}

/**
 * 创建 Git tree
 * @param treeItems 要新增/修改/删除的文件项
 *   - 新增/修改: { path, mode: '100644', type: 'blob', sha }
 *   - 删除:     { path, mode: '100644', type: 'blob', sha: null }
 */
async function createTree(owner: string, repo: string, baseTreeSha: string, treeItems: GitTreeItem[], token: string): Promise<string | null> {
    try {
        const url = `https://api.github.com/repos/${owner}/${repo}/git/trees`;
        const resp = await fetch(url, {
            method: 'POST',
            headers: getAuthHeaders(token),
            body: JSON.stringify({ base_tree: baseTreeSha, tree: treeItems }),
        });
        if (!resp.ok) {
            const err = await resp.json();
            throw new Error(err.message || resp.statusText);
        }
        const data = await resp.json();
        return data.sha;
    } catch (error) {
        console.error('创建 tree 失败:', error);
        return null;
    }
}

/**
 * 创建 commit
 */
async function createCommit(owner: string, repo: string, message: string, treeSha: string, parentSha: string, token: string): Promise<string | null> {
    try {
        const url = `https://api.github.com/repos/${owner}/${repo}/git/commits`;
        const resp = await fetch(url, {
            method: 'POST',
            headers: getAuthHeaders(token),
            body: JSON.stringify({ message, tree: treeSha, parents: [parentSha] }),
        });
        if (!resp.ok) {
            const err = await resp.json();
            throw new Error(err.message || resp.statusText);
        }
        const data = await resp.json();
        return data.sha;
    } catch (error) {
        console.error('创建 commit 失败:', error);
        return null;
    }
}

/**
 * 更新分支引用
 */
async function updateRef(owner: string, repo: string, branch: string, commitSha: string, token: string): Promise<boolean> {
    try {
        const url = `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`;
        const resp = await fetch(url, {
            method: 'PATCH',
            headers: getAuthHeaders(token),
            body: JSON.stringify({ sha: commitSha, force: true }),
        });
        if (!resp.ok) {
            const err = await resp.json();
            throw new Error(err.message || resp.statusText);
        }
        return true;
    } catch (error) {
        console.error('更新分支失败:', error);
        return false;
    }
}

/**
 * 批量提交：将变更一次性推送到远端
 * 遇到 fast-forward 冲突时自动重试一次
 * @returns { success: boolean, error?: string }
 */
export async function batchCommit(
    owner: string, repo: string, branch: string, token: string,
    changes: FileChange[], message: string,
    onProgress?: (msg: string) => void
): Promise<{ success: boolean; error?: string }> {
    try {
        // 1. 获取远端树
        const remoteTree = await fetchRemoteTree(owner, repo, branch, token);
        if (!remoteTree) return { success: false, error: '获取远端文件列表失败' };

        // 2. 构建 tree items（并行上传 blob）
        onProgress?.(`对比 ${changes.length} 个文件...`);
        const treeItems: GitTreeItem[] = [];
        try {
            const blobResults = await Promise.all(
                changes.map(async (change) => {
                    const remoteSha = remoteTree.files.get(change.path);
                    const localSha = await computeGitBlobSHA(change.content);

                    if (remoteSha === localSha && change.action !== 'delete') {
                        return null;
                    }

                    if (change.action === 'delete') {
                        return { path: change.path, mode: '100644', type: 'blob', sha: null } as GitTreeItem;
                    }

                    const blobSha = await createBlob(owner, repo, change.base64, token);
                    return {
                        path: change.path,
                        mode: change.mode || '100644',
                        type: 'blob',
                        sha: blobSha,
                    } as GitTreeItem;
                })
            );

            for (const item of blobResults) {
                if (item) treeItems.push(item);
            }
        } catch (error) {
            if (error instanceof AuthError) {
                return { success: false, error: 'Token 无效或权限不足，请在 GitHub 重新生成 Personal Access Token（需勾选 Contents 读写权限）' };
            }
            console.error('创建 blob 失败:', error);
            return { success: false, error: '上传文件失败，请检查网络' };
        }

        const skipped = changes.length - treeItems.length;
        onProgress?.(`变更: ${treeItems.length} 个文件${skipped > 0 ? `，跳过 ${skipped} 个未改动文件` : ''}`);

        if (treeItems.length === 0) {
            onProgress?.('没有变更，无需提交');
            return { success: true };
        }

        // 3. 创建 tree
        const newTreeSha = await createTree(owner, repo, remoteTree.treeSha, treeItems, token);
        if (!newTreeSha) return { success: false, error: '创建 tree 失败' };

        // 4. 创建 commit
        const newCommitSha = await createCommit(owner, repo, message, newTreeSha, remoteTree.commitSha, token);
        if (!newCommitSha) return { success: false, error: '创建 commit 失败' };

        // 5. 强制更新分支
        const ok = await updateRef(owner, repo, branch, newCommitSha, token);
        return ok ? { success: true } : { success: false, error: '更新分支引用失败' };

    } catch (error) {
        if (error instanceof AuthError) {
            return { success: false, error: 'Token 无效或权限不足' };
        }
        console.error('批量提交失败:', error);
        return { success: false, error: '批量提交失败' };
    }
}

/* ========== 覆写本地功能（保留兼容） ========== */

/** 收集远程文件（供覆盖本地使用） */
export async function collectRemoteFiles(owner: string, repo: string, branch: string, token: string): Promise<RemoteFilesResult> {
    const remoteFiles = new Set<string>();
    const remoteFileShas = new Map<string, string>();
    const remoteTree = await fetchRemoteTree(owner, repo, branch, token);
    if (remoteTree) {
        for (const [path, sha] of remoteTree.files) {
            remoteFiles.add(path);
            remoteFileShas.set(path, sha);
        }
    }
    return { remoteFiles, remoteFileShas };
}

/** 下载远程文件原始字节 */
export async function downloadRemoteFile(owner: string, repo: string, branch: string, filePath: string, token: string): Promise<Uint8Array | null> {
    try {
        const url = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`;
        const resp = await fetch(url, { method: 'GET', headers: getAuthHeaders(token) });
        if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
        const data = await resp.json() as GitHubFileResponse;
        if (!data.content) throw new Error('文件内容为空');
        const binary = atob(data.content.replace(/\s/g, ''));
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    } catch (error) {
        console.error(`下载文件 ${filePath} 失败:`, error);
        return null;
    }
}

/** 通过 blob SHA 直接下载文件内容（使用 Git Blob API，效率高于 Contents API） */
export async function downloadBlobBySha(owner: string, repo: string, sha: string, token: string): Promise<Uint8Array | null> {
    try {
        const url = `https://api.github.com/repos/${owner}/${repo}/git/blobs/${sha}`;
        const resp = await fetch(url, { method: 'GET', headers: getAuthHeaders(token) });
        if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
        const data = await resp.json();
        if (!data.content) throw new Error('blob 内容为空');
        const binary = atob(data.content.replace(/\s/g, ''));
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    } catch (error) {
        console.error(`下载 blob ${sha} 失败:`, error);
        return null;
    }
}

/** 下载远程文件文本 */
export async function downloadRemoteFileAsText(owner: string, repo: string, branch: string, filePath: string, token: string): Promise<string | null> {
    const bytes = await downloadRemoteFile(owner, repo, branch, filePath, token);
    return bytes ? new TextDecoder('utf-8').decode(bytes) : null;
}
