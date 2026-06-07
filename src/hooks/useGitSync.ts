import { showMessage } from "siyuan";
import { readDir, getFileBlob, putFile } from "@/utils/siyuan";
import { extractOwnerAndRepo, checkFileExistsInRemote, uploadFileToRemote, collectRemoteFiles, deleteRemoteFiles } from "@/utils/github";
import { RepoInfo, DialogElement, DirItem } from "@/types";

/**
 * 执行同步操作
 * @param dialog 对话框元素
 * @returns 是否同步成功
 */
export async function performSync(dialog: DialogElement): Promise<boolean> {
    
    // 获取笔记目录
    const notesDir = (dialog.element.querySelector('#workspaceDir') as HTMLInputElement).value.trim();
    
    if (!notesDir) {
        showMessage('请先填写笔记目录');
        return false;
    }
    
    try {
        // 分割多个目录（用英文逗号分隔）
        const dirs = notesDir.split(',').map((dir: string) => dir.trim()).filter((dir: string) => dir !== '');
        
        // 从输入框获取仓库地址
        const repositoryUrl = (dialog.element.querySelector('#repositoryUrl') as HTMLInputElement).value.trim();
        if (!repositoryUrl) {
            showMessage('请先填写 GitHub 仓库地址');
            return false;
        }
        
        // 从仓库地址中提取 owner 和 repo
        const repoInfo: RepoInfo | null = extractOwnerAndRepo(repositoryUrl);
        if (!repoInfo) {
            showMessage('GitHub 仓库地址格式不正确');
            return false;
        }
        
        // 从输入框获取分支名称
        const branch = (dialog.element.querySelector('#branch') as HTMLInputElement).value.trim() || 'main';
        
        // 从输入框获取认证 token
        const authToken = (dialog.element.querySelector('#authToken') as HTMLInputElement).value.trim();
        if (!authToken) {
            showMessage('请先填写 Personal Access Token');
            return false;
        }
        
        // 获取 commit 模板并处理
        function getCommitMessage() {
            const commitTemplate = (dialog.element.querySelector('#commitTemplate') as HTMLInputElement).value.trim() || "同步笔记更新：{{date}}";
            const now = new Date();
            const dateString = now.toLocaleString();
            return commitTemplate.replace(/\{\{date\}\}/g, dateString);
        }
        
        // 执行文件对比
        async function performFileComparison() {
            try {
                // 收集本地文件路径
                const localFiles = new Set<string>();
                
                // 遍历目录下的所有文件
                async function collectLocalFiles(dirPath: string) {
                    try {
                        const files = await readDir(dirPath);
                        
                        if (!files || !Array.isArray(files)) {
                            return;
                        }
                        
                        for (const item of files) {
                            const fullPath = `${dirPath}/${item.name}`;
                            if (item.type === 'dir' || item.isDir) {
                                // 递归遍历子目录
                                await collectLocalFiles(fullPath);
                            } else {
                                // 构建相对于工作空间根目录的路径
                                const relativePath = fullPath.replace(/^\/data\//, '');
                                localFiles.add(relativePath);
                            }
                        }
                    } catch (error) {
                        // 静默处理错误，不输出到控制台
                    }
                }
                
                // 收集本地文件
                for (const dir of dirs) {
                    // 处理目录路径，添加 /data/ 前缀并处理斜杠
                    let processedDir = dir;
                    // 移除首尾空格
                    processedDir = processedDir.trim();
                    // 移除首尾斜杠
                    processedDir = processedDir.replace(/^\/|\/$/g, '');
                    // 替换连续的斜杠为单个斜杠
                    processedDir = processedDir.replace(/\/+\//g, '/');
                    // 添加 /data/ 前缀
                    processedDir = `/data/${processedDir}`;
                    // 确保不以斜杠结尾
                    processedDir = processedDir.replace(/\/$/, '');
                    
                    // 收集本地文件
                    await collectLocalFiles(processedDir);
                }
                
                // 收集 /data/assets 目录下的文件
                await collectLocalFiles('/data/assets');
                
                // 收集远程文件
                const { remoteFiles, remoteFileShas } = await collectRemoteFiles(repoInfo.owner, repoInfo.repo, branch, authToken);
                
                // 找出远程存在但本地不存在的文件
                const remoteOnlyFiles: string[] = [];
                for (const file of remoteFiles) {
                    if (!localFiles.has(file)) {
                        remoteOnlyFiles.push(file);
                    }
                }
                
                // 删除远程文件
                await deleteRemoteFiles(repoInfo.owner, repoInfo.repo, branch, remoteOnlyFiles, remoteFileShas, authToken, getCommitMessage());
                
            } catch (error) {
                console.error('文件对比失败:', error);
                showMessage('文件对比失败');
            }
        }
        
        // 读取文件内容并转换为base64
        async function readFileContent(filePath: string): Promise<string | null> {
            try {
                // 使用思源的API读取文件内容
                const blob = await getFileBlob(filePath);
                if (!blob) {
                    console.error(`无法读取文件: ${filePath}`);
                    return null;
                }
                
                // 统一使用 FileReader 读取所有类型文件（文本和二进制），
                // 避免使用废弃的 unescape() 函数
                return new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => {
                        // 从Data URL中提取base64部分
                        const base64Data = (reader.result as string).split(',')[1];
                        resolve(base64Data);
                    };
                    reader.onerror = () => {
                        reject(new Error('读取文件失败'));
                    };
                    reader.readAsDataURL(blob);
                });
            } catch (error) {
                console.error(`读取文件 ${filePath} 失败:`, error);
                return null;
            }
        }
        
        // 遍历目录下的所有文件
        async function traverseDirectory(dirPath: string) {
            try {
                const files: DirItem[] = await readDir(dirPath);
                
                if (!files || !Array.isArray(files)) {
                    return;
                }
                
                for (const item of files) {
                    const fullPath = `${dirPath}/${item.name}`;
                    if (item.type === 'dir' || item.isDir) {
                        // 递归遍历子目录
                        await traverseDirectory(fullPath);
                    } else {
                        // 检查文件是否存在于远程仓库
                        // 构建相对于工作空间根目录的路径
                        const relativePath = fullPath.replace(/^\/data\//, '');
                        
                        const checkResult = await checkFileExistsInRemote(
                            repoInfo.owner,
                            repoInfo.repo,
                            branch,
                            relativePath,
                            authToken
                        );
                        
                        // 读取文件内容
                        const fileContent = await readFileContent(fullPath);
                        if (!fileContent) {
                            continue;
                        }
                        
                        // 上传文件到远程仓库
                        await uploadFileToRemote(
                            repoInfo.owner,
                            repoInfo.repo,
                            branch,
                            relativePath,
                            fileContent,
                            authToken,
                            checkResult.sha,
                            getCommitMessage()
                        );
                    }
                }
            } catch (error) {
                // 静默处理错误，不输出到控制台
            }
        }
        
        // 处理每个目录
        for (const dir of dirs) {
            // 处理目录路径，添加 /data/ 前缀并处理斜杠
            let processedDir = dir;
            // 移除首尾空格
            processedDir = processedDir.trim();
            // 移除首尾斜杠
            processedDir = processedDir.replace(/^\/|\/$/g, '');
            // 替换连续的斜杠为单个斜杠
            processedDir = processedDir.replace(/\/+\//g, '/');
            // 添加 /data/ 前缀
            processedDir = `/data/${processedDir}`;
            // 确保不以斜杠结尾
            processedDir = processedDir.replace(/\/$/, '');
            
            // 使用封装好的 readDir 函数获取目录信息
            await readDir(processedDir);
            
            // 开始遍历目录下的所有文件，检查是否存在于远程仓库
            await traverseDirectory(processedDir);
        }
        
        // 遍历 /data/assets 目录
        await traverseDirectory('/data/assets');
        
        // 执行文件对比
        await performFileComparison();
        
        return true;
    } catch (error) {
        // 静默处理错误，不输出到控制台
        
        // 如果 API 调用失败，尝试从路径中提取文件夹名称作为 fallback
        try {
            // 处理工作空间目录，添加 /data/ 前缀并处理斜杠
            let processedWorkspaceDir = notesDir;
            // 移除首尾空格
            processedWorkspaceDir = processedWorkspaceDir.trim();
            // 移除首尾斜杠
            processedWorkspaceDir = processedWorkspaceDir.replace(/^\/|\/$/g, '');
            // 替换连续的斜杠为单个斜杠
            processedWorkspaceDir = processedWorkspaceDir.replace(/\/+\//g, '/');
            // 添加 /data/ 前缀
            processedWorkspaceDir = `/data/${processedWorkspaceDir}`;
            // 确保不以斜杠结尾
            processedWorkspaceDir = processedWorkspaceDir.replace(/\/$/, '');
            
            const folderName = processedWorkspaceDir.split(/[\\/]/).pop();
            showMessage(`工作空间文件夹名称: ${folderName}`);
        } catch (fallbackError) {
            showMessage('获取工作空间目录信息失败');
        }
        
        return false;
    }
}

/**
 * Git 同步逻辑钩子
 */
export function useGitSync() {
    return {
        performSync
    };
}
