/**
 * 前后端约定的**消息码**总表。
 *
 * 后端（Rust）不再回传「拼好的中文句子」，而是回传
 * `{ code, params }`，前端用这里的 code 去语言包里取文案。
 * 这样切换语言时，历史错误、进度提示也会跟着变。
 *
 * 新增一个码时必须同步：
 *   1. 本文件（TypeScript 侧类型）
 *   2. `src-tauri/src/error.rs` 的 `AppError` / `AppErrorCode`
 *   3. 四份语言包的 `error` / `reason` / `progressMessage` 段
 *
 * 类型推导小工具：
 *   `ErrorCodeOf<"insufficientSpace">` → `"needed" | "available"`
 *   `MessageCodeOf<"copyingTo">`       → `"path"`
 */

/** 错误码 → 插值参数名 */
export interface ErrorCodeParams {
  pathNotFound: "path";
  pathEmpty: never;
  pathNotAbsolute: "path";
  sourceDriveUnknown: never;
  targetDriveUnknown: never;
  sameDrive: never;
  insufficientSpace: "needed" | "available";
  alreadyLinked: "path";
  copyFailed: "code" | "detail";
  verifyFailed: "size" | "expected";
  renameFailed: "detail";
  linkFailed: "detail";
  recordNotFound: "id";
  restoreNotLink: "path";
  cleanupFailed: "detail" | "path";
  targetEmpty: "path";
  windows: "detail";
  io: "detail";
  json: "detail";
  other: "detail";
  localAppDataMissing: never;
  pathMustBeAbsolute: "path";
  parentMustBeAbsolute: "path";
  oldPathMustBeAbsolute: "path";
  notAFolder: "path";
  noParentDir: "path";
  folderNameEmpty: never;
  newFolderNameEmpty: never;
  folderExists: "path";
  folderNameExists: "path";
}

/** 进度消息码 → 插值参数名 */
export interface ProgressMessageCodeParams {
  computingSize: never;
  copyingTo: "path";
  copying: never;
  copyingVerify: never;
  linking: never;
  cleaningOriginal: never;
  done: never;
  restoringTo: "path";
  cleaningTarget: never;
  restoreDone: never;
}

export type ErrorCode = keyof ErrorCodeParams;
export type ErrorCodeOf<C extends ErrorCode> = ErrorCodeParams[C];
export type ProgressMessageCode = keyof ProgressMessageCodeParams;
export type MessageCodeOf<C extends ProgressMessageCode> = ProgressMessageCodeParams[C];

/** 需要按键渲染的风险 / 不可移动原因码（`reason.*`） */
export const REASON_CODES = [
  "dirMissing",
  "dirInaccessible",
  "alreadyLinked",
  "alreadyJunction",
  "systemCritical",
  "driverOrRuntime",
  "systemInstallDir",
  "userDir",
  "normalDir",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

/**
 * 后端结构化错误。
 *
 * - 新版本后端：`{ code: "sameDrive", params: {} }`
 * - 旧版本 / 第三方插件：可能仍是字符串，此时前端原样展示系统消息
 */
export interface StructuredError {
  code: string;
  params?: Record<string, string | number> | null;
}

export interface ProgressMessagePayload {
  code: string;
  params?: Record<string, string | number> | null;
}

/** 判断一段文本是不是合法的原因码（后端可能回传未知码） */
export function isReasonCode(value: unknown): value is ReasonCode {
  return typeof value === "string" && (REASON_CODES as readonly string[]).includes(value);
}

/** 判断是不是已知的错误码 */
export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && value in ERROR_CODE_SET;
}

const ERROR_CODE_SET: Record<ErrorCode, true> = {
  pathNotFound: true,
  pathEmpty: true,
  pathNotAbsolute: true,
  sourceDriveUnknown: true,
  targetDriveUnknown: true,
  sameDrive: true,
  insufficientSpace: true,
  alreadyLinked: true,
  copyFailed: true,
  verifyFailed: true,
  renameFailed: true,
  linkFailed: true,
  recordNotFound: true,
  restoreNotLink: true,
  cleanupFailed: true,
  targetEmpty: true,
  windows: true,
  io: true,
  json: true,
  other: true,
  localAppDataMissing: true,
  pathMustBeAbsolute: true,
  parentMustBeAbsolute: true,
  oldPathMustBeAbsolute: true,
  notAFolder: true,
  noParentDir: true,
  folderNameEmpty: true,
  newFolderNameEmpty: true,
  folderExists: true,
  folderNameExists: true,
};

const PROGRESS_MESSAGE_CODE_SET: Record<ProgressMessageCode, true> = {
  computingSize: true,
  copyingTo: true,
  copying: true,
  copyingVerify: true,
  linking: true,
  cleaningOriginal: true,
  done: true,
  restoringTo: true,
  cleaningTarget: true,
  restoreDone: true,
};

export function isProgressMessageCode(value: unknown): value is ProgressMessageCode {
  return typeof value === "string" && value in PROGRESS_MESSAGE_CODE_SET;
}

/** 进度阶段（后端 `ProgressPayload.phase`），用于 `progress.phase.*` */
export const PROGRESS_PHASES = [
  "computing",
  "copying",
  "verifying",
  "linking",
  "cleaning",
  "done",
] as const;
export type ProgressPhase = (typeof PROGRESS_PHASES)[number];

export function isProgressPhase(value: unknown): value is ProgressPhase {
  return typeof value === "string" && (PROGRESS_PHASES as readonly string[]).includes(value);
}
