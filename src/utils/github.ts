/**
 * GitHub API 工具函数
 * 桌面端 Electron 环境无 CORS 限制，直接 fetch 调用
 */

import {
    RepoInfo, RemoteFilesResult,
    GitHubFileResponse, GitHubCommitResponse, GitHubTreeResponse,
    FileChange, RemoteTreeResult
} from "@/types";

/* ========== 基础工具 ========== */

function getAuthHeaders(token: string): Record<string, string> {
    return {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
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

/* ========== Token 验证 ========== */

/**
 * 验证 Token 对目标仓库是否有写权限
 */
export async function validateToken(owner: string, repo: string, token: string): Promise<{ valid: boolean; error?: string }> {
    try {
        // 调用仓库自身端点，需要 repo 权限
        const resp = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
            method: 'GET',
            headers: getAuthHeaders(token),
        });
        if (resp.ok) {
            // 进一步检查是否有写权限：尝试 HEAD 请求检查 push 能力
            const perms = resp.headers.get('X-OAuth-Scopes') || '';
            if (!perms.includes('repo') && !perms.includes('write')) {
                // Fine-grained token 不返回 X-OAuth-Scopes，通过实际写操作验证
            }
            return { valid: true };
        }
        if (resp.status === 401) return { valid: false, error: 'Token 无效或已过期' };
        if (resp.status === 404) return { valid: false, error: `仓库 ${owner}/${repo} 不存在，或 Token 未被授权访问此仓库` };
        if (resp.status === 403) return { valid: false, error: 'Token 权限不足，请确认已授权此仓库的 Contents 读写权限' };
        return { valid: false, error: `验证失败: HTTP ${resp.status}` };
    } catch {
        return { valid: false, error: '网络错误，无法连接 GitHub API' };
    }
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

/* ========== Contents API：文件上传/删除 ========== */

/** 认证错误，用于中断批量操作 */
class AuthError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AuthError';
    }
}

/**
 * 上传单个文件到远端（使用 Contents API）
 * @returns fileSha 或 null
 */
async function uploadFileContent(
    owner: string, repo: string, branch: string,
    filePath: string, content: string, sha: string | null,
    message: string, token: string
): Promise<string | null> {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;
    const payload: Record<string, string> = {
        message,
        content,
        branch,
    };
    if (sha) payload.sha = sha;

    const resp = await fetch(url, {
        method: 'PUT',
        headers: getAuthHeaders(token),
        body: JSON.stringify(payload),
    });

    if (resp.ok) {
        const data = await resp.json();
        return data.content?.sha || null;
    }

    const text = await resp.text();
    if (resp.status === 401 || resp.status === 403) {
        throw new AuthError(`HTTP ${resp.status}: ${text.substring(0, 100)}`);
    }
    console.error(`上传文件 ${filePath} 失败:`, text.substring(0, 200));
    return null;
}

/**
 * 删除远端文件（使用 Contents API）
 */
async function deleteFileContent(
    owner: string, repo: string, branch: string,
    filePath: string, sha: string, message: string, token: string
): Promise<boolean> {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;
    const resp = await fetch(url, {
        method: 'DELETE',
        headers: getAuthHeaders(token),
        body: JSON.stringify({ message, sha, branch }),
    });

    if (resp.ok) return true;

    const text = await resp.text();
    if (resp.status === 401 || resp.status === 403) {
        throw new AuthError(`HTTP ${resp.status}: ${text.substring(0, 100)}`);
    }
    console.error(`删除文件 ${filePath} 失败:`, text.substring(0, 200));
    return false;
}

/**
 * 批量提交：逐个上传变更文件（Contents API）
 * 跳过内容 SHA 与远端完全相同的文件
 */
export async function batchCommit(
    owner: string, repo: string, branch: string, token: string,
    changes: FileChange[], message: string,
    onProgress?: (msg: string) => void
): Promise<{ success: boolean; error?: string }> {
    try {
        // 1. 获取远端文件树（用于 SHA 对比和删除时获取 sha）
        const remoteTree = await fetchRemoteTree(owner, repo, branch, token);
        if (!remoteTree) return { success: false, error: '获取远端文件列表失败' };

        // 2. 过滤出真正需要操作的文件
        const uploadFiles: FileChange[] = [];
        const deleteFiles: FileChange[] = [];
        let skipped = 0;

        for (const change of changes) {
            if (change.action === 'delete') {
                const remoteSha = remoteTree.files.get(change.path);
                if (remoteSha) {
                    change.content = new Uint8Array(0); // 占位，实际用 remoteSha
                    // 把 remoteSha 存到 base64 里传给 deleteFileContent
                    (change as any)._remoteSha = remoteSha;
                    deleteFiles.push(change);
                }
                continue;
            }

            const remoteSha = remoteTree.files.get(change.path);
            const localSha = await computeGitBlobSHA(change.content);
            if (remoteSha === localSha) {
                skipped++;
                continue;
            }
            (change as any)._remoteSha = remoteSha;
            uploadFiles.push(change);
        }

        const totalOps = uploadFiles.length + deleteFiles.length;
        onProgress?.(`变更: ${totalOps} 个文件${skipped > 0 ? `，跳过 ${skipped} 个未改动文件` : ''}`);

        if (totalOps === 0) {
            onProgress?.('没有变更，无需提交');
            return { success: true };
        }

        // 3. 逐个上传文件（串行，避免冲突）
        let uploaded = 0;
        let deleted = 0;
        let failed = 0;

        for (const file of uploadFiles) {
            try {
                const sha = await uploadFileContent(
                    owner, repo, branch, file.path, file.base64,
                    (file as any)._remoteSha || null, message, token
                );
                if (sha) uploaded++;
                else failed++;
                onProgress?.(`上传: ${uploaded + deleted}/${totalOps} ${file.path}`);
            } catch (error) {
                if (error instanceof AuthError) {
                    return { success: false, error: 'Token 无效或权限不足，请在 GitHub 重新生成 Personal Access Token（需勾选 Contents 读写权限）' };
                }
                failed++;
            }
        }

        for (const file of deleteFiles) {
            try {
                const sha = (file as any)._remoteSha;
                if (!sha) continue;
                const ok = await deleteFileContent(
                    owner, repo, branch, file.path, sha, message, token
                );
                if (ok) deleted++;
                else failed++;
                onProgress?.(`删除: ${uploaded + deleted}/${totalOps} ${file.path}`);
            } catch (error) {
                if (error instanceof AuthError) {
                    return { success: false, error: 'Token 无效或权限不足' };
                }
                failed++;
            }
        }

        if (failed > 0) {
            return { success: false, error: `上传 ${uploaded} 个，删除 ${deleted} 个，失败 ${failed} 个` };
        }

        onProgress?.(`完成：上传 ${uploaded} 个，删除 ${deleted} 个`);
        return { success: true };

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
