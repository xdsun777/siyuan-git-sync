import {
    Plugin,
    showMessage,
    getFrontend,
} from "siyuan";
import "./index.scss";

import { SettingUtils } from "./libs/setting-utils";
import { GitConfigDialog } from "@/components/GitConfigDialog";
import { performSyncFromConfig } from "@/hooks/useGitSync";
import { performPullUpdateFromConfig } from "@/hooks/usePullUpdates";
import { extractOwnerAndRepo } from "@/utils/github";

const STORAGE_NAME = "menu-config";

export default class GitSyncPlugin extends Plugin {

    private isMobile: boolean;
    private settingUtils: SettingUtils;
    /** Ctrl+S 防抖定时器 */
    private saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    /** 是否正在推送中 */
    private pushing = false;
    private onSaveBound = this.onSave.bind(this);

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

        // 监听 Ctrl+S，自动推送
        document.addEventListener('keydown', this.onSaveBound);

        // 如果已保存自动同步配置：先拉取远端，再启动推送定时器
        this.tryAutoSync();
    }

    async onunload() {
        console.log(this.i18n.banPlugin);
        document.removeEventListener('keydown', this.onSaveBound);
        if (this.saveDebounceTimer) clearTimeout(this.saveDebounceTimer);
        this.stopPushTimer();
    }

    // ======================== 自动同步 ========================

    /**
     * 自动同步入口：先拉取远端更新（冲突弹窗），再启动推送定时器
     */
    async tryAutoSync() {
        const config = this.data.gitSyncConfig?.gitConf;
        if (!config || config.syncMode !== 'auto') return;
        if (!config.repositoryUrl || !config.authToken || !config.workspaceDir) return;

        const repoInfo = extractOwnerAndRepo(config.repositoryUrl);
        if (!repoInfo) return;

        const dirs = config.workspaceDir
            .replace(/^\/data\//, '')
            .split(',')
            .map(d => d.trim())
            .filter(d => d !== '');

        // 先拉取远端更新到本地
        const frequency = config.pushFrequency || 'medium';
        showMessage('正在检查远端更新...');
        await performPullUpdateFromConfig({
            repoInfo,
            branch: config.branch,
            authToken: config.authToken,
            dirs,
            silent: frequency !== 'high',  // 仅「密」显示进度
        });

        // 启动推送定时器
        this.startPushTimer(frequency);
    }

    /**
     * 启动推送定时器
     * @param frequency 推送频率: high(60s/显示消息) | medium(5min/静默) | off(不推送)
     */
    startPushTimer(_frequency: string) {
        // 不再使用定时器，推送仅由 Ctrl+S 触发
    }

    /**
     * Ctrl+S 事件处理 — 防抖合并，3 秒内的连续保存只触发一次推送
     */
    private onSave(e: KeyboardEvent) {
        if (!(e.ctrlKey || e.metaKey) || e.key !== 's') return;
        const config = this.data.gitSyncConfig?.gitConf;
        if (!config || config.syncMode !== 'auto') return;

        // 重置防抖定时器
        if (this.saveDebounceTimer) {
            clearTimeout(this.saveDebounceTimer);
        }
        this.saveDebounceTimer = setTimeout(() => {
            this.saveDebounceTimer = null;
            if (this.pushing) return; // 已有推送在进行中，本次保存的变化会在下一次推送中包含
            this.pushing = true;
            const silent = (config.pushFrequency || 'medium') !== 'high';
            this.doPush(silent).finally(() => { this.pushing = false; });
        }, 3000);
    }

    /**
     * 执行推送
     */
    private async doPush(silent: boolean) {
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

            await performSyncFromConfig({
                repoInfo,
                branch: config.branch,
                authToken: config.authToken,
                commitTemplate: config.commitTemplate || "同步笔记更新：{{date}}",
                dirs,
                silent,
            });
        } catch (error) {
            console.error('推送失败:', error);
        }
    }

    /**
     * 停止推送定时器
     */
    stopPushTimer() {
        if (window.autoSyncTimer) {
            clearInterval(window.autoSyncTimer);
            window.autoSyncTimer = null;
        }
    }

    // ======================== 生命周期 ========================

    async uninstall() {
        try {
            await this.removeData('gitSyncConfig');
        } catch (error) {
            console.error('Error removing gitSyncConfig:', error);
            showMessage('Error removing gitSyncConfig:' + String(error));
        }
    }

    openSetting() {
        GitConfigDialog.showGitConfigDialog(this);
    }
}
