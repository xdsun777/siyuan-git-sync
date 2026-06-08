/**
 * 思源 API 工具函数
 * 基于思源笔记的官方 API 封装
 */

import { fetchPost, fetchSyncPost, IWebSocketData } from "siyuan";
import { getMimeType } from "@/utils/file";

/**
 * 通用请求函数
 * @param url API 路径
 * @param data 请求数据
 * @returns 响应数据
 */
export async function request(url: string, data: any) {
    let response: IWebSocketData = await fetchSyncPost(url, data);
    let res = response.code === 0 ? response.data : null;
    return res;
}

/**
 * 获取文件内容（返回 Blob）
 * @param path 文件路径
 * @returns 文件 Blob 对象
 */
export const getFileBlob = async (path: string): Promise<Blob | null> => {
    const endpoint = '/api/file/getFile'
    let response = await fetch(endpoint, {
        method: 'POST',
        body: JSON.stringify({
            path: path
        })
    });
    if (!response.ok) {
        return null;
    }
    let data = await response.blob();
    return data;
};

/**
 * 写入文件
 * @param path 文件路径
 * @param isDir 是否为目录
 * @param file 文件内容
 * @returns 写入结果
 */
export async function putFile(path: string, isDir: boolean, file: any) {
    let form = new FormData();
    form.append('path', path);
    form.append('isDir', isDir.toString());
    form.append('modTime', Math.floor(Date.now() / 1000).toString());
    form.append('file', file);
    let url = '/api/file/putFile';
    return request(url, form);
}

/**
 * 读取目录
 * @param path 目录路径
 * @returns 目录内容
 */
export async function readDir(path: string): Promise<any> {
    let data = {
        path: path
    }
    let url = '/api/file/readDir';
    return request(url, data);
}

/**
 * 删除文件
 * @param path 文件路径
 * @returns 删除结果
 */
export async function removeFile(path: string) {
    let data = {
        path: path
    }
    let url = '/api/file/removeFile';
    return request(url, data);
}

/**
 * 获取文件
 * @param path 文件路径
 * @returns 文件内容
 */
export async function getFile(path: string): Promise<any> {
    let data = {
        path: path
    }
    let url = '/api/file/getFile';
    return new Promise((resolve, _) => {
        fetchPost(url, data, (content: any) => {
            resolve(content)
        });
    });
}

/**
 * 创建目录
 * @param dirPath 目录路径
 * @returns 创建结果
 */
export async function createDirectory(dirPath: string) {
    try {
        // 分割目录路径
        const dirs = dirPath.split('/').filter(dir => dir !== '');
        let currentPath = '';
        
        // 逐个创建目录
        for (const dir of dirs) {
            currentPath += `/${dir}`;
            try {
                // 检查目录是否存在
                await readDir(currentPath);
            } catch (error) {
                // 目录不存在，创建它

                // 使用putFile函数创建目录
                await putFile(currentPath, true, null);
            }
        }
    } catch (error) {
        console.error(`创建目录 ${dirPath} 失败:`, error);
        throw error;
    }
}

/**
 * 写入文件，自动创建父目录
 * @param relativePath 相对于 /data/ 的文件路径，如 "20240101-abc/file.md"
 * @param content 文件原始字节
 */
export async function writeFileWithDirs(relativePath: string, content: Uint8Array): Promise<boolean> {
    try {
        const localFilePath = `/data/${relativePath}`;

        // 确保父目录存在
        const dirPath = localFilePath.substring(0, localFilePath.lastIndexOf('/'));
        try {
            await readDir(dirPath);
        } catch {
            await createDirectory(dirPath);
        }

        const mimeType = getMimeType(relativePath);
        const blob = new Blob([content as BlobPart], { type: mimeType });
        await putFile(localFilePath, false, blob);
        return true;
    } catch (error) {
        console.error(`写入文件 ${relativePath} 失败:`, error);
        return false;
    }
}