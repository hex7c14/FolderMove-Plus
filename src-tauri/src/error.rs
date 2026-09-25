//! 统一的错误类型与**消息码**模型。
//!
//! 后端不再回传「拼好的句子」，只回传「码 + 参数」：
//!
//! ```json
//! { "code": "insufficientSpace", "params": { "needed": 1073741824, "available": 536870912 } }
//! ```
//!
//! 前端拿 `code` 去当前语言包里取文案（`error.insufficientSpace`），
//! 因此切换界面语言时，历史错误信息也会跟着翻译。
//! 新增码时必须同步 `src/i18n/codes.ts` 与四份语言包。

use serde::{Serialize, Serializer};

/// 结构化的进度消息：同样只传码 + 参数
#[derive(Debug, Clone)]
pub struct Message {
    pub code: &'static str,
    pub params: serde_json::Value,
}

impl Message {
    /// 无插值参数的消息
    pub fn plain(code: &'static str) -> Self {
        Self::with(code, serde_json::Value::Null)
    }

    /// 带插值参数的消息（参数名与语言包里的 `{{name}}` 一一对应）
    pub fn with(code: &'static str, params: serde_json::Value) -> Self {
        Self { code, params }
    }
}

/// 序列化成 `{ "code": "...", "params": { ... } }`（`params` 为空时省略）
impl Serialize for Message {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        #[derive(Serialize)]
        struct Wire<'a> {
            code: &'a str,
            #[serde(skip_serializing_if = "serde_json::Value::is_null")]
            params: &'a serde_json::Value,
        }

        Wire {
            code: self.code,
            params: &self.params,
        }
        .serialize(serializer)
    }
}

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("路径不存在: {0}")]
    PathNotFound(String),

    #[error("路径为空")]
    PathEmpty,

    #[error("路径非绝对路径: {0}")]
    PathNotAbsolute(String),

    #[error("无法识别源盘符")]
    SourceDriveUnknown,

    #[error("无法识别目标盘符")]
    TargetDriveUnknown,

    #[error("目标路径与源路径位于同一盘符，无需移动")]
    SameDrive,

    #[error("目标盘可用空间不足: 需要 {needed} 字节，可用 {available} 字节")]
    InsufficientSpace { needed: u64, available: u64 },

    #[error("源目录当前已是链接，无法再次移动: {0}")]
    AlreadyLinked(String),

    /// robocopy 复制失败。`detail` 为原始技术细节（原样展示），
    /// `detail_code` 为可选的本地化文案码。
    #[error("复制阶段失败 (robocopy 退出码 {code}): {detail}")]
    CopyFailed {
        code: u32,
        detail: String,
        detail_code: Option<&'static str>,
        detail_params: serde_json::Value,
    },

    #[error("复制完成但校验失败: 目标 {size} 字节，源约 {expected} 字节")]
    VerifyFailed { size: u64, expected: u64 },

    #[error("重命名源目录失败，可能软件正在运行或文件被占用: {0}")]
    RenameFailed(String),

    /// 创建链接失败。同样区分「可本地化的码」与「原始细节」。
    #[error("创建链接失败: {detail}")]
    LinkFailed {
        detail: String,
        detail_code: Option<&'static str>,
        detail_params: serde_json::Value,
    },

    #[error("未找到 id 为 {0} 的移动记录")]
    RecordNotFound(String),

    /// 还原时原路径已不是链接
    #[error("原路径 {0} 不是链接，无法自动还原")]
    RestoreNotLink(String),

    /// Windows API 调用失败，`detail` 为系统返回的原始消息
    #[error("Windows API 调用失败: {0}")]
    Windows(String),

    /// Windows API 调用失败 + 可本地化的原因码
    #[error("Windows API 调用失败: {detail}")]
    WindowsCode {
        detail: String,
        detail_code: &'static str,
        detail_params: serde_json::Value,
    },

    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),

    /// 还原后清理目标副本失败（目录多半还被占用着）
    #[error("清理目标副本失败: {detail}")]
    CleanupFailed {
        detail: String,
        params: serde_json::Value,
    },

    /// 目标副本是空的（或已被手动删掉）—— 不能"还原"成空目录，那等于删数据
    #[error("目标位置的副本是空的，无法还原: {0}")]
    TargetEmpty(String),

    /// 文件系统操作（内嵌文件管理器）相关错误
    #[error("{0}")]
    Fs(FsError),

    #[error("{0}")]
    Other(String),
}

/// 内嵌文件管理器用到的文件系统错误码
#[derive(Debug, thiserror::Error)]
pub enum FsError {
    #[error("无法获取 LOCALAPPDATA 环境变量")]
    LocalAppDataMissing,
    #[error("路径必须为绝对路径：{0}")]
    PathMustBeAbsolute(String),
    #[error("父目录必须为绝对路径：{0}")]
    ParentMustBeAbsolute(String),
    #[error("原路径必须为绝对路径：{0}")]
    OldPathMustBeAbsolute(String),
    #[error("不是文件夹：{0}")]
    NotAFolder(String),
    #[error("非法路径（无父目录）：{0}")]
    NoParentDir(String),
    #[error("文件夹名不能为空")]
    FolderNameEmpty,
    #[error("新文件夹名不能为空")]
    NewFolderNameEmpty,
    #[error("文件夹已存在：{0}")]
    FolderExists(String),
    #[error("同名文件夹已存在：{0}")]
    FolderNameExists(String),
}

impl FsError {
    pub fn code(&self) -> &'static str {
        match self {
            FsError::LocalAppDataMissing => "localAppDataMissing",
            FsError::PathMustBeAbsolute(_) => "pathMustBeAbsolute",
            FsError::ParentMustBeAbsolute(_) => "parentMustBeAbsolute",
            FsError::OldPathMustBeAbsolute(_) => "oldPathMustBeAbsolute",
            FsError::NotAFolder(_) => "notAFolder",
            FsError::NoParentDir(_) => "noParentDir",
            FsError::FolderNameEmpty => "folderNameEmpty",
            FsError::NewFolderNameEmpty => "newFolderNameEmpty",
            FsError::FolderExists(_) => "folderExists",
            FsError::FolderNameExists(_) => "folderNameExists",
        }
    }

    /// 该错误码对应的插值参数（对应 `src/i18n/codes.ts` 的 `ErrorCodeParams`）
    pub fn params(&self) -> serde_json::Value {
        match self {
            FsError::LocalAppDataMissing | FsError::FolderNameEmpty | FsError::NewFolderNameEmpty => {
                serde_json::Value::Null
            }
            FsError::PathMustBeAbsolute(p)
            | FsError::ParentMustBeAbsolute(p)
            | FsError::OldPathMustBeAbsolute(p)
            | FsError::NotAFolder(p)
            | FsError::NoParentDir(p)
            | FsError::FolderExists(p)
            | FsError::FolderNameExists(p) => serde_json::json!({ "path": p }),
        }
    }
}

impl AppError {
    /// 稳定的消息码。**改动这里等于改前端契约**，需要同步语言包。
    pub fn code(&self) -> &'static str {
        match self {
            AppError::PathNotFound(_) => "pathNotFound",
            AppError::PathEmpty => "pathEmpty",
            AppError::PathNotAbsolute(_) => "pathNotAbsolute",
            AppError::SourceDriveUnknown => "sourceDriveUnknown",
            AppError::TargetDriveUnknown => "targetDriveUnknown",
            AppError::SameDrive => "sameDrive",
            AppError::InsufficientSpace { .. } => "insufficientSpace",
            AppError::AlreadyLinked(_) => "alreadyLinked",
            AppError::CopyFailed { .. } => "copyFailed",
            AppError::VerifyFailed { .. } => "verifyFailed",
            AppError::RenameFailed(_) => "renameFailed",
            AppError::LinkFailed { .. } => "linkFailed",
            AppError::RecordNotFound(_) => "recordNotFound",
            AppError::RestoreNotLink(_) => "restoreNotLink",
            AppError::CleanupFailed { .. } => "cleanupFailed",
            AppError::TargetEmpty(_) => "targetEmpty",
            AppError::Windows(_) => "windows",
            AppError::WindowsCode { .. } => "windows",
            AppError::Io(_) => "io",
            AppError::Fs(e) => e.code(),
            AppError::Other(_) => "other",
        }
    }

    /// 只有「可本地化的码」、没有额外细节的链接失败
    pub fn link_failed_code(detail_code: &'static str) -> Self {
        AppError::LinkFailed {
            detail: detail_code.to_string(),
            detail_code: Some(detail_code),
            detail_params: serde_json::Value::Null,
        }
    }

    /// 创建链接失败 + 可本地化的原因码
    pub fn link_failed(
        detail: impl Into<String>,
        detail_code: &'static str,
        detail_params: serde_json::Value,
    ) -> Self {
        AppError::LinkFailed {
            detail: detail.into(),
            detail_code: Some(detail_code),
            detail_params,
        }
    }

    /// 还原后清理目标副本失败（路径在 params 里）
    pub fn cleanup_failed(detail: impl Into<String>, params: serde_json::Value) -> Self {
        AppError::CleanupFailed {
            detail: detail.into(),
            params,
        }
    }

    /// Windows API 调用失败 + 可本地化的原因码
    pub fn windows_code(
        detail: impl Into<String>,
        detail_code: &'static str,
        detail_params: serde_json::Value,
    ) -> Self {
        AppError::WindowsCode {
            detail: detail.into(),
            detail_code,
            detail_params,
        }
    }

    /// robocopy 相关失败 + 可本地化的原因码
    pub fn copy_failed(
        code: u32,
        detail: impl Into<String>,
        detail_code: &'static str,
        detail_params: serde_json::Value,
    ) -> Self {
        AppError::CopyFailed {
            code,
            detail: detail.into(),
            detail_code: Some(detail_code),
            detail_params,
        }
    }

    /// 该错误码对应的插值参数
    pub fn params(&self) -> serde_json::Value {
        match self {
            AppError::PathNotFound(p)
            | AppError::PathNotAbsolute(p)
            | AppError::AlreadyLinked(p)
            | AppError::RestoreNotLink(p) => serde_json::json!({ "path": p }),

            AppError::PathEmpty
            | AppError::SourceDriveUnknown
            | AppError::TargetDriveUnknown
            | AppError::SameDrive => serde_json::Value::Null,

            AppError::InsufficientSpace { needed, available } => {
                serde_json::json!({ "needed": needed, "available": available })
            }

            AppError::CopyFailed {
                code,
                detail,
                detail_code,
                detail_params,
            } => serde_json::json!({
                "code": code,
                "detail": detail,
                "detailCode": detail_code,
                "detailParams": detail_params,
            }),

            AppError::VerifyFailed { size, expected } => {
                serde_json::json!({ "size": size, "expected": expected })
            }

            AppError::RenameFailed(detail)
            | AppError::Windows(detail)
            | AppError::Other(detail) => serde_json::json!({ "detail": detail }),

            AppError::WindowsCode {
                detail,
                detail_code,
                detail_params,
            } => serde_json::json!({
                "detail": detail,
                "detailCode": detail_code,
                "detailParams": detail_params,
            }),

            AppError::LinkFailed {
                detail,
                detail_code,
                detail_params,
            } => serde_json::json!({
                "detail": detail,
                "detailCode": detail_code,
                "detailParams": detail_params,
            }),

            AppError::TargetEmpty(p) => serde_json::json!({ "path": p }),


            AppError::RecordNotFound(id) => serde_json::json!({ "id": id }),
            AppError::CleanupFailed { detail, params } => {
                let mut merged = params.clone();
                if let Some(obj) = merged.as_object_mut() {
                    obj.insert("detail".into(), serde_json::Value::from(detail.clone()));
                }
                merged
            }
            AppError::Io(e) => serde_json::json!({ "detail": e.to_string() }),
            AppError::Fs(e) => e.params(),
        }
    }
}

/// 序列化成 `{ "code": "...", "params": { ... } }`，前端按码翻译。
impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        #[derive(Serialize)]
        struct Wire<'a> {
            code: &'a str,
            #[serde(skip_serializing_if = "serde_json::Value::is_null")]
            params: &'a serde_json::Value,
        }

        let params = self.params();
        Wire {
            code: self.code(),
            params: &params,
        }
        .serialize(serializer)
    }
}

pub type AppResult<T> = Result<T, AppError>;

impl From<AppError> for String {
    fn from(e: AppError) -> String {
        e.to_string()
    }
}

impl From<FsError> for AppError {
    fn from(e: FsError) -> Self {
        AppError::Fs(e)
    }
}

impl From<windows::core::Error> for AppError {
    fn from(e: windows::core::Error) -> Self {
        AppError::Windows(e.message().to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Other(format!("JSON 序列化错误: {e}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_as_code_and_params() {
        let err = AppError::InsufficientSpace {
            needed: 10,
            available: 1,
        };
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["code"], "insufficientSpace");
        assert_eq!(json["params"]["needed"], 10);
        assert_eq!(json["params"]["available"], 1);
    }

    #[test]
    fn omits_empty_params() {
        let json = serde_json::to_value(AppError::SameDrive).unwrap();
        assert_eq!(json["code"], "sameDrive");
        assert!(json.get("params").is_none());
    }

    #[test]
    fn fs_error_keeps_path_param() {
        let err = AppError::from(FsError::NotAFolder("D:\\a".into()));
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["code"], "notAFolder");
        assert_eq!(json["params"]["path"], "D:\\a");
    }
}
