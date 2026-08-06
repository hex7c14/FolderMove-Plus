import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AppInfo,
  DriveInfo,
  FolderEntry,
  KillResult,
  MoveRecord,
  MoveRequest,
  ProgressPayload,
  ProcInfo,
} from "../types";

export const api = {
  scanApps: () => invoke<AppInfo[]>("scan_apps"),
  listDrives: () => invoke<DriveInfo[]>("list_drives"),
  getDefaultTarget: (sourceDrive: string) =>
    invoke<string | null>("get_default_target", { sourceDrive }),
  computeSize: (path: string) => invoke<number>("compute_size", { path }),
  moveApp: (req: MoveRequest) => invoke<MoveRecord>("move_app", { req }),
  restoreApp: (id: string) => invoke<void>("restore_app", { id }),
  listMoved: () => invoke<MoveRecord[]>("list_moved"),
  /** 检测某目录下仍有进程占用的可执行文件 */
  checkProcesses: (path: string) =>
    invoke<ProcInfo[]>("check_processes", { path }),
  /** 结束指定 pid 的进程 */
  killProcesses: (pids: number[]) =>
    invoke<KillResult>("kill_processes", { pids }),
  /** 列出指定目录下的直接子文件夹（仅文件夹，跳过隐藏/系统目录） */
  listFolders: (dir: string) => invoke<FolderEntry[]>("list_folders", { dir }),
  /** 在 parent 目录下创建一个新文件夹，返回其完整路径 */
  createFolder: (parent: string, name: string) =>
    invoke<string>("create_folder", { parent, name }),
  /** 重命名文件夹（仅支持同目录改名，不跨目录移动） */
  renameFolder: (oldPath: string, newName: string) =>
    invoke<string>("rename_folder", { oldPath, newName }),
};

export function onProgress(cb: (p: ProgressPayload) => void): Promise<UnlistenFn> {
  return listen<ProgressPayload>("move-progress", (e) => cb(e.payload));
}
