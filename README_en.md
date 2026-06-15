# SiYuan Git Sync Plugin

[中文](https://github.com/xdsun777/siyuan-git-sync/blob/main/README_zh_CN.md)

## Project Introduction

SiYuan Git Sync is a plugin designed for [SiYuan Notes](https://b3log.org/siyuan), enabling automatic or manual synchronization of note content to GitHub repositories for version control and multi-device sync.

## Features

- **GitHub Sync**: Push note files to a specified GitHub repository
- **Smart Diff**: Computes local Git blob SHA to skip unchanged files, minimizing API calls
- **Batch Commit**: All changes packed into a single Git commit via Git Database API
- **Auto/Manual Sync**: Scheduled automatic sync or manual trigger
- **Multi-directory**: Sync multiple notebook directories simultaneously
- **Override Local**: Pull and replace local files with the remote repository version
- **Custom Commit Messages**: Template-based messages with `{{date}}` placeholder
- **i18n Support**: Full Chinese and English localization on all platforms (Windows / macOS / Linux)

## Sync Mechanism

The plugin uses GitHub's **Git Database API** for efficient batch operations:

1. **Fetch remote tree** — 2 API calls to get all remote file SHAs
2. **Local SHA computation** — Parallel scanning with `PromiseLimitPool` (5 concurrent), computing Git blob SHA-1 via Web Crypto API
3. **Diff & skip** — Compare local vs remote SHA; skip unchanged files
4. **Batch commit** — Upload changed files as blobs, create a single tree → commit → update ref

*100 files with 10 changes: ~205 API calls → ~13 API calls (-93%)*

## Installation

### From Marketplace

1. Open SiYuan Notes
2. Go to **Marketplace** → **Plugins**
3. Search "Git Sync" and click **Install**
4. Click **Enable** after installation

### Manual Installation

1. Download the latest `package.zip` from [GitHub Releases](https://github.com/xdsun777/siyuan-git-sync/releases)
2. Extract to `{workspace}/data/plugins/`
3. Restart SiYuan Notes
4. Go to **Settings** → **Plugins** to enable

## Usage

### Configure

Click the plugin icon on the top bar, fill in:

| Field | Description | Example |
|-------|-------------|---------|
| GitHub Repository URL | HTTPS URL of your repo | `https://github.com/user/repo.git` |
| Branch | Target branch | `main` |
| Personal Access Token | GitHub PAT with `repo` scope | `ghp_xxx` |
| Commit Template | Supports `{{date}}` | `Sync: {{date}}` |
| Notebook Directories | Comma-separated (auto-prefixed with `/data/`) | `20240101-abc` or `dir1,dir2` |
| Sync Mode | Auto or Manual | `manual` |
| Sync Interval | Minutes (auto mode only) | `30` |
| Auto-close Dialog | Close after sync/override | `false` |

Click **Save Config**.

### Manual Sync

In manual mode, open the config dialog and click **Manual Sync**. Results are reported as `uploaded / deleted / skipped / failed` counts.

### Override Local

Click **Override Local** to pull all remote files and replace your local copies. **This is irreversible** — back up important data first.

## Configuration Reference

### Required

| Item | Description |
|------|-------------|
| GitHub Repository URL | HTTPS repository URL |
| Branch | Branch to sync |
| Personal Access Token | Token with `repo` permission |
| Commit Template | Supports `{{date}}` placeholder |
| Notebook Directories | Comma-separated, `/data/` auto-prefixed |

### Optional

| Item | Description | Default |
|------|-------------|---------|
| Sync Mode | `auto` or `manual` | `manual` |
| Sync Interval | Minutes (auto only, ≥1) | — |
| Auto-close Dialog | Close page after operation | `false` |

## Important Notes

1. **PAT**: Create at GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens, grant **Contents: Read and write**.
2. **Auto Sync**: Enable only on a single machine to avoid conflicts.
3. **Override Local**: Irreversible — backup first.
4. **Directories**: The plugin auto-adds `/data/` prefix and always syncs the `assets` folder.

## FAQ

### Sync fails?

- Check repository URL and branch name
- Verify token is valid with push permission
- Check network connectivity

### Auto sync not working?

- Confirm mode is set to "Auto"
- Ensure interval ≥ 1 minute
- Keep SiYuan running

### Lost notes after override?

- Recover from GitHub commit history
- Always backup before overriding

## Development

### Requirements

- Node.js 18+
- pnpm 8+

### Setup

```bash
git clone https://github.com/xdsun777/siyuan-git-sync.git
cd siyuan-git-sync
pnpm install
```

### Quick Dev (auto-deploy to workspace)

Create `.env` file:

```env
VITE_SIYUAN_WORKSPACE_PATH=/path/to/your/siyuan/workspace
```

```bash
pnpm run dev    # Watch mode, auto-deploy to plugins dir
```

### Manual Dev

```bash
pnpm run make-link    # Create symlink to workspace
pnpm run dev          # Watch mode
```

### Build

```bash
pnpm run build        # Output to dist/, generates package.zip
```

## Contributing

Issues and PRs welcome. Before submitting:

1. Follow the existing code style
2. Run `pnpm run build` and verify zero errors
3. Test functionality manually
4. Update docs if needed

## License

[MIT License](https://github.com/xdsun777/siyuan-git-sync/blob/main/LICENSE)

## Links

- [GitHub Repository](https://github.com/xdsun777/siyuan-git-sync)
- [Issue Tracker](https://github.com/xdsun777/siyuan-git-sync/issues)

---

**Thank you for using SiYuan Git Sync!**
