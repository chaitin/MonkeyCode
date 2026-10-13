//! Desktop-owned audio library. Import only bounded PCM WAV converted by the settings page.
use crate::{config, util::LockExt};
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::AppHandle;

const MAX_BYTES: usize = 5_760_044; // 30 s, stereo, 48 kHz, PCM16
static LIBRARY: Mutex<()> = Mutex::new(());
#[derive(Clone, Serialize, Deserialize)]
pub struct Asset {
    pub id: String,
    pub name: String,
}
fn valid_id(id: &str) -> bool {
    id.len() == 64
        && id
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}
pub fn valid_source(source: &str) -> bool {
    ["default", "soft", "toy", "bell"].contains(&source)
        || source.strip_prefix("custom:").is_some_and(valid_id)
}
fn directory(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = config::local_data_dir(app)?.join("pet-sounds");
    if dir.exists()
        && !fs::symlink_metadata(&dir)
            .map_err(|e| e.to_string())?
            .is_dir()
    {
        return Err("音效目录无效".into());
    }
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}
fn read_file(path: &Path, limit: usize) -> Result<Vec<u8>, String> {
    let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.len() > limit as u64 {
        return Err("音效文件无效或过大".into());
    }
    let mut data = Vec::new();
    fs::File::open(path)
        .map_err(|e| e.to_string())?
        .take(limit as u64 + 1)
        .read_to_end(&mut data)
        .map_err(|e| e.to_string())?;
    if data.len() > limit {
        return Err("音效文件过大".into());
    }
    Ok(data)
}
fn validate_wav(b: &[u8]) -> Result<(), String> {
    let bad = || "音效需为 30 秒以内的 PCM16 WAV".to_string();
    if b.len() < 46
        || b.len() > MAX_BYTES
        || &b[..4] != b"RIFF"
        || &b[8..16] != b"WAVEfmt "
        || &b[36..40] != b"data"
    {
        return Err(bad());
    }
    let u16at = |i| u16::from_le_bytes(b[i..i + 2].try_into().unwrap());
    let u32at = |i| u32::from_le_bytes(b[i..i + 4].try_into().unwrap());
    let channels = u32::from(u16at(22));
    let rate = u32at(24);
    let block = channels * 2;
    if u32at(4) as usize != b.len() - 8
        || u32at(16) != 16
        || u16at(20) != 1
        || !(1..=2).contains(&channels)
        || !(8000..=48000).contains(&rate)
        || u16at(34) != 16
        || u32::from(u16at(32)) != block
        || u32at(28) != rate * block
        || u32at(40) as usize != b.len() - 44
        || (b.len() - 44) % block as usize != 0
        || b.len() - 44 > (rate * block * 30) as usize
    {
        return Err(bad());
    }
    Ok(())
}
fn list(dir: &Path) -> Result<Vec<Asset>, String> {
    let mut assets = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().and_then(|v| v.to_str()) != Some("json") {
            continue;
        }
        if let Ok(bytes) = read_file(&path, 4096) {
            if let Ok(asset) = serde_json::from_slice::<Asset>(&bytes) {
                if valid_id(&asset.id)
                    && path.file_stem().and_then(|v| v.to_str()) == Some(&asset.id)
                {
                    assets.push(asset);
                }
            }
        }
    }
    assets.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(assets)
}
#[tauri::command]
pub async fn pet_sound_list(app: AppHandle) -> Result<Vec<Asset>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _lock = LIBRARY.lock_ok();
        list(&directory(&app)?)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn pet_sound_import(app: AppHandle, name: String, data: String) -> Result<Asset, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if data.len() > (MAX_BYTES + 2) / 3 * 4 {
            return Err("音效文件过大".into());
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(data)
            .map_err(|e| e.to_string())?;
        validate_wav(&bytes)?;
        let asset = Asset {
            id: format!("{:x}", Sha256::digest(&bytes)),
            name: name.chars().filter(|c| !c.is_control()).take(80).collect(),
        };
        if asset.name.trim().is_empty() {
            return Err("音效名称不能为空".into());
        }
        let _lock = LIBRARY.lock_ok();
        let dir = directory(&app)?;
        let assets = list(&dir)?;
        if assets.len() >= 20 && !assets.iter().any(|a| a.id == asset.id) {
            return Err("最多保存 20 个音效，请先移除不使用的音效".into());
        }
        config::atomic_write_private(&dir.join(format!("{}.wav", asset.id)), &bytes)?;
        config::atomic_write_private(
            &dir.join(format!("{}.json", asset.id)),
            &serde_json::to_vec(&asset).map_err(|e| e.to_string())?,
        )?;
        Ok(asset)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn pet_sound_read(app: AppHandle, id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !valid_id(&id) {
            return Err("音效标识无效".into());
        }
        let _lock = LIBRARY.lock_ok();
        let bytes = read_file(&directory(&app)?.join(format!("{id}.wav")), MAX_BYTES)?;
        validate_wav(&bytes)?;
        if format!("{:x}", Sha256::digest(&bytes)) != id {
            return Err("音效文件损坏".into());
        }
        Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn pet_sound_remove(app: AppHandle, id: String) -> Result<(), String> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || {
        if !valid_id(&id) {
            return Err("音效标识无效".into());
        }
        let state = app.state::<crate::pet::PetState>();
        let prefs = state.prefs.lock_ok();
        let used = serde_json::to_value(&prefs.sounds).map_err(|e| e.to_string())?;
        if used
            .as_object()
            .unwrap()
            .values()
            .any(|s| s["source"] == format!("custom:{id}"))
        {
            return Err("请先为使用此音效的事件选择其他音效".into());
        }
        let _lock = LIBRARY.lock_ok();
        let dir = directory(&app)?;
        for ext in ["json", "wav"] {
            match fs::remove_file(dir.join(format!("{id}.{ext}"))) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(e.to_string()),
            }
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_wav_and_source_validation() {
        let good = include_bytes!("../ui-next/public/sound-pet-press.wav");
        assert!(validate_wav(good).is_ok());
        assert!(validate_wav(&good[..good.len() - 2]).is_err());
        let mut broken = good.to_vec();
        broken[22] = 0;
        assert!(validate_wav(&broken).is_err());
        assert!(!valid_source("custom:../../secret"));
        assert!(!valid_source("https://example.com/sound.wav"));
        assert!(valid_source(&format!("custom:{}", "a".repeat(64))));
    }
}

#[tauri::command]
pub fn pet_audio_error(app: AppHandle, message: String) {
    use tauri::Emitter;
    let _ = app.emit_to(
        "main",
        "pet-audio-error",
        message.chars().take(240).collect::<String>(),
    );
}
