import { Dialog, Plugin, showMessage } from "siyuan";
import { performSync } from "@/hooks/useGitSync";
import { performOverride } from "@/hooks/useOverrideLocal";
import { performPullUpdate } from "@/hooks/usePullUpdates";
import styles from "./GitConfigDialog.module.scss";


export class GitConfigDialog {
    /**
     * 显示 Git 同步配置弹窗
     */
    static showGitConfigDialog(plugin: Plugin) {
        const dialog = new Dialog({
            title: "Git 同步配置",
            content: `<div class="b3-dialog__content" style="padding: 20px;">
                <div class="fn__flex-column">
                    <div class="fn__flex-item" style="margin-bottom: 16px;">
                        <label style="display: block; margin-bottom: 8px; font-weight: 500;">GitHub 仓库地址 <span style="color: #ff4d4f;">*</span></label>
                        <input type="text" id="repositoryUrl" class="b3-text-field" placeholder="https://github.com/username/repo.git" style="width: 100%;" />
                        <div style="margin-top: 4px; font-size: 12px; color: #666;">填写你想同步的 GitHub 仓库 HTTPS 地址</div>
                    </div>
                    
                    <div class="fn__flex-item" style="margin-bottom: 16px;">
                        <label style="display: block; margin-bottom: 8px; font-weight: 500;">分支名称 <span style="color: #ff4d4f;">*</span></label>
                        <input type="text" id="branch" class="b3-text-field" placeholder="main" style="width: 100%;" />
                        <div style="margin-top: 4px; font-size: 12px; color: #666;">默认分支用于 push 操作</div>
                    </div>
                    
                    <div class="fn__flex-item" style="margin-bottom: 16px;">
                        <label style="display: block; margin-bottom: 8px; font-weight: 500;">Personal Access Token <span style="color: #ff4d4f;">*</span></label>
                        <input type="password" id="authToken" class="b3-text-field" style="width: 100%;" />
                        <div style="margin-top: 4px; font-size: 12px; color: #666;">用于认证 GitHub 权限，必须有 push 权限</div>
                    </div>
                    
                    <div class="fn__flex-item" style="margin-bottom: 16px;">
                        <label style="display: block; margin-bottom: 8px; font-weight: 500;">默认 Commit 信息模板 <span style="color: #ff4d4f;">*</span></label>
                        <input type="text" id="commitTemplate" class="b3-text-field" placeholder="同步笔记更新：{{date}}" style="width: 100%;" />
                        <div style="margin-top: 4px; font-size: 12px; color: #666;">可使用 {{date}} 占位符自动生成提交信息</div>
                    </div>
                    

                    
                    <div class="fn__flex-item" style="margin-bottom: 16px;">
                        <label style="display: block; margin-bottom: 8px; font-weight: 500;">笔记目录 <span style="color: #ff4d4f;">*</span></label>
                        <input type="text" id="workspaceDir" class="b3-text-field" placeholder="例如：20260101104218-ma2fdmz 或 20260101104218-ma2fdmz/subfolder" style="width: 100%;" />
                        <div style="margin-top: 4px; font-size: 12px; color: #666;">会自动添加 /data/ 前缀，多个笔记之间用英文逗号分隔，且会默认检查并提交 assets 文件夹。</div>
                    </div>
                    
                    <div class="fn__flex-item" style="margin-bottom: 16px;">
                        <label style="display: block; margin-bottom: 8px; font-weight: 500;">同步模式</label>
                        <select id="syncMode" class="b3-text-field" style="width: 100%;">
                            <option value="auto">自动同步</option>
                            <option value="manual">手动同步</option>
                        </select>
                        <div style="margin-top: 4px; font-size: 12px; color: #666;">选择插件的同步模式</div>
                    </div>
                    
                    <div class="fn__flex-item" style="margin-bottom: 16px;" id="autoSyncSection">
                        <label style="display: block; margin-bottom: 8px; font-weight: 500;">推送弹窗频率 <span style="color: #ff4d4f;">*</span></label>
                        <select id="pushFrequency" class="b3-text-field" style="width: 100%;">
                            <option value="high">密 — 显示推送进度</option>
                            <option value="medium">中 — 后台静默推送</option>
                            <option value="off">无 — 不自动推送</option>
                        </select>
                        <div style="margin-top: 4px; font-size: 12px; color: #666;">Ctrl+S 保存后 3 秒自动推送到远端</div>
                    </div>
                    
                    <div class="fn__flex-item" style="margin-bottom: 16px;">
                        <label style="display: flex; align-items: center; font-size: 14px;">
                            <input type="checkbox" id="autoCloseDialog" class="b3-checkbox" style="margin-right: 8px;" />
                            <span>点击同步或覆盖后自动关闭页面</span>
                        </label>
                        <div style="margin-top: 4px; font-size: 12px; color: #666;">勾选后，执行同步或覆盖操作完成后会自动关闭此配置页面</div>
                    </div>
                    
                    <div class="fn__flex-item" style="margin-top: 24px; text-align: right;">
                        <button id="saveConfig" class="b3-btn b3-btn--primary" style="margin-right: 8px;">保存配置</button>
                        <button id="manualSyncBtn" class="b3-btn" style="margin-right: 8px; display: none;">手动同步</button>
                        <button id="overrideLocalBtn" class="b3-btn" style="margin-right: 8px; display: none;">覆盖本地</button>
                        <button id="pullUpdateBtn" class="b3-btn" style="margin-right: 8px; display: none;">拉取更新</button>
                        <button id="cancelConfig" class="b3-btn">取消</button>
                    </div>
                </div>
            </div>`,
            width: window.innerWidth < 900 ? "92vw" : "800px",
            height: window.innerHeight < 900 ? "80vh" : "750px"
        });
        
        // 配置管理对象
        const configManager = {
            // 获取所有输入元素的引用
            elements: {
                repositoryUrl: dialog.element.querySelector('#repositoryUrl') as HTMLInputElement,
                branch: dialog.element.querySelector('#branch') as HTMLInputElement,
                authToken: dialog.element.querySelector('#authToken') as HTMLInputElement,
                commitTemplate: dialog.element.querySelector('#commitTemplate') as HTMLInputElement,
                workspaceDir: dialog.element.querySelector('#workspaceDir') as HTMLInputElement,
                syncMode: dialog.element.querySelector('#syncMode') as HTMLSelectElement,
                pushFrequency: dialog.element.querySelector('#pushFrequency') as HTMLSelectElement,
                autoCloseDialog: dialog.element.querySelector('#autoCloseDialog') as HTMLInputElement
            },
            
            // 获取当前配置
            getConfig() {
                return {
                    repositoryUrl: this.elements.repositoryUrl.value.trim(),
                    branch: this.elements.branch.value.trim(),
                    authToken: this.elements.authToken.value.trim(),
                    commitTemplate: this.elements.commitTemplate.value.trim(),
                    workspaceDir: this.elements.workspaceDir.value.trim(),
                    syncMode: this.elements.syncMode.value,
                    pushFrequency: this.elements.pushFrequency.value || 'medium',
                    autoCloseDialog: this.elements.autoCloseDialog.checked
                };
            },
            
            // 设置配置
            setConfig(config: any) {
                if (config.repositoryUrl) {
                    this.elements.repositoryUrl.value = config.repositoryUrl;
                }
                if (config.branch) {
                    this.elements.branch.value = config.branch;
                }
                if (config.authToken) {
                    this.elements.authToken.value = config.authToken;
                }
                if (config.commitTemplate) {
                    // 确保显示包含 {{date}} 占位符的版本
                    let commitTemplate = config.commitTemplate;
                    // 这里简单处理，始终使用默认模板格式
                    commitTemplate = "同步笔记更新：{{date}}";
                    this.elements.commitTemplate.value = commitTemplate;
                }
                if (config.workspaceDir) {
                    // 从保存的路径中移除 /data/ 前缀，显示原始的用户输入格式
                    let originalWorkspaceDir = config.workspaceDir;
                    // 移除 /data/ 前缀
                    originalWorkspaceDir = originalWorkspaceDir.replace(/^\/data\//, '');
                    this.elements.workspaceDir.value = originalWorkspaceDir;
                }
                if (config.syncMode) {
                    this.elements.syncMode.value = config.syncMode;
                }
                if (config.pushFrequency) {
                    this.elements.pushFrequency.value = config.pushFrequency;
                }
                if (config.autoCloseDialog !== undefined) {
                    this.elements.autoCloseDialog.checked = config.autoCloseDialog;
                }
            }
        };
        
        // 加载已保存的配置
        setTimeout(() => {
            const savedConfig = plugin.data.gitSyncConfig;
            if (savedConfig && savedConfig.gitConf) {
                configManager.setConfig(savedConfig.gitConf);
            }
            
            // 初始化同步模式显示
            updateSyncModeUI();
        }, 100);
        
        // 同步模式切换事件
        setTimeout(() => {
            const syncModeSelect = dialog.element.querySelector('#syncMode') as HTMLSelectElement;
            if (syncModeSelect) {
                syncModeSelect.addEventListener('change', function() {
                    const selectedMode = this.value;
                    if (selectedMode === 'auto') {
                        // 显示确认框
                        const confirmResult = confirm('自动同步模式提醒\n\n为避免笔记内容被覆盖、丢失或冲突，建议只在单台电脑上启用自动同步。\n\n如果您在家用电脑和工作电脑上都开启了自动同步，可能会导致同步冲突和数据丢失。\n\n确认您了解此风险并只在此台电脑上使用自动同步模式吗？');
                        
                        if (confirmResult) {
                            // 用户确认，执行更新
                            updateSyncModeUI();
                        } else {
                            // 用户取消，改回手动同步
                            this.value = 'manual';
                            updateSyncModeUI();
                        }
                    } else {
                        // 切换到手动同步，直接执行更新
                        updateSyncModeUI();
                    }
                });
            }
            
            // 手动同步按钮点击事件
            const manualSyncBtn = dialog.element.querySelector('#manualSyncBtn') as HTMLButtonElement;
            if (manualSyncBtn) {
                manualSyncBtn.addEventListener('click', async () => {
                    // 添加loading状态和禁用按钮
                    const originalText = manualSyncBtn.textContent;
                    manualSyncBtn.textContent = '同步中...';
                    manualSyncBtn.disabled = true;
                    manualSyncBtn.style.opacity = '0.7';
                    
                    // 获取笔记目录
                    const notesDir = configManager.elements.workspaceDir.value.trim();
                    
                    if (!notesDir) {
                        showMessage('请先填写笔记目录');
                        // 恢复按钮状态
                        manualSyncBtn.textContent = originalText;
                        manualSyncBtn.disabled = false;
                        manualSyncBtn.style.opacity = '1';
                        return;
                    }
                    
                    try {
                        // 执行同步（performSync 内部已显示结果详情）
                        await performSync(dialog);
                        
                        // 检查是否需要自动关闭页面
                        if (configManager.elements.autoCloseDialog.checked) {
                            dialog.destroy();
                        }
                    } catch (error) {
                        console.error('同步失败:', error);
                        showMessage('同步失败');
                    } finally {
                        // 恢复按钮状态
                        manualSyncBtn.textContent = originalText;
                        manualSyncBtn.disabled = false;
                        manualSyncBtn.style.opacity = '1';
                    }
                });
            }
            
            // 覆盖本地按钮点击事件
            const overrideLocalBtn = dialog.element.querySelector('#overrideLocalBtn') as HTMLButtonElement;
            if (overrideLocalBtn) {
                overrideLocalBtn.addEventListener('click', async () => {
                    const confirmResult = confirm('警告：覆盖本地操作会将本地文件完全替换为仓库中的版本，所有本地修改将会丢失。\n\n此操作不可逆，请确保您已备份重要数据。\n\n是否继续执行覆盖操作？');
                    if (!confirmResult) return;

                    const originalText = overrideLocalBtn.textContent;
                    overrideLocalBtn.textContent = '覆盖中...';
                    overrideLocalBtn.disabled = true;
                    overrideLocalBtn.style.opacity = '0.7';

                    try {
                        await performOverride(dialog);
                        if (configManager.elements.autoCloseDialog.checked) {
                            dialog.destroy();
                        }
                    } catch (error) {
                        console.error('覆盖本地失败:', error);
                        showMessage('覆盖本地失败');
                    } finally {
                        overrideLocalBtn.textContent = originalText;
                        overrideLocalBtn.disabled = false;
                        overrideLocalBtn.style.opacity = '1';
                    }
                });
            }
            
            // 拉取更新按钮点击事件
            const pullUpdateBtn = dialog.element.querySelector('#pullUpdateBtn') as HTMLButtonElement;
            if (pullUpdateBtn) {
                pullUpdateBtn.addEventListener('click', async () => {
                    const originalText = pullUpdateBtn.textContent;
                    pullUpdateBtn.textContent = '拉取中...';
                    pullUpdateBtn.disabled = true;
                    pullUpdateBtn.style.opacity = '0.7';

                    try {
                        await performPullUpdate(dialog);
                        if (configManager.elements.autoCloseDialog.checked) {
                            dialog.destroy();
                        }
                    } catch (error) {
                        console.error('拉取更新失败:', error);
                        showMessage('拉取更新失败');
                    } finally {
                        pullUpdateBtn.textContent = originalText;
                        pullUpdateBtn.disabled = false;
                        pullUpdateBtn.style.opacity = '1';
                    }
                });
            }


        }, 100);
        
        // 更新同步模式 UI
        function updateSyncModeUI() {
            const syncMode = configManager.elements.syncMode.value;
            const autoSyncSection = dialog.element.querySelector('#autoSyncSection') as HTMLElement;
            const manualSyncBtn = dialog.element.querySelector('#manualSyncBtn') as HTMLElement;
            const overrideLocalBtn = dialog.element.querySelector('#overrideLocalBtn') as HTMLElement;
            const pullUpdateBtn = dialog.element.querySelector('#pullUpdateBtn') as HTMLElement;
            
            if (syncMode === 'auto') {
                // 显示自动同步设置，隐藏手动操作的按钮
                autoSyncSection.style.display = 'block';
                manualSyncBtn.style.display = 'none';
                overrideLocalBtn.style.display = 'none';
                pullUpdateBtn.style.display = 'none';
            } else if (syncMode === 'manual') {
                // 隐藏自动同步设置，显示手动操作的按钮
                autoSyncSection.style.display = 'none';
                manualSyncBtn.style.display = 'inline-block';
                overrideLocalBtn.style.display = 'inline-block';
                pullUpdateBtn.style.display = 'inline-block';
            }
        }
        
        // 添加保存按钮点击事件
        setTimeout(() => {
            const saveButton = dialog.element.querySelector('#saveConfig');
            if (saveButton) {
                saveButton.addEventListener('click', async () => {
                    // 获取当前配置
                    const currentConfig = configManager.getConfig();
                    const { repositoryUrl, branch, authToken, commitTemplate, workspaceDir, syncMode, pushFrequency } = currentConfig;
                    
                    // 检查必填字段
                    const missingFields = [];
                    if (!repositoryUrl) missingFields.push('GitHub 仓库地址');
                    if (!branch) missingFields.push('分支名称');
                    if (!authToken) missingFields.push('Personal Access Token');
                    if (!commitTemplate) missingFields.push('默认 Commit 信息模板');
                    if (!workspaceDir) missingFields.push('工作空间目录');
                    
                    // 如果有必填字段未填写，显示提示信息
                    if (missingFields.length > 0) {
                        showMessage(`请填写以下必填字段：${missingFields.join('、')}`);
                        return;
                    }
                    
                    // 处理工作空间目录，添加 /data/ 前缀并处理斜杠
                    let processedWorkspaceDir = workspaceDir;
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
                    
                    // 始终使用包含 {{date}} 占位符的版本，确保不保存具体时间
                    const templateWithPlaceholder = commitTemplate || "同步笔记更新：{{date}}";
                    
                    // 处理 commitTemplate 中的 {{date}} 占位符，仅用于控制台输出
                    let processedCommitTemplate = templateWithPlaceholder;
                    const now = new Date();
                    const dateString = now.toLocaleString(); // 生成当前时间字符串
                    processedCommitTemplate = processedCommitTemplate.replace(/\{\{date\}\}/g, dateString); // 替换 {{date}} 占位符
                    
                    const config = {
                gitConf: {
                    repositoryUrl: repositoryUrl,
                    branch: branch,
                    authToken: authToken,
                    commitTemplate: templateWithPlaceholder,
                    workspaceDir: processedWorkspaceDir,
                    syncMode: syncMode,
                    pushFrequency: pushFrequency || 'medium',
                    autoCloseDialog: currentConfig.autoCloseDialog
                }
            };
                    
                    // 控制台输出时显示替换后的模板
                    const configForLog = {...config};
                    configForLog.gitConf.commitTemplate = processedCommitTemplate;

                    
                    // 保存配置到插件的数据对象
                    plugin.data.gitSyncConfig = config;
                    // 持久化保存数据
                    await plugin.saveData('gitSyncConfig', config);
                    
                    // 显示保存成功提示
                    showMessage('配置保存成功！');
                    
                    // 如果是自动同步模式，先推送一次再按频率启动定时器
                    if (syncMode === 'auto') {
                        showMessage("同步中...");
                        await performSync(dialog);

                        if (pushFrequency !== 'off') {
                            (plugin as any).startPushTimer(pushFrequency || 'medium');
                        }
                    } else {
                        (plugin as any).stopPushTimer();
                    }
                    
                    // 关闭弹窗
                    // dialog.destroy();
                });
            }
            
            // 添加取消按钮点击事件
            const cancelButton = dialog.element.querySelector('#cancelConfig');
            if (cancelButton) {
                cancelButton.addEventListener('click', () => {
                    dialog.destroy();
                });
            }
        }, 100);
    }
}