# SiYuan Git Sync 插件

[English](https://github.com/Ceysen/siyuan-git-sync/blob/main/README.md)

## 项目简介

SiYuan Git Sync 是一个专为[思源笔记](https://b3log.org/siyuan)设计的同步插件，支持将笔记自动或手动同步到 GitHub 仓库，实现版本控制和多设备同步。

## 功能特性

- **GitHub 仓库同步**：将笔记推送到指定 GitHub 仓库
- **智能差异对比**：本地计算 Git blob SHA，跳过未变更文件，大幅减少 API 请求
- **批量提交**：所有变更打包为一次 Git commit（基于 Git Database API）
- **自动/手动同步**：定时自动同步或手动触发
- **多目录支持**：同时同步多个笔记目录
- **覆盖本地**：用远程仓库版本覆盖本地文件
- **自定义提交信息**：支持 `{{date}}` 占位符模板
- **全平台国际化**：支持中英文，兼容 Windows / macOS / Linux

## 同步原理

插件使用 GitHub 的 **Git Database API** 实现高效批量操作：

1. **获取远端文件树** — 2 次 API 拿到所有远端文件及其 SHA 值
2. **本地并行计算 SHA** — 使用 `PromiseLimitPool` 5 并发遍历本地文件，通过 Web Crypto API 计算 Git blob SHA-1
3. **差异对比** — 本地 SHA 与远端 SHA 逐一比对，相同的跳过
4. **批量提交** — 变更文件上传为 blob，创建 tree → commit → 更新 ref，一次推送

*100 个文件其中 10 个变更：约 205 次 API → 约 13 次 API（减少 93%）*

## 安装方法

### 从集市安装

1. 打开思源笔记
2. 进入「集市」→「插件」
3. 搜索「Git Sync」并点击「安装」
4. 安装完成后点击「启用」

### 手动安装

1. 从 [GitHub Releases](https://github.com/Ceysen/siyuan-git-sync/releases) 下载最新 `package.zip`
2. 解压到 `{workspace}/data/plugins/`
3. 重启思源笔记
4. 进入「设置」→「插件」启用

## 使用指南

### 配置同步

点击顶部栏插件图标，填写：

| 配置项 | 说明 | 示例 |
|-------|------|------|
| GitHub 仓库地址 | 仓库 HTTPS 地址 | `https://github.com/user/repo.git` |
| 分支名称 | 目标分支 | `main` |
| Personal Access Token | 具有 `repo` 权限的令牌 | `ghp_xxx` |
| Commit 信息模板 | 支持 `{{date}}` 占位符 | `同步笔记更新：{{date}}` |
| 笔记目录 | 逗号分隔（自动加 `/data/` 前缀） | `20240101-abc` 或 `dir1,dir2` |
| 同步模式 | 自动或手动 | `manual` |
| 自动同步间隔 | 分钟（仅自动模式） | `30` |
| 自动关闭页面 | 操作完成后关闭对话框 | `false` |

点击「保存配置」。

### 手动同步

手动模式下，打开配置对话框点击「手动同步」。结果会显示 `上传/删除/跳过/失败` 统计。

### 覆盖本地

点击「覆盖本地」将远端所有文件覆盖到本地。**此操作不可逆**，请提前备份重要数据。

## 配置说明

### 必选

| 配置项 | 说明 |
|-------|------|
| GitHub 仓库地址 | HTTPS 仓库 URL |
| 分支名称 | 同步分支 |
| Personal Access Token | 需 `repo` 权限 |
| Commit 信息模板 | 支持 `{{date}}` |
| 笔记目录 | 逗号分隔，自动加 `/data/` 前缀 |

### 可选

| 配置项 | 说明 | 默认值 |
|-------|------|--------|
| 同步模式 | `auto` 或 `manual` | `manual` |
| 自动同步间隔 | 分钟（≥1） | — |
| 自动关闭页面 | 操作后关闭对话框 | `false` |

## 注意事项

1. **PAT 令牌**：在 GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens 创建，授予 **Contents: Read and write**。
2. **自动同步**：建议只在单台电脑上启用，避免多设备冲突。
3. **覆盖本地**：不可逆操作，请提前备份。
4. **同步目录**：插件自动添加 `/data/` 前缀，始终检查并同步 `assets` 目录。

## 常见问题

### 同步失败？

- 检查仓库地址和分支名
- 确认 Token 有效且有 push 权限
- 检查网络连接

### 自动同步不工作？

- 确认选择了「自动同步」
- 确认间隔 ≥ 1 分钟
- 保持思源笔记运行

### 覆盖后笔记丢失？

- 可从 GitHub 提交历史中恢复
- 操作前务必备份

## 开发指南

### 环境要求

- Node.js 18+
- pnpm 8+

### 本地开发

```bash
git clone https://github.com/Ceysen/siyuan-git-sync.git
cd siyuan-git-sync
pnpm install
```

### 快速开发（自动部署）

创建 `.env` 文件：

```env
VITE_SIYUAN_WORKSPACE_PATH=/path/to/your/siyuan/workspace
```

```bash
pnpm run dev    # 监听模式，自动部署到插件目录
```

### 手动开发

```bash
pnpm run make-link    # 创建符号链接到工作空间
pnpm run dev          # 监听模式
```

### 构建

```bash
pnpm run build        # 输出到 dist/，同时生成 package.zip
```

## 贡献指南

欢迎提交 Issue 和 PR。提交前请确保：

1. 代码符合项目风格
2. 运行 `pnpm run build` 无错误
3. 手动测试功能正常
4. 必要时更新文档

## 许可证

[MIT License](https://github.com/Ceysen/siyuan-git-sync/blob/main/LICENSE)

## 联系方式

- [GitHub 仓库](https://github.com/Ceysen/siyuan-git-sync)
- [问题反馈](https://github.com/Ceysen/siyuan-git-sync/issues)

---

**感谢使用 SiYuan Git Sync 插件！**
