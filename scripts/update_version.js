/**
 * 交互式更新插件版本号
 * @Description  同步更新 plugin.json 和 package.json 中的版本号
 *               支持自动递增（主/次/补丁）或手动输入
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

/** 读取 JSON 文件 */
function readJsonFile(filePath) {
    return new Promise((resolve, reject) => {
        fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) return reject(err);
            try {
                const jsonData = JSON.parse(data);
                resolve(jsonData);
            } catch (e) {
                reject(e);
            }
        });
    });
}

/** 写入 JSON 文件 */
function writeJsonFile(filePath, jsonData) {
    return new Promise((resolve, reject) => {
        fs.writeFile(filePath, JSON.stringify(jsonData, null, 2), 'utf8', (err) => {
            if (err) return reject(err);
            resolve();
        });
    });
}

/** 命令行交互输入 */
function promptUser(query) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    return new Promise((resolve) => rl.question(query, (answer) => {
        rl.close();
        resolve(answer);
    }));
}

/** 解析版本字符串为 { major, minor, patch } */
function parseVersion(version) {
    const [major, minor, patch] = version.split('.').map(Number);
    return { major, minor, patch };
}

/** 按类型递增版本号 */
function incrementVersion(version, type) {
    let { major, minor, patch } = parseVersion(version);

    switch (type) {
        case 'major':
            major++;
            minor = 0;
            patch = 0;
            break;
        case 'minor':
            minor++;
            patch = 0;
            break;
        case 'patch':
            patch++;
            break;
        default:
            break;
    }

    return `${major}.${minor}.${patch}`;
}

// 主流程
(async function () {
    try {
        const pluginJsonPath = path.join(process.cwd(), 'plugin.json');
        const packageJsonPath = path.join(process.cwd(), 'package.json');

        // 读取两个 JSON 文件
        const pluginData = await readJsonFile(pluginJsonPath);
        const packageData = await readJsonFile(packageJsonPath);

        // 获取当前版本（假设两个文件版本一致）
        const currentVersion = pluginData.version || packageData.version;
        console.log(`\n🌟  当前版本: \x1b[36m${currentVersion}\x1b[0m\n`);

        // 计算各类型递增后的新版本
        const newPatchVersion = incrementVersion(currentVersion, 'patch');
        const newMinorVersion = incrementVersion(currentVersion, 'minor');
        const newMajorVersion = incrementVersion(currentVersion, 'major');

        // 显示选项
        console.log('🔄  请选择更新方式:\n');
        console.log(`   1️⃣  自动递增 \x1b[33m补丁版本\x1b[0m   (新版本: \x1b[32m${newPatchVersion}\x1b[0m)`);
        console.log(`   2️⃣  自动递增 \x1b[33m次版本\x1b[0m     (新版本: \x1b[32m${newMinorVersion}\x1b[0m)`);
        console.log(`   3️⃣  自动递增 \x1b[33m主版本\x1b[0m     (新版本: \x1b[32m${newMajorVersion}\x1b[0m)`);
        console.log(`   4️⃣  \x1b[33m手动输入\x1b[0m新版本号`);
        console.log('   0️⃣  跳过，不更新\n');

        const updateChoice = await promptUser('👉  请输入选项 (1/2/3/4/0): ');

        let newVersion;

        switch (updateChoice.trim()) {
            case '1':
                newVersion = newPatchVersion;
                break;
            case '2':
                newVersion = newMinorVersion;
                break;
            case '3':
                newVersion = newMajorVersion;
                break;
            case '4':
                newVersion = await promptUser('✍️  请输入新版本号 (格式 a.b.c): ');
                break;
            case '0':
                console.log('\n🛑  已跳过版本更新。');
                return;
            default:
                console.log('\n❌  无效选项，未执行更新。');
                return;
        }

        // 同步更新两个文件的版本号
        pluginData.version = newVersion;
        packageData.version = newVersion;

        // 写回文件
        await writeJsonFile(pluginJsonPath, pluginData);
        await writeJsonFile(packageJsonPath, packageData);

        console.log(`\n✅  版本已更新为: \x1b[32m${newVersion}\x1b[0m\n`);

    } catch (error) {
        console.error('❌  出错:', error);
    }
})();
