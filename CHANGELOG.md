# Changelog

## v0.1.0 (2026-06-14)

### ⚡ 性能优化
- 重写同步逻辑，API 请求减少 90%+：一次性获取远端全量文件 SHA，本地计算 Git blob SHA 对比差异，跳过未变更文件
- 使用 Git Database API 批量提交（blob → tree → commit → update ref），一次推送替代逐文件 commit
- 5 并发并行上传/下载（PromiseLimitPool）

### ✨ 新功能
- 拉取远端更新：手动模式下可选择性地将远端变更拉取到本地，支持逐文件勾选
- 智能差异对比：本地计算 Git blob SHA，仅上传实际变更的文件
- 支持 `VITE_SIYUAN_WORKSPACE_PATH` 环境变量，开发时自动部署到插件目录
- 自动同步启动时先拉取远端更新，再启动推送
- 新增 `.env.example` 开发配置模板

### 🐛 修复
- 修复 `forwardProxy` 内核代理导致 API 调用失败，改为 `fetch()` 直连
- 修复文件读取仅支持 `.png` 图片的问题，统一使用 `FileReader` 处理所有文件类型
- 修复 `unescape()` 废弃函数调用的编码问题
- 修复 plugin.json `backends` 仅限 Windows 的问题，改为 `all`
- 修复 i18n 40+ 条键名不匹配和缺失翻译
- 修复 Window 类型声明三处重复定义
- 修复远端删除时误删非配置目录文件
- 修复自动同步 422 fast-forward 冲突
- 修复静默模式下同步/拉取失败无任何提示
- 修复手动同步成功后弹出两次重复消息

### 🔧 改进
- 中英文 README 重写（同步原理、开发指南、配置说明）
- scripts 脚本全部中文化
- GitConfigDialog 移除大量重复内联代码
- package.json 元信息修正（name/author/repository）
- 同步结果显示详细统计（上传/删除/跳过/失败）
- 清理模板残留死代码

### 📦 平台支持
- 兼容 Windows / macOS / Linux（backends: all）
- 无需安装 Git CLI

---

## v0.0.4

### 🐛 修复
- 修复 `forwardProxy` 导致所有 GitHub API 调用失败
- 修复 plugin.json `backends/windows` → `all`
- 修复 i18n 键名不匹配问题
- 修复图片处理仅支持 `.png` 的 bug
- 清理 GitConfigDialog 重复代码

### 🔧 改进
- 统一用 `FileReader` 处理所有文件类型
- 移除废弃的 `unescape()` 函数
- 补充 40+ 条中英文 i18n 翻译

---

## v0.0.3

### ✨ 新功能
- 自动同步模式
- 多目录同步（逗号分隔）
- 自定义 Commit 信息模板（支持 `{{date}}` 占位符）
- 操作完成自动关闭对话框选项
- 修复禁用插件后自动同步未停止

---

## v0.0.2

### ✨ 新功能
- 覆盖本地功能
- 配置持久化存储
- 卸载时清理配置数据
- 修复 topBar 插件名消失

---

## v0.0.1

### ✨ 首次发布
- 基础 GitHub 仓库同步
- 手动同步模式
- 配置对话框（仓库地址/Token/分支/目录）
