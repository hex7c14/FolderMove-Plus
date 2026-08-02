use serde::{Deserialize, Serialize};

/// 扫描得到的已安装软件信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppInfo {
    /// 注册表子键名，用作稳定 id
    pub id: String,
    pub display_name: String,
    pub publisher: Option<String>,
    pub version: Option<String>,
    /// 软件安装目录（移动前路径）
    pub install_location: String,
    pub source_drive: String,
    /// 预估占用字节数（来自注册表或目录遍历）
    pub estimated_size_bytes: u64,
    pub install_date: Option<String>,
    /// base64 编码的 PNG 图标，无则为 None
    pub icon: Option<String>,
    /// 该软件是否可被本工具移动
    pub is_movable: bool,
    /// 安装目录当前是否已是 reparse point（junction/symlink）
    pub is_already_linked: bool,
    pub not_movable_reason: Option<String>,
    /// 移动风险评级：low / medium / high
    pub risk_level: String,
    /// 风险评级说明
    pub risk_reason: Option<String>,
    /// 来源：registry / program_files / user_dir
    pub source: String,
}

/// 磁盘信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DriveInfo {
    /// 形如 "C:\\"
    pub letter: String,
    pub label: Option<String>,
    pub drive_type: String,
    pub total_bytes: u64,
    pub free_bytes: u64,
}

/// 移动请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MoveRequest {
    pub app_name: String,
    pub original_path: String,
    /// 目标根目录，如 "D:\\LinkMove"
    pub target_root: String,
}

/// 一条移动记录，写入清单用于还原
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MoveRecord {
    pub id: String,
    pub app_name: String,
    pub original_path: String,
    pub new_path: String,
    pub moved_at: String,
    pub size_bytes: u64,
    pub source_drive: String,
    pub target_drive: String,
}

/// 推送给前端的进度事件
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressPayload {
    pub id: String,
    pub phase: String,
    pub current: u64,
    pub total: u64,
    pub message: String,
}

impl ProgressPayload {
    pub fn new(id: &str, phase: &str, current: u64, total: u64, message: impl Into<String>) -> Self {
        Self {
            id: id.to_string(),
            phase: phase.to_string(),
            current,
            total,
            message: message.into(),
        }
    }
}
