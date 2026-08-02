use std::fs;
use std::path::PathBuf;

use crate::error::{AppError, AppResult};
use crate::models::MoveRecord;

fn manifest_path() -> AppResult<PathBuf> {
    let local = std::env::var("LOCALAPPDATA")
        .map_err(|_| AppError::Other("无法获取 LOCALAPPDATA 环境变量".into()))?;
    let dir = PathBuf::from(local).join("FolderMove-Plus");
    fs::create_dir_all(&dir)?;
    Ok(dir.join("manifest.json"))
}

pub fn load() -> AppResult<Vec<MoveRecord>> {
    let p = manifest_path()?;
    if !p.exists() {
        return Ok(vec![]);
    }
    let data = fs::read(&p)?;
    Ok(serde_json::from_slice(&data).unwrap_or_default())
}

pub fn save(records: &[MoveRecord]) -> AppResult<()> {
    let p = manifest_path()?;
    let data = serde_json::to_vec_pretty(records)?;
    let tmp = p.with_extension("json.tmp");
    fs::write(&tmp, &data)?;
    fs::rename(&tmp, &p)?;
    Ok(())
}

pub fn add(record: MoveRecord) -> AppResult<()> {
    let mut records = load()?;
    records.push(record);
    save(&records)
}

pub fn remove(id: &str) -> AppResult<()> {
    let mut records = load()?;
    records.retain(|r| r.id != id);
    save(&records)
}

pub fn find(id: &str) -> AppResult<MoveRecord> {
    let records = load()?;
    records
        .into_iter()
        .find(|r| r.id == id)
        .ok_or_else(|| AppError::RecordNotFound(id.into()))
}
