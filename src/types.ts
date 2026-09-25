export interface AppInfo {
  id: string;
  display_name: string;
  publisher: string | null;
  version: string | null;
  install_location: string;
  source_drive: string;
  estimated_size_bytes: number;
  install_date: string | null;
  icon: string | null;
  is_movable: boolean;
  is_already_linked: boolean;
  /**
   * 不可移动的**原因码**（不是句子），对应语言包 `reason.<code>`；
   * 后端回传未知码时前端原样展示，所以这里仍是 string。
   */
  not_movable_reason: string | null;
  /** 移动风险评级：low / medium / high */
  risk_level: RiskLevel;
  /** 风险评级说明，同样是**原因码**，对应 `reason.<code>` */
  risk_reason: string | null;
  source: "registry" | "program_files" | "user_dir";
}

/** 移动风险评级 */
export type RiskLevel = "low" | "medium" | "high";

export interface DriveInfo {
  letter: string;
  label: string | null;
  drive_type: string;
  total_bytes: number;
  free_bytes: number;
}

export interface MoveRequest {
  app_name: string;
  original_path: string;
  target_root: string;
}

export interface MoveRecord {
  id: string;
  app_name: string;
  original_path: string;
  new_path: string;
  moved_at: string;
  size_bytes: number;
  source_drive: string;
  target_drive: string;
}

export interface ProgressPayload {
  id: string;
  /** 阶段码：computing / copying / verifying / linking / cleaning / done */
  phase: string;
  current: number;
  total: number;
  /** 进度文案的**消息码**，对应语言包 `progressMessage.<code>` */
  messageCode: string;
  /** 消息码的插值参数 */
  messageParams: Record<string, string | number> | null;
}

/** 占用某目录的可执行进程 */
export interface ProcInfo {
  pid: number;
  name: string;
  exePath: string | null;
}

export interface KillResult {
  killed: number[];
  failed: { pid: number; reason: string }[];
}

/** 内嵌文件管理器的文件夹条目 */
export interface FolderEntry {
  /** 文件夹短名（如 "Program Files"） */
  name: string;
  /** 完整绝对路径 */
  path: string;
}
