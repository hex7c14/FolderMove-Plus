use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("路径不存在: {0}")]
    PathNotFound(String),
    #[error("目标路径与源路径位于同一盘符，无需移动")]
    SameDrive,
    #[error("目标盘可用空间不足: 需要 {needed} 字节，可用 {available} 字节")]
    InsufficientSpace { needed: u64, available: u64 },
    #[error("源目录当前已是链接，无法再次移动: {0}")]
    AlreadyLinked(String),
    #[error("复制阶段失败 (robocopy 退出码 {code}): {detail}")]
    CopyFailed { code: u32, detail: String },
    #[error("复制完成但校验失败: {0}")]
    VerifyFailed(String),
    #[error("重命名源目录失败，可能软件正在运行或文件被占用: {0}")]
    RenameFailed(String),
    #[error("创建链接失败: {0}")]
    LinkFailed(String),
    #[error("未找到 id 为 {0} 的移动记录")]
    RecordNotFound(String),
    #[error("Windows API 调用失败: {0}")]
    Windows(String),
    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Other(String),
}

impl From<String> for AppError {
    fn from(s: String) -> Self {
        AppError::Other(s)
    }
}

pub type AppResult<T> = Result<T, AppError>;

impl From<AppError> for String {
    fn from(e: AppError) -> String {
        e.to_string()
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

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
