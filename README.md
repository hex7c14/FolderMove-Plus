# FolderMove-Plus

> 将已安装软件从C盘移动到其他盘

---

## 功能简介

Windows 用久了会出现众所周知的现象——很多软件默认都是安装在C盘的，不知不觉C盘就满了。
常规操作是卸载了重装到其他盘符，麻烦且痛苦

**FolderMove-Plus** 用 Windows 自带的 NTFS 「目录联接」特性：
把软件的真实文件搬到或其他盘，然后在 C 盘原位置留一个入口。
对软件和系统来说，路径完全没变——而且功能也毫无差异，但 C 盘空间就会很明显变多了。

## 特性

- 应用程序移动风险评级
- 移动软件前后台程序的扫描与一键终止
- 浅色暗色模式与i18n

## 如何使用

1. 打开软件（请授予管理员权限）
2. 从列表里选要搬的软件，点「移动」
3. 选目标盘和模式，等待即可

在「已移动」标签页能看到历史，随时可以还原。

## 编译与开发

准备物件：
- OS在Windows 10 1809 以上
- Rust 1.77+
- Node.js 18+
- Visual Studio 的 C++ 构建工具（MSVC）
- Webview2！！！

然后：

```bash
pnpm install
pnpm tauri dev      # 开发模式
pnpm tauri build    # 构建，产物在 src-tauri/target/release/
```

Release默认启用LTO + size opt，大小是很有看点的。

## 技术栈

- **Tauri 2 + Rust**：后端调用 Win32 API

## 最后

此类工具比较少，文件操作，请谨慎，
如果帮你腾了几十 GB C 盘空间，顺手点个 Star 谢谢喵~~

---
