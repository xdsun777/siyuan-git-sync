/**
 * GitHub API 工具函数
 * 通过浏览器原生 fetch 直连 GitHub API（桌面端 Electron 环境无 CORS 限制）
 */

import { RepoInfo, FileExistsResult, RemoteFilesResult, GitHubFileResponse, GitHubCommitResponse, GitHubTreeResponse } from "@/types";

/**
 * 从仓库地址提取 owner 和 repo
 * @param url GitHub 仓库地址
 * @returns 包含 owner 和 repo 的对象，失败返回 null
 */
export function extractOwnerAndRepo(url: string): RepoInfo | null {
    // 匹配 HTTPS 格式：https://github.com/owner/repo.git
    const match = url.match(/https:\/\/github\.com\/(.*?)\/(.*?)\.git$/);
    if (match) {
        return {
            owner: match[1],
            repo: match[2]
        };
    }
    return null;
}

/**
 * 获取标准的 GitHub API 请求头
 */
function getAuthHeaders(token: string): Record<string, string> {
    return {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
    };
}

/**
 * 检查文件是否存在于远程仓库
 */
export async function checkFileExistsInRemote(owner: string, repo: string, branch: string, filePath: string, token: string): Promise<FileExistsResult> {
    try {
        const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`;
        const response = await fetch(apiUrl, {
            method: 'GET',
            headers: getAuthHeaders(token),
        });

        if (response.status === 200) {
            const data = await response.json() as GitHubFileResponse;
            return {
                exists: true,
                sha: data.sha
            };
        } else if (response.status === 404) {
            return {
                exists: false,
                sha: null
            };
        } else {
            throw new Error(`API 请求失败: ${response.status} ${response.statusText}`);
        }
    } catch (error) {
        console.error(`检查文件 ${filePath} 失败:`, error);
        return {
            exists: false,
            sha: null
        };
    }
}

/**
 * 上传文件到远程仓库
 */
export async function uploadFileToRemote(owner: string, repo: string, branch: string, filePath: string, content: string, token: string, sha: string | null = null, commitMessage: string): Promise<boolean> {
    try {
        const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;

        const payload: any = {
            message: commitMessage,
            content: content,
            branch: branch
        };

        // 如果文件存在，添加 sha 参数
        if (sha) {
            payload.sha = sha;
        }

        const response = await fetch(apiUrl, {
            method: 'PUT',
            headers: getAuthHeaders(token),
            body: JSON.stringify(payload)
        });

        if (response.status === 201 || response.status === 200) {
            return true;
        } else {
            const errorData = await response.json();
            throw new Error(`上传文件失败: ${errorData.message || response.statusText}`);
        }
    } catch (error) {
        console.error(`上传文件 ${filePath} 失败:`, error);
        return false;
    }
}

/**
 * 收集远程仓库的文件列表
 */
export async function collectRemoteFiles(owner: string, repo: string, branch: string, token: string): Promise<RemoteFilesResult> {
    const remoteFiles = new Set<string>();
    const remoteFileShas = new Map<string, string>();

    try {
        // 获取分支的最新提交
        const commitApiUrl = `https://api.github.com/repos/${owner}/${repo}/commits/${branch}`;
        const commitResponse = await fetch(commitApiUrl, {
            method: 'GET',
            headers: getAuthHeaders(token),
        });

        if (!commitResponse.ok) {
            throw new Error(`获取最新提交失败: ${commitResponse.status} ${commitResponse.statusText}`);
        }

        const commitData = await commitResponse.json() as GitHubCommitResponse;
        const treeSha = commitData.sha;

        // 使用 Git Trees API 获取文件树
        const treeApiUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`;
        const treeResponse = await fetch(treeApiUrl, {
            method: 'GET',
            headers: getAuthHeaders(token),
        });

        if (!treeResponse.ok) {
            throw new Error(`获取文件树失败: ${treeResponse.status} ${treeResponse.statusText}`);
        }

        const treeData = await treeResponse.json() as GitHubTreeResponse;

        if (treeData.tree && Array.isArray(treeData.tree)) {
            for (const item of treeData.tree) {
                if (item.type === 'blob') {
                    remoteFiles.add(item.path);
                    remoteFileShas.set(item.path, item.sha);
                }
            }
        }
    } catch (error) {
        console.error('获取远程文件列表失败:', error);
    }

    return {
        remoteFiles,
        remoteFileShas
    };
}

/**
 * 删除远程仓库中的文件
 */
export async function deleteRemoteFiles(owner: string, repo: string, branch: string, filesToDelete: string[], remoteFileShas: Map<string, string>, token: string, commitMessage: string): Promise<void> {
    try {
        if (filesToDelete.length === 0) {
            return;
        }

        // 逐个删除文件
        for (const filePath of filesToDelete) {
            const fileSha = remoteFileShas.get(filePath);
            if (!fileSha) {
                continue;
            }

            const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;

            const response = await fetch(apiUrl, {
                method: 'DELETE',
                headers: getAuthHeaders(token),
                body: JSON.stringify({
                    message: commitMessage,
                    sha: fileSha,
                    branch: branch
                })
            });

            if (response.status !== 200) {
                const errorData = await response.json();
                console.error(`删除文件 ${filePath} 失败: ${errorData.message || response.statusText}`);
            }
        }

    } catch (error) {
        console.error('删除远程文件失败:', error);
    }
}

/**
 * 下载远程文件（返回原始字节）
 * @returns base64 解码后的原始字节数据
 */
export async function downloadRemoteFile(owner: string, repo: string, branch: string, filePath: string, token: string): Promise<Uint8Array | null> {
    try {
        const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`;
        const response = await fetch(apiUrl, {
            method: 'GET',
            headers: getAuthHeaders(token),
        });

        if (!response.ok) {
            throw new Error(`下载文件失败: ${response.status} ${response.statusText}`);
        }

        const fileData = await response.json() as GitHubFileResponse;
        if (!fileData.content) {
            throw new Error('文件内容为空');
        }

        // 解码 base64 内容为原始字节
        const binaryString = atob(fileData.content.replace(/\s/g, ''));
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
    } catch (error) {
        console.error(`下载文件 ${filePath} 失败:`, error);
        return null;
    }
}

/**
 * 下载远程文件并解码为文本
 * @returns UTF-8 解码后的文本内容
 */
export async function downloadRemoteFileAsText(owner: string, repo: string, branch: string, filePath: string, token: string): Promise<string | null> {
    const bytes = await downloadRemoteFile(owner, repo, branch, filePath, token);
    if (!bytes) return null;
    return new TextDecoder('utf-8').decode(bytes);
}
