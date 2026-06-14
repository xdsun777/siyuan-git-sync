/**
 * 创建开发环境符号链接
 * @Description  将 dev 目录链接到思源插件目录，方便开发调试
 */

import fs from 'fs';
import { log, error, getSiYuanDir, chooseTarget, getThisPluginName, makeSymbolicLink } from './utils.js';

let targetDir = '';

/**
 * 1. 获取插件安装父目录
 */
log('>>> 尝试获取目标目录常量...');
if (targetDir === '') {
    log('>>> 目标目录为空，尝试自动获取思源工作空间...');
    let res = await getSiYuanDir();

    if (!res || res.length === 0) {
        log('>>> 无法自动获取思源目录，尝试读取环境变量 SIYUAN_PLUGIN_DIR...');
        let env = process.env?.SIYUAN_PLUGIN_DIR;
        if (env) {
            targetDir = env;
            log(`\t从环境变量获取到目标目录: ${targetDir}`);
        } else {
            error('\t无法从环境变量获取思源目录，退出！');
            process.exit(1);
        }
    } else {
        targetDir = await chooseTarget(res);
    }

    log(`>>> 成功获取目标目录: ${targetDir}`);
}
if (!fs.existsSync(targetDir)) {
    error(`失败！插件目录不存在: "${targetDir}"`);
    error('请在 scripts/make_dev_link.js 中设置插件目录');
    process.exit(1);
}

/**
 * 2. 开发输出目录（编译产物）
 */
const devDir = `${process.cwd()}/dev`;
if (!fs.existsSync(devDir)) {
    fs.mkdirSync(devDir);
}


/**
 * 3. 计算目标符号链接路径
 */
const name = getThisPluginName();
if (name === null) {
    process.exit(1);
}
const targetPath = `${targetDir}/${name}`;

/**
 * 4. 创建符号链接
 */
makeSymbolicLink(devDir, targetPath);
