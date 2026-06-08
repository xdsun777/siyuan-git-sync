import {
    Plugin,
    showMessage,
    getFrontend,
} from "siyuan";
import "./index.scss";

import { SettingUtils } from "./libs/setting-utils";
import { GitConfigDialog } from "@/components/GitConfigDialog";
import { performSyncFromConfig } from "@/hooks/useGitSync";
import { extractOwnerAndRepo } from "@/utils/github";

const STORAGE_NAME = "menu-config";

export default class GitSyncPlugin extends Plugin {

    private isMobile: boolean;
    private settingUtils: SettingUtils;

    async onload() {
        this.data[STORAGE_NAME] = { readonlyText: "Readonly" };

        // 加载已保存的 Git 同步配置
        try {
            const gitSyncConfig = await this.loadData('gitSyncConfig');
            if (gitSyncConfig) {
                this.data.gitSyncConfig = gitSyncConfig;
            }
        } catch (error) {
            console.error("Error loading gitSyncConfig:", error);
        }

        const frontEnd = getFrontend();
        this.isMobile = frontEnd === "mobile" || frontEnd === "browser-mobile";

        // 注册插件图标
        this.addIcons(`
<symbol id="iconGitSync" viewBox="0 0 32 32">
<path d="M16 2C8.268 2 2 8.268 2 16s6.268 14 14 14 14-6.268 14-14S23.732 2 16 2zm-4.5 14.5c0 0.828-0.672 1.5-1.5 1.5s-1.5-0.672-1.5-1.5 0.672-1.5 1.5-1.5 1.5 0.672 1.5 1.5zm9 0c0 0.828-0.672 1.5-1.5 1.5s-1.5-0.672-1.5-1.5 0.672-1.5 1.5-1.5 1.5 0.672 1.5 1.5zm-4.5-9c1.93 0 3.5 1.57 3.5 3.5s-1.57 3.5-3.5 3.5-3.5-1.57-3.5-3.5 1.57-3.5 3.5-3.5z"></path>
<path d="M12.5 18.5c-0.276 0-0.5-0.224-0.5-0.5s0.224-0.5 0.5-0.5 0.5 0.224 0.5 0.5-0.224 0.5-0.5 0.5zm6 0c-0.276 0-0.5-0.224-0.5-0.5s0.224-0.5 0.5-0.5 0.5 0.224 0.5 0.5-0.224 0.5-0.5 0.5zm-3-5c-0.276 0-0.5-0.224-0.5-0.5s0.224-0.5 0.5-0.5 0.5 0.224 0.5 0.5-0.224 0.5-0.5 0.5z"></path>
</symbol>`);

        this.settingUtils = new SettingUtils({
            plugin: this, name: STORAGE_NAME
        });

        try {
            this.settingUtils.load();
        } catch (error) {
            console.error("Error loading settings storage, probably empty config json:", error);
        }

        console.log(this.i18n.usePlugin);
    }

    onLayoutReady() {
        this.addTopBar({
            icon: "iconGitSync",
            title: this.i18n.addTopBarIcon,
            position: "right",
            callback: () => {
                GitConfigDialog.showGitConfigDialog(this);
            }
        });

        this.settingUtils.load();

        // 如果已保存自动同步配置，启动定时器
        this.tryStartAutoSync();
    }

    async onunload() {
        console.log(this.i18n.banPlugin);
        this.stopAutoSync();
    }

    /**
     * 尝试从已保存配置启动自动同步
     */
    tryStartAutoSync() {
        const config = this.data.gitSyncConfig?.gitConf;
        if (!config || config.syncMode !== 'auto') return;
        if (!config.repositoryUrl || !config.authToken || !config.workspaceDir) return;

        const interval = config.syncInterval;
        if (!interval || interval <= 0) return;

        this.startAutoSync(interval);
    }

    /**
     * 启动自动同步定时器
     * 每次触发时从已保存配置读取最新设置
     */
    startAutoSync(intervalMinutes: number) {
        this.stopAutoSync();

        const ms = intervalMinutes * 60 * 1000;
        window.autoSyncTimer = setInterval(async () => {
            try {
                const config = this.data.gitSyncConfig?.gitConf;
                if (!config || config.syncMode !== 'auto') return;

                const repoInfo = extractOwnerAndRepo(config.repositoryUrl);
                if (!repoInfo) return;

                const dirs = config.workspaceDir
                    .replace(/^\/data\//, '')
                    .split(',')
                    .map(d => d.trim())
                    .filter(d => d !== '');

                showMessage("自动同步中");
                const success = await performSyncFromConfig({
                    repoInfo,
                    branch: config.branch,
                    authToken: config.authToken,
                    commitTemplate: config.commitTemplate || "同步笔记更新：{{date}}",
                    dirs,
                });
                if (success) showMessage('同步完成！');
            } catch (error) {
                console.error('自动同步失败:', error);
            }
        }, ms);
    }

    /**
     * 停止自动同步定时器
     */
    stopAutoSync() {
        if (window.autoSyncTimer) {
            clearInterval(window.autoSyncTimer);
            window.autoSyncTimer = null;
        }
    }

    async uninstall() {
        // 删除插件保存的配置文件
        try {
            await this.removeData('gitSyncConfig');
        } catch (error) {
            console.error('Error removing gitSyncConfig:', error);
            showMessage('Error removing gitSyncConfig:' + String(error));
        }
    }

    /**
     * 重写 openSetting 方法，显示自定义的 Git 配置对话框
     */
    openSetting() {
        GitConfigDialog.showGitConfigDialog(this);
    }
}
