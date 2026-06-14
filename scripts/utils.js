/**
 * 公共工具函数
 * @Description  日志输出、思源API交互、文件操作等工具函数
 */

import fs from 'fs';
import path from 'node:path';
import http from 'node:http';
import readline from 'node:readline';

/** 日志输出（青色） */
export const log = (info) => console.log(`\x1B[36m%s\x1B[0m`, info);
/** 错误输出（红色） */
export const error = (info) => console.log(`\x1B[31m%s\x1B[0m`, info);

/** HTTP POST 请求头 */
export const POST_HEADER = {
    "Content-Type": "application/json",
};

/**
 * 兼容旧版 Node.js 的 fetch 实现
 */
export async function myfetch(url, options) {
    return new Promise((resolve, reject) => {
        let req = http.request(url, options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                resolve({
                    ok: true,
                    status: res.statusCode,
                    json: () => JSON.parse(data)
                });
            });
        });
        req.on('error', (e) => {
            reject(e);
        });
        req.end();
    });
}

/**
 * 从思源端口 6806 获取所有工作空间列表
 * @returns {Promise<Object | null>}
 */
export async function getSiYuanDir() {
    let url = 'http://127.0.0.1:6806/api/system/getWorkspaces';
    let conf = {};
    try {
        let response = await myfetch(url, {
            method: 'POST',
            headers: POST_HEADER
        });
        if (response.ok) {
            conf = await response.json();
        } else {
            error(`\tHTTP 错误: ${response.status}`);
            return null;
        }
    } catch (e) {
        error(`\t错误: ${e}`);
        error("\t请确保思源笔记正在运行！");
        return null;
    }
    return conf?.data;
}

/**
 * 交互式选择目标工作空间
 * @param {{path: string}[]} workspaces
 * @returns {string} 选中的工作空间路径
 */
export async function chooseTarget(workspaces) {
    let count = workspaces.length;
    log(`>>> 找到 ${count} 个思源工作空间`);
    workspaces.forEach((workspace, i) => {
        log(`\t[${i}] ${workspace.path}`);
    });

    if (count === 1) {
        return `${workspaces[0].path}/data/plugins`;
    } else {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        let index = await new Promise((resolve) => {
            rl.question(`\t请选择工作空间 [0-${count - 1}]: `, (answer) => {
                resolve(answer);
            });
        });
        rl.close();
        return `${workspaces[index].path}/data/plugins`;
    }
}

/**
 * 比较两个路径是否相同
 * @param {string} path1
 * @param {string} path2
 * @returns {boolean}
 */
export function cmpPath(path1, path2) {
    path1 = path1.replace(/\\/g, '/');
    path2 = path2.replace(/\\/g, '/');
    if (path1[path1.length - 1] !== '/') {
        path1 += '/';
    }
    if (path2[path2.length - 1] !== '/') {
        path2 += '/';
    }
    return path1 === path2;
}

/**
 * 从 plugin.json 读取当前插件名称
 */
export function getThisPluginName() {
    if (!fs.existsSync('./plugin.json')) {
        process.chdir('../');
        if (!fs.existsSync('./plugin.json')) {
            error('失败！未找到 plugin.json');
            return null;
        }
    }

    const plugin = JSON.parse(fs.readFileSync('./plugin.json', 'utf8'));
    const name = plugin?.name;
    if (!name) {
        error('失败！请在 plugin.json 中设置插件名称');
        return null;
    }

    return name;
}

/**
 * 递归复制目录
 */
export function copyDirectory(srcDir, dstDir) {
    if (!fs.existsSync(dstDir)) {
        fs.mkdirSync(dstDir);
        log(`已创建目录 ${dstDir}`);
    }

    fs.readdirSync(srcDir, { withFileTypes: true }).forEach((file) => {
        const src = path.join(srcDir, file.name);
        const dst = path.join(dstDir, file.name);

        if (file.isDirectory()) {
            copyDirectory(src, dst);
        } else {
            fs.copyFileSync(src, dst);
            log(`已复制: ${src} --> ${dst}`);
        }
    });
    log(`全部文件复制完成！`);
}


/**
 * 创建符号链接
 * Go 1.23 不再支持 junction 类型，改用 dir 类型
 * 详见: https://github.com/siyuan-note/siyuan/issues/12399
 */
export function makeSymbolicLink(srcPath, targetPath) {
    if (!fs.existsSync(targetPath)) {
        fs.symlinkSync(srcPath, targetPath, 'dir');
        log(`完成！已创建符号链接 ${targetPath}`);
        return;
    }

    // 检查已存在的目标路径
    let isSymbol = fs.lstatSync(targetPath).isSymbolicLink();
    if (!isSymbol) {
        error(`失败！${targetPath} 已存在且不是符号链接`);
        return;
    }
    let existedPath = fs.readlinkSync(targetPath);
    if (cmpPath(existedPath, srcPath)) {
        log(`良好！${targetPath} 已链接到 ${srcPath}`);
    } else {
        error(`错误！已存在符号链接 ${targetPath}\n但指向的是 ${existedPath}`);
    }
}
