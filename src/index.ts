import {
    Plugin,
    showMessage,
    getFrontend,
} from "siyuan";
import "./index.scss";

import { SettingUtils } from "./libs/setting-utils";
import { GitConfigDialog } from "@/components/GitConfigDialog";

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
    }

    async onunload() {
        console.log(this.i18n.banPlugin);
        // 清理自动同步定时器
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
