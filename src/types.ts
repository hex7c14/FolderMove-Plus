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
  not_movable_reason: string | null;
  risk_level: "low" | "medium" | "high";
  risk_reason: string | null;
  source: "registry" | "program_files" | "user_dir";
}

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
  phase: string;
  current: number;
  total: number;
  message: string;
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
