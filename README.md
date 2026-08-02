<div align="center">

# FolderMove-Plus

**通过 NTFS Junction 把已安装软件「搬到」其他盘，给 C 盘真正减负。**

Rust + Tauri 2 + React 构建的 Windows 桌面工具，轻量、现代、对小白友好。

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-2.x-orange.svg)](https://tauri.app)
[![Rust](https://img.shields.io/badge/Rust-1.77+-red.svg)](https://www.rust-lang.org)
[![Windows](https://img.shields.io/badge/Platform-Windows%2010%2B-0078D4.svg)](https://www.microsoft.com/windows)

</div>

---

## 这是什么

Windows 用久了，C 盘越来越满——QQ、微信、Steam、各种开发工具默认全往 `C:\Program Files` 或 `C:\Users\xxx\AppData` 里塞。常规做法是卸了重装到 D 盘，麻烦且可能丢配置。

**FolderMove-Plus** 用 NTFS 文件系统的 **Junction（目录联接）** 特性：把软件真实文件搬到其他盘，原位置留下一个透明的「快捷入口」。对软件和系统来说**路径完全没变**，照常运行，但 C 盘空间被真正释放。

> 灵感来源于 macOS 下的软件迁移工具与 Windows 下的 FolderMove。

## 功能特性

- **一键扫描** — 与控制面板「程序和功能」同口径的软件列表，自动过滤系统组件 / 补丁 / 更新
- **仅扫 C 盘** — 工具目标是释放 C 盘空间，其他盘符的软件自动过滤
- **风险评级** — 按安装目录分高 / 中 / 低三档风险，高亮提示
- **残留进程处理** — 移动前自动检测占用目录的进程，用户确认后强制结束
- **移动记录** — 所有操作持久化记录，一键还原回原位置
- **暗色模式** — 支持跟随系统主题，明暗切换
- **管理员自提权** — 自动触发 UAC，操作 `Program Files` 目录无需手动右键
- **轻量产物** — Release 编译产物仅几 MB，无运行时依赖

## 技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 应用框架 | **Tauri 2.x** | 复用系统 WebView2，产物几 MB，对比 Electron 大幅瘦身 |
| 后端 | **Rust 1.77+** | 内存安全，直接调用 Win32 API |
| Win32 绑定 | `windows 0.58` crate | 微软官方 Rust 绑定 |
| 注册表 | `winreg 0.52` | 读取 Uninstall 键下的软件信息 |
| 文件移动 | `robocopy` + `FSCTL_SET_REPARSE_POINT` | 原生命令 + 原生文件系统特性 |
| 进程管理 | Win32 ToolHelp API | `CreateToolhelp32Snapshot` / `TerminateProcess` |
| 前端 | **React 18 + TypeScript 5** | 类型安全，组件化 |
| 样式 | **Tailwind CSS 3** | 原子化 CSS，`dark:` 前缀原生支持暗色模式 |
| 构建 | **Vite 5** | 秒级热更新 |
| 图标 | `lucide-react` | 现代图标库，tree-shaking |
| 序列化 | `serde` / `serde_json` | Rust ↔ JSON IPC 数据传输 |

## 工作原理

### NTFS Junction 是什么

NTFS 文件系统支持「重解析点 (Reparse Point)」，其中 **Junction** 是目录级别的链接：

```
原路径: C:\Program Files\App  ──Junction──▶  D:\FolderMove-Plus\App
```

- 对系统/软件而言，访问 `C:\Program Files\App` 时，NTFS 驱动透明地把请求重定向到 D 盘
- **零性能损耗**：是文件系统层重定向，不像快捷方式要多一层解析
- **路径完全不变**：注册表里的安装路径、快捷方式、依赖引用全部仍然有效

### 移动流程

1. `robocopy` 把目录完整复制到目标盘（保留权限 / 时间戳 / ACL）
2. 校验复制完整性
3. 原目录重命名为 `.bak` 备份
4. 在原位置创建 Junction 指向新位置（`FSCTL_SET_REPARSE_POINT`）
5. 校验 Junction 可用后删除 `.bak`，释放 C 盘空间
6. 全过程写入 manifest（JSON），支持一键还原

## 从源码构建

### 环境要求

- **Windows 10 1809+**（需要 WebView2 Runtime，Win11 自带）
- [Rust 1.77+](https://www.rust-lang.org/tools/install)
- [Node.js 18+](https://nodejs.org/)
- npm
- [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)（含 MSVC）

### 步骤

```bash
# 1. 克隆仓库
git clone https://github.com/你的用户名/FolderMove-Plus.git
cd FolderMove-Plus

# 2. 安装前端依赖
npm install

# 3. 开发模式（带热重载，需管理员权限）
npm tauri dev

# 4. 构建 release 版本（产物在 src-tauri/target/release/）
npm tauri build
```

构建产物：
- `src-tauri/target/release/foldermove-plus.exe` — 免安装可执行文件
- `src-tauri/target/release/bundle/msi/*.msi` — MSI 安装包
- `src-tauri/target/release/bundle/nsis/*.exe` — NSIS 安装包

## 使用说明

1. **以管理员身份运行**（程序会自动触发 UAC，同意即可）
2. 主界面自动扫描已安装的 C 盘软件
3. 选择要移动的软件，点击「移动」
4. 选择目标盘，确认后点击「移动」
5. 等待复制 / 创建链接完成
6. 在「已移动」标签页可查看历史记录，需要时一键还原

### 风险评级说明

| 等级 | 目录 / 类型 | 说明 |
|---|---|---|
| 🟢 低 | 用户目录（`AppData\Local`、`AppData\Roaming`） | 移动风险最低 |
| 🟡 中 | `C:\Program Files`、`ProgramData` | 需管理员权限，建议先退出软件 |
| 🔴 高 | 系统关键目录（`C:\Windows`、`WindowsApps` 等） | 移动后可能影响系统稳定性，谨慎操作 |
| 🔴 高 | 驱动 / 运行库（VC++ Redistributable、.NET Runtime、显卡驱动等） | 被系统或其他软件依赖，移动后易引发依赖方异常 |

## 项目结构

```
FolderMove-Plus/
├── src/                          # 前端源码（React + TS）
│   ├── components/               # UI 组件
│   ├── lib/                      # 工具库（API 封装、主题、格式化）
│   ├── App.tsx                   # 主应用
│   └── types.ts                  # 类型定义
├── src-tauri/                    # 后端源码（Rust）
│   ├── src/
│   │   ├── lib.rs                # Tauri 命令注册入口
│   │   ├── main.rs               # 程序入口，UAC 自提权
│   │   ├── scan.rs               # 注册表扫描
│   │   ├── disk.rs               # 磁盘枚举与空间查询
│   │   ├── junction.rs           # NTFS Junction 创建/检测/删除
│   │   ├── mover.rs              # 移动核心流程
│   │   ├── proc.rs               # 进程检测与结束
│   │   ├── manifest.rs           # 移动记录持久化
│   │   ├── icon.rs               # 图标提取
│   │   ├── models.rs             # 数据结构
│   │   └── error.rs              # 统一错误类型
│   ├── capabilities/             # Tauri 权限配置
│   └── Cargo.toml
├── public/Pic/                   # 静态资源（背景图、头像）
├── package.json
└── tailwind.config.js
```

## ⚠️ 风险提示

- 移动前请**完全退出**目标软件（包括托盘与后台进程），否则文件被占用会导致失败
- **高风险**评级项目涉及系统关键目录，移动后可能影响系统稳定性，请谨慎操作
- 重要数据建议**先备份**或创建系统还原点
- 虽然支持一键还原，但建议在移动前确认目标盘有足够空间且健康
- 本工具不对数据丢失负责，使用风险自负

## 贡献

欢迎提 Issue 反馈 bug 或建议新功能，也欢迎 PR。

## 协议

本项目基于 [**GNU General Public License v3.0**](LICENSE) 开源。

这意味着你可以：
- ✅ 自由使用、修改、分发
- ✅ 用于商业用途
- ❗ 但衍生项目**必须以 GPL-3.0 协议开源**
- ❗ 必须保留原始版权声明

## 致谢

- [Tauri](https://tauri.app) — 让 Rust + Web 写桌面应用变得优雅
- [FolderMove](https://github.com/forderfold/FolderMove) — 灵感来源之一
- 所有 Win32 API 的 Rust 绑定贡献者

---

<div align="center">

**作者**：0x7c14 · ACG & Tech

如果这个工具帮到了你，欢迎点个 ⭐

</div>
