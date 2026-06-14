/**
 * 将编译产物安装到思源插件目录
 * @Description  复制 dist 目录到思源插件目录
 */

import fs from 'fs';
import { log, error, getSiYuanDir, chooseTarget, copyDirectory, getThisPluginName } from './utils.js';

let targetDir = '';

/**
 * 1. 获取插件安装父目录
 */
log('>>> 尝试获取目标目录常量...');
if (targetDir === '') {
    log('>>> 目标目录为空，尝试自动获取思源工作空间...');
    let res = await getSiYuanDir();

    if (res === null || res === undefined || res.length === 0) {
        error('>>> 无法自动获取思源目录');
        process.exit(1);
    } else {
        targetDir = await chooseTarget(res);
    }
    log(`>>> 成功获取目标目录: ${targetDir}`);
}
if (!fs.existsSync(targetDir)) {
    error(`失败！插件目录不存在: "${targetDir}"`);
    error('请在 scripts/make_install.js 中设置插件目录');
    process.exit(1);
}

/**
 * 2. 构建输出目录 dist
 */
const distDir = `${process.cwd()}/dist`;
if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir);
}

/**
 * 3. 计算安装目标路径
 */
const name = getThisPluginName();
if (name === null) {
    process.exit(1);
}
const targetPath = `${targetDir}/${name}`;

/**
 * 4. 复制编译产物到插件目录
 */
copyDirectory(distDir, targetPath);
