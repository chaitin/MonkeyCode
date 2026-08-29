//! 配置目录级暂存配额、进程 instance lease 与批次合并记账。
//!
//! 本模块只提供同步、纯 Rust 文件系统接口。调用方必须在 `spawn_blocking` 中使用；
//! 不持有 Tauri 状态借用，也不实现批次 phase。

use std::collections::{BTreeMap, HashSet};
use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

use fs2::FileExt as _;
use serde::{Deserialize, Serialize};
#[cfg(windows)]
use unicode_normalization::UnicodeNormalization as _;

use super::model::{
    SkillImportSourceKind, MAX_BYTES_PER_BATCH, MAX_ENTRIES_PER_BATCH, MAX_SKILLS_PER_BATCH,
    MAX_SOURCES_PER_BATCH, MAX_STAGING_BYTES_PER_CONFIG, MAX_STAGING_ENTRIES_PER_CONFIG,
};

const STAGING_DIRECTORY: &str = "skill-import-staging";
const GLOBAL_LOCK_FILE: &str = "skill-import-staging.lock";
const USAGE_FILE: &str = "skill-import-staging.usage.json";
const INSTANCE_LEASE_FILE: &str = "instance.lease";
const LEDGER_VERSION: u32 = 1;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct StagingUsage {
    pub entries: usize,
    pub bytes: u64,
}

#[derive(Clone, Copy, Debug)]
struct QuotaLimits {
    entries: usize,
    bytes: u64,
}

impl QuotaLimits {
    const PRODUCTION: Self = Self {
        entries: MAX_STAGING_ENTRIES_PER_CONFIG,
        bytes: MAX_STAGING_BYTES_PER_CONFIG,
    };
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum LeaseError {
    ConfigEntriesExceeded,
    ConfigBytesExceeded,
    BatchSourcesExceeded,
    BatchSkillsExceeded,
    BatchEntriesExceeded,
    BatchBytesExceeded,
    DuplicateSource,
    UsageMismatch {
        reserved: StagingUsage,
        candidate: StagingUsage,
    },
    CleanupFailed {
        target: &'static str,
        message: String,
    },
    Io {
        operation: &'static str,
        message: String,
    },
    CorruptLedger(String),
}

impl LeaseError {
    fn io(operation: &'static str, error: impl fmt::Display) -> Self {
        Self::Io {
            operation,
            message: error.to_string(),
        }
    }

    fn cleanup(target: &'static str, error: impl fmt::Display) -> Self {
        Self::CleanupFailed {
            target,
            message: error.to_string(),
        }
    }
}

impl fmt::Display for LeaseError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ConfigEntriesExceeded => write!(formatter, "配置目录暂存条目超过 20000 个"),
            Self::ConfigBytesExceeded => write!(formatter, "配置目录暂存大小超过 1 GiB"),
            Self::BatchSourcesExceeded => write!(formatter, "批次来源超过 100 个"),
            Self::BatchSkillsExceeded => write!(formatter, "批次技能超过 100 个"),
            Self::BatchEntriesExceeded => write!(formatter, "批次暂存条目超过 10000 个"),
            Self::BatchBytesExceeded => write!(formatter, "批次暂存大小超过 500 MiB"),
            Self::DuplicateSource => write!(formatter, "来源已存在于当前批次"),
            Self::UsageMismatch {
                reserved,
                candidate,
            } => write!(
                formatter,
                "来源暂存记账不一致（预留 {} entries/{} bytes，合并 {} entries/{} bytes）",
                reserved.entries, reserved.bytes, candidate.entries, candidate.bytes
            ),
            Self::CleanupFailed { target, message } => {
                write!(formatter, "清理{target}失败: {message}")
            }
            Self::Io { operation, message } => write!(formatter, "{operation}失败: {message}"),
            Self::CorruptLedger(message) => write!(formatter, "暂存配额账本损坏: {message}"),
        }
    }
}

impl std::error::Error for LeaseError {}

/// 消费型清理失败必须把仍拥有目录/账本额度的 guard 交还调用方。调用方可以
/// 保留它稍后重试；即使直接丢弃，guard 的 Drop 也仍会做一次尽力清理。
#[derive(Debug)]
pub(crate) struct CleanupGuardError<T> {
    error: LeaseError,
    guard: T,
}

impl<T> CleanupGuardError<T> {
    fn new(error: LeaseError, guard: T) -> Self {
        Self { error, guard }
    }

    pub(crate) fn into_parts(self) -> (LeaseError, T) {
        (self.error, self.guard)
    }

    pub(crate) fn into_error(self) -> LeaseError {
        self.error
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub(crate) struct SourceKey(String);

impl SourceKey {
    /// 选择路径键不解析链接，也不用于打开来源；它只让不可读/失败来源仍可稳定去重。
    pub(crate) fn from_selection(kind: SkillImportSourceKind, path: &Path) -> io::Result<Self> {
        let absolute = if path.is_absolute() {
            path.to_path_buf()
        } else {
            std::env::current_dir()?.join(path)
        };
        let mut parts = Vec::new();
        for component in absolute.components() {
            match component {
                Component::Prefix(prefix) => {
                    parts.push(prefix.as_os_str().to_string_lossy().into_owned())
                }
                Component::RootDir => parts.push(String::new()),
                Component::CurDir => {}
                Component::ParentDir => {
                    if parts.len() > 1 {
                        parts.pop();
                    }
                }
                Component::Normal(value) => parts.push(value.to_string_lossy().into_owned()),
            }
        }
        let normalized = parts.join("/");
        #[cfg(windows)]
        let normalized = normalized
            .nfd()
            .flat_map(char::to_lowercase)
            .collect::<String>();
        let prefix = match kind {
            SkillImportSourceKind::Folders => "folder-path",
            SkillImportSourceKind::Zips => "zip-path",
        };
        Ok(Self(format!("{prefix}:{normalized}")))
    }

    pub(super) fn folder_identity(object_a: u64, object_b: u64) -> Self {
        Self(format!("folder-object:{object_a:016x}:{object_b:016x}"))
    }

    pub(super) fn archive_identity(object_a: u64, object_b: u64, object_c: u64) -> Self {
        Self(format!(
            "zip-object:{object_a:016x}:{object_b:016x}:{object_c:016x}"
        ))
    }
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct QuotaLedger {
    version: u32,
    reservations: BTreeMap<String, ReservationRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ReservationRecord {
    instance_id: String,
    entries: usize,
    bytes: u64,
}

impl QuotaLedger {
    fn total(&self) -> Result<StagingUsage, LeaseError> {
        self.reservations
            .values()
            .try_fold(StagingUsage::default(), |mut total, reservation| {
                total.entries = total
                    .entries
                    .checked_add(reservation.entries)
                    .ok_or_else(|| LeaseError::CorruptLedger("entry 总数溢出".into()))?;
                total.bytes = total
                    .bytes
                    .checked_add(reservation.bytes)
                    .ok_or_else(|| LeaseError::CorruptLedger("byte 总数溢出".into()))?;
                Ok(total)
            })
    }
}

#[derive(Debug)]
struct LedgerStore {
    config_dir: PathBuf,
    lock_path: PathBuf,
    usage_path: PathBuf,
    limits: QuotaLimits,
}

impl LedgerStore {
    fn new(config_dir: &Path, limits: QuotaLimits) -> Self {
        Self {
            config_dir: config_dir.to_path_buf(),
            lock_path: config_dir.join(GLOBAL_LOCK_FILE),
            usage_path: config_dir.join(USAGE_FILE),
            limits,
        }
    }

    fn with_locked<T>(
        &self,
        operation: impl FnOnce(&mut QuotaLedger) -> Result<T, LeaseError>,
    ) -> Result<T, LeaseError> {
        fs::create_dir_all(&self.config_dir)
            .map_err(|error| LeaseError::io("创建配置目录", error))?;
        let lock = open_private_lock_file(&self.lock_path)?;
        lock.lock_exclusive()
            .map_err(|error| LeaseError::io("取得暂存配置锁", error))?;
        let result = (|| {
            let mut ledger = self.read_ledger()?;
            let operation_result = operation(&mut ledger);
            // 启动清理可能已删除孤儿目录后才在创建本实例时失败；即使后续操作
            // 返回错误，也要提交清理后的账本。各配额拒绝路径在修改前检查，写回
            // 同值仍保持原子不变。
            self.write_ledger(&ledger)?;
            operation_result
        })();
        let unlock =
            fs2::FileExt::unlock(&lock).map_err(|error| LeaseError::io("释放暂存配置锁", error));
        match (result, unlock) {
            (Err(error), _) => Err(error),
            (Ok(_), Err(error)) => Err(error),
            (Ok(value), Ok(())) => Ok(value),
        }
    }

    fn read_ledger(&self) -> Result<QuotaLedger, LeaseError> {
        match fs::read(&self.usage_path) {
            Ok(data) => {
                let ledger: QuotaLedger = serde_json::from_slice(&data)
                    .map_err(|error| LeaseError::CorruptLedger(error.to_string()))?;
                if ledger.version != LEDGER_VERSION {
                    return Err(LeaseError::CorruptLedger(format!(
                        "不支持的版本 {}",
                        ledger.version
                    )));
                }
                ledger.total()?;
                Ok(ledger)
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(QuotaLedger {
                version: LEDGER_VERSION,
                reservations: BTreeMap::new(),
            }),
            Err(error) => Err(LeaseError::io("读取暂存配额账本", error)),
        }
    }

    fn write_ledger(&self, ledger: &QuotaLedger) -> Result<(), LeaseError> {
        let data = serde_json::to_vec(ledger)
            .map_err(|error| LeaseError::CorruptLedger(error.to_string()))?;
        crate::config::atomic_write_private(&self.usage_path, &data)
            .map_err(|error| LeaseError::io("原子写入暂存配额账本", error))
    }

    fn usage(&self) -> Result<StagingUsage, LeaseError> {
        self.with_locked(|ledger| ledger.total())
    }
}

fn open_private_lock_file(path: &Path) -> Result<File, LeaseError> {
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        options.mode(0o600);
    }
    options
        .open(path)
        .map_err(|error| LeaseError::io("打开暂存配置锁", error))
}

/// 一个进程实例。`Arc` 最后一个引用销毁前始终持有 `instance.lease` 独占锁；
/// `SourceReservation` 自身也持有引用，所以不会出现暂存尚在而 lease 提前释放。
#[derive(Clone, Debug)]
pub(crate) struct StagingInstance {
    inner: Arc<InstanceInner>,
}

#[derive(Debug)]
struct InstanceInner {
    instance_id: String,
    root: PathBuf,
    lease_file: File,
    ledger: Arc<LedgerStore>,
}

impl StagingInstance {
    pub(crate) fn open(
        config_dir: &Path,
        belongs_to_install_transaction: impl Fn(&Path) -> bool,
    ) -> Result<Self, LeaseError> {
        Self::open_with_limits(
            config_dir,
            belongs_to_install_transaction,
            QuotaLimits::PRODUCTION,
        )
    }

    fn open_with_limits(
        config_dir: &Path,
        belongs_to_install_transaction: impl Fn(&Path) -> bool,
        limits: QuotaLimits,
    ) -> Result<Self, LeaseError> {
        let staging = config_dir.join(STAGING_DIRECTORY);
        fs::create_dir_all(&staging).map_err(|error| LeaseError::io("创建导入暂存目录", error))?;
        let ledger = Arc::new(LedgerStore::new(config_dir, limits));
        let (instance_id, root, lease_file) = ledger.with_locked(|quota| {
            cleanup_released_instances(&staging, quota, &belongs_to_install_transaction)?;
            for _ in 0..32 {
                let instance_id = random_id()?;
                let root = staging.join(&instance_id);
                match fs::create_dir(&root) {
                    Ok(()) => {
                        let lease_path = root.join(INSTANCE_LEASE_FILE);
                        let lease_file = OpenOptions::new()
                            .read(true)
                            .write(true)
                            .create_new(true)
                            .open(&lease_path)
                            .map_err(|error| LeaseError::io("创建 instance lease", error))?;
                        lease_file
                            .lock_exclusive()
                            .map_err(|error| LeaseError::io("持有 instance lease", error))?;
                        return Ok((instance_id, root, lease_file));
                    }
                    Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                    Err(error) => return Err(LeaseError::io("创建 instance 暂存目录", error)),
                }
            }
            Err(LeaseError::Io {
                operation: "创建 instance 暂存目录",
                message: "随机标识连续碰撞".into(),
            })
        })?;
        Ok(Self {
            inner: Arc::new(InstanceInner {
                instance_id,
                root,
                lease_file,
                ledger,
            }),
        })
    }

    pub(crate) fn instance_id(&self) -> &str {
        &self.inner.instance_id
    }

    pub(crate) fn root(&self) -> &Path {
        &self.inner.root
    }

    /// 创建来源级 RAII 预留。来源目录本身是基础设施，不计 entry；folder/archive
    /// 在每个实际技能 entry 创建前调用 `reserve_entries`。
    pub(crate) fn begin_source(&self) -> Result<SourceReservation, LeaseError> {
        for _ in 0..32 {
            let reservation_id = random_id()?;
            let staging_root = self.inner.root.join(format!("source-{reservation_id}"));
            if fs::symlink_metadata(&staging_root).is_ok() {
                continue;
            }
            self.inner.ledger.with_locked(|ledger| {
                if ledger.reservations.contains_key(&reservation_id) {
                    return Err(LeaseError::Io {
                        operation: "创建来源预留",
                        message: "随机标识碰撞".into(),
                    });
                }
                ledger.reservations.insert(
                    reservation_id.clone(),
                    ReservationRecord {
                        instance_id: self.inner.instance_id.clone(),
                        entries: 0,
                        bytes: 0,
                    },
                );
                Ok(())
            })?;
            return Ok(SourceReservation {
                instance: self.inner.clone(),
                reservation_id,
                staging_root,
                usage: StagingUsage::default(),
                released: false,
                #[cfg(test)]
                cleanup_error: None,
            });
        }
        Err(LeaseError::Io {
            operation: "创建来源预留",
            message: "随机标识连续碰撞".into(),
        })
    }

    pub(crate) fn config_usage(&self) -> Result<StagingUsage, LeaseError> {
        self.inner.ledger.usage()
    }
}

fn cleanup_released_instances(
    staging: &Path,
    ledger: &mut QuotaLedger,
    protected: &impl Fn(&Path) -> bool,
) -> Result<(), LeaseError> {
    cleanup_released_instances_with(staging, ledger, protected, &|path| fs::remove_dir_all(path))
}

fn cleanup_released_instances_with(
    staging: &Path,
    ledger: &mut QuotaLedger,
    protected: &impl Fn(&Path) -> bool,
    remove_instance: &impl Fn(&Path) -> io::Result<()>,
) -> Result<(), LeaseError> {
    let mut present = HashSet::new();
    let entries =
        fs::read_dir(staging).map_err(|error| LeaseError::io("枚举 instance 暂存目录", error))?;
    for entry in entries {
        let entry = entry.map_err(|error| LeaseError::io("读取 instance 暂存条目", error))?;
        let path = entry.path();
        let instance_id = entry.file_name().to_string_lossy().into_owned();
        present.insert(instance_id.clone());
        let file_type = entry
            .file_type()
            .map_err(|error| LeaseError::io("读取 instance 暂存类型", error))?;
        if !file_type.is_dir() {
            continue;
        }
        let lease_path = path.join(INSTANCE_LEASE_FILE);
        let released = match OpenOptions::new().read(true).write(true).open(&lease_path) {
            Ok(file) => match file.try_lock_exclusive() {
                Ok(()) => {
                    fs2::FileExt::unlock(&file)
                        .map_err(|error| LeaseError::io("释放孤儿 lease 探测锁", error))?;
                    true
                }
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => false,
                Err(error) => return Err(LeaseError::io("探测 instance lease", error)),
            },
            Err(error) if error.kind() == io::ErrorKind::NotFound => true,
            Err(error) => return Err(LeaseError::io("打开 instance lease", error)),
        };
        if !released || protected(&path) {
            continue;
        }
        match remove_instance(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(LeaseError::cleanup("孤儿 instance 暂存目录", error));
            }
        }
        present.remove(&instance_id);
        ledger
            .reservations
            .retain(|_, record| record.instance_id != instance_id);
    }
    // 目录已经不存在的 owner 不可能仍由活动 lease 或安装事务持有。
    ledger
        .reservations
        .retain(|_, record| present.contains(&record.instance_id));
    Ok(())
}

impl Drop for InstanceInner {
    fn drop(&mut self) {
        // 全局锁覆盖“释放 lease → 删除目录 → 删除账本 owner”，避免另一进程在
        // 中间把本实例误判成需单独恢复的孤儿。
        let _ = self.ledger.with_locked(|ledger| {
            let _ = fs2::FileExt::unlock(&self.lease_file);
            match fs::remove_dir_all(&self.root) {
                Ok(()) => {
                    ledger
                        .reservations
                        .retain(|_, record| record.instance_id != self.instance_id);
                }
                Err(error) if error.kind() == io::ErrorKind::NotFound => {
                    ledger
                        .reservations
                        .retain(|_, record| record.instance_id != self.instance_id);
                }
                Err(_) => {
                    // 删除失败时保留账本预留；下一次启动会在成功清理后回收。
                }
            }
            Ok(())
        });
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct QuotaCheckpoint(StagingUsage);

/// 来源级配额与目录清理 guard。普通错误、拒绝、取消和 panic 展开都会先尝试
/// 清理来源目录；只有删除成功或目录已不存在时才释放配置级预留，删除失败保留账本。
#[derive(Debug)]
pub(crate) struct SourceReservation {
    instance: Arc<InstanceInner>,
    reservation_id: String,
    staging_root: PathBuf,
    usage: StagingUsage,
    released: bool,
    #[cfg(test)]
    cleanup_error: Option<io::ErrorKind>,
}

impl SourceReservation {
    pub(crate) fn staging_root(&self) -> &Path {
        &self.staging_root
    }

    pub(crate) fn usage(&self) -> StagingUsage {
        self.usage
    }

    pub(crate) fn checkpoint(&self) -> QuotaCheckpoint {
        QuotaCheckpoint(self.usage)
    }

    pub(crate) fn reserve_entries(&mut self, count: usize) -> Result<(), LeaseError> {
        if count == 0 {
            return Ok(());
        }
        let next = self
            .usage
            .entries
            .checked_add(count)
            .ok_or(LeaseError::ConfigEntriesExceeded)?;
        self.update_reservation(next, self.usage.bytes)?;
        self.usage.entries = next;
        Ok(())
    }

    pub(crate) fn reserve_bytes(&mut self, count: u64) -> Result<(), LeaseError> {
        if count == 0 {
            return Ok(());
        }
        let next = self
            .usage
            .bytes
            .checked_add(count)
            .ok_or(LeaseError::ConfigBytesExceeded)?;
        self.update_reservation(self.usage.entries, next)?;
        self.usage.bytes = next;
        Ok(())
    }

    pub(crate) fn rollback_to(&mut self, checkpoint: QuotaCheckpoint) -> Result<(), LeaseError> {
        if checkpoint.0.entries > self.usage.entries || checkpoint.0.bytes > self.usage.bytes {
            return Err(LeaseError::CorruptLedger(
                "来源 checkpoint 大于当前预留".into(),
            ));
        }
        self.update_reservation(checkpoint.0.entries, checkpoint.0.bytes)?;
        self.usage = checkpoint.0;
        Ok(())
    }

    fn update_reservation(&self, entries: usize, bytes: u64) -> Result<(), LeaseError> {
        self.instance.ledger.with_locked(|ledger| {
            let current = ledger
                .reservations
                .get(&self.reservation_id)
                .cloned()
                .ok_or_else(|| LeaseError::CorruptLedger("来源预留记录缺失".into()))?;
            let total = ledger.total()?;
            let other_entries = total
                .entries
                .checked_sub(current.entries)
                .ok_or_else(|| LeaseError::CorruptLedger("entry 预留下溢".into()))?;
            let other_bytes = total
                .bytes
                .checked_sub(current.bytes)
                .ok_or_else(|| LeaseError::CorruptLedger("byte 预留下溢".into()))?;
            if other_entries
                .checked_add(entries)
                .is_none_or(|value| value > self.instance.ledger.limits.entries)
            {
                return Err(LeaseError::ConfigEntriesExceeded);
            }
            if other_bytes
                .checked_add(bytes)
                .is_none_or(|value| value > self.instance.ledger.limits.bytes)
            {
                return Err(LeaseError::ConfigBytesExceeded);
            }
            let record = ledger
                .reservations
                .get_mut(&self.reservation_id)
                .expect("上方已检查预留存在");
            record.entries = entries;
            record.bytes = bytes;
            Ok(())
        })
    }

    /// 显式取消/回滚整个来源。必须先确认暂存目录已经删除，才能从配置级账本
    /// 移除 reservation；删除失败时返回结构化错误并保留原配额供稍后重试。
    pub(crate) fn cleanup(&mut self) -> Result<(), LeaseError> {
        #[cfg(test)]
        let injected = self.cleanup_error;
        self.release_inner_with(&|path| {
            #[cfg(test)]
            if let Some(kind) = injected {
                return Err(io::Error::from(kind));
            }
            fs::remove_dir_all(path)
        })
    }

    /// 状态层拒绝一个已经移交所有权的来源时使用。失败会连同 guard 返回，调用方
    /// 必须保留后重试或明确丢弃给 Drop，不能只留下无法关联目录的 ledger 记录。
    pub(crate) fn cleanup_owned(mut self) -> Result<(), CleanupGuardError<Self>> {
        match self.cleanup() {
            Ok(()) => Ok(()),
            Err(error) => Err(CleanupGuardError::new(error, self)),
        }
    }

    #[cfg(test)]
    pub(crate) fn inject_cleanup_error(&mut self, kind: io::ErrorKind) {
        self.cleanup_error = Some(kind);
    }

    #[cfg(test)]
    fn clear_cleanup_error(&mut self) {
        self.cleanup_error = None;
    }

    pub(crate) fn cleanup_owned_with(
        mut self,
        remove_source: &impl Fn(&Path) -> io::Result<()>,
    ) -> Result<(), CleanupGuardError<Self>> {
        match self.release_inner_with(remove_source) {
            Ok(()) => Ok(()),
            Err(error) => Err(CleanupGuardError::new(error, self)),
        }
    }

    fn release_inner_with(
        &mut self,
        remove_source: &impl Fn(&Path) -> io::Result<()>,
    ) -> Result<(), LeaseError> {
        if self.released {
            return Ok(());
        }
        match remove_source(&self.staging_root) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(LeaseError::cleanup("来源暂存目录", error)),
        }
        self.instance.ledger.with_locked(|ledger| {
            ledger.reservations.remove(&self.reservation_id);
            Ok(())
        })?;
        self.usage = StagingUsage::default();
        self.released = true;
        Ok(())
    }
}

impl Drop for SourceReservation {
    fn drop(&mut self) {
        // Drop 无法传播错误：只做同一顺序的尽力重试。若删除仍失败，
        // `release_inner_with` 不会触碰 ledger，后续 orphan reap 可继续重试。
        let _ = self.cleanup();
    }
}

/// folder/archive 的无配额兼容入口及测试小限制共用此接口。生产状态层应传
/// `SourceReservation`，确保 entry 创建前和每段写入前更新跨实例账本。
pub(crate) trait StagingQuota {
    fn checkpoint(&self) -> QuotaCheckpoint;
    fn reserve_entries(&mut self, count: usize) -> Result<(), LeaseError>;
    fn reserve_bytes(&mut self, count: u64) -> Result<(), LeaseError>;
    fn rollback_to(&mut self, checkpoint: QuotaCheckpoint) -> Result<(), LeaseError>;
}

impl StagingQuota for SourceReservation {
    fn checkpoint(&self) -> QuotaCheckpoint {
        self.checkpoint()
    }

    fn reserve_entries(&mut self, count: usize) -> Result<(), LeaseError> {
        self.reserve_entries(count)
    }

    fn reserve_bytes(&mut self, count: u64) -> Result<(), LeaseError> {
        self.reserve_bytes(count)
    }

    fn rollback_to(&mut self, checkpoint: QuotaCheckpoint) -> Result<(), LeaseError> {
        self.rollback_to(checkpoint)
    }
}

#[derive(Debug, Default)]
pub(crate) struct UnboundedStagingQuota {
    usage: StagingUsage,
}

impl StagingQuota for UnboundedStagingQuota {
    fn checkpoint(&self) -> QuotaCheckpoint {
        QuotaCheckpoint(self.usage)
    }

    fn reserve_entries(&mut self, count: usize) -> Result<(), LeaseError> {
        self.usage.entries = self.usage.entries.saturating_add(count);
        Ok(())
    }

    fn reserve_bytes(&mut self, count: u64) -> Result<(), LeaseError> {
        self.usage.bytes = self.usage.bytes.saturating_add(count);
        Ok(())
    }

    fn rollback_to(&mut self, checkpoint: QuotaCheckpoint) -> Result<(), LeaseError> {
        self.usage = checkpoint.0;
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct BatchAccountingSnapshot {
    pub sources: usize,
    pub skills: usize,
    pub entries: usize,
    pub bytes: u64,
}

#[derive(Debug, Default)]
struct BatchAccountingInner {
    usage: BatchAccountingSnapshot,
    source_keys: HashSet<SourceKey>,
}

/// 后续 `state.rs` 可直接持有此对象；它只负责来源/技能/entry/byte 原子合并，
/// 不包含 Collecting/Validating 等 phase。
#[derive(Clone, Debug, Default)]
pub(crate) struct BatchAccounting {
    inner: Arc<Mutex<BatchAccountingInner>>,
}

#[derive(Debug)]
pub(crate) struct SourceMergeCandidate {
    keys: Vec<SourceKey>,
    skill_count: usize,
    usage: StagingUsage,
}

impl SourceMergeCandidate {
    pub(crate) fn staged(
        selection_key: SourceKey,
        canonical_key: SourceKey,
        skill_count: usize,
        usage: StagingUsage,
    ) -> Self {
        Self {
            keys: vec![selection_key, canonical_key],
            skill_count,
            usage,
        }
    }

    /// 失败和空来源同样携带键并占一个 source；它们没有暂存用量。
    pub(crate) fn failed_or_empty(source_key: SourceKey) -> Self {
        Self {
            keys: vec![source_key],
            skill_count: 0,
            usage: StagingUsage::default(),
        }
    }
}

impl BatchAccounting {
    pub(crate) fn snapshot(&self) -> BatchAccountingSnapshot {
        self.lock().usage
    }

    pub(crate) fn merge(
        &self,
        candidate: SourceMergeCandidate,
        reservation: Option<SourceReservation>,
    ) -> Result<MergedSourceGuard, LeaseError> {
        match self.merge_guarded(candidate, reservation) {
            Ok(merged) => Ok(merged),
            Err(rejected) => {
                let (error, candidate) = rejected.into_parts();
                match candidate.cleanup() {
                    Ok(()) => Err(error),
                    Err(cleanup_error) => Err(cleanup_error.into_error()),
                }
            }
        }
    }

    /// 状态层需要在批次 mutex 外显式清理所有拒绝来源，因此拒绝结果仍携带完整
    /// 候选 guard。调用方必须调用 `MergedSourceGuard::cleanup`，不得仅依赖 Drop。
    pub(crate) fn merge_guarded(
        &self,
        candidate: SourceMergeCandidate,
        reservation: Option<SourceReservation>,
    ) -> Result<MergedSourceGuard, RejectedSourceMerge> {
        let reserved = reservation
            .as_ref()
            .map(SourceReservation::usage)
            .unwrap_or_default();
        let mut merged = MergedSourceGuard {
            accounting: self.clone(),
            keys: candidate.keys,
            skill_count: candidate.skill_count,
            usage: candidate.usage,
            reservation,
            accounted: false,
        };
        if reserved != merged.usage {
            return Err(RejectedSourceMerge::new(
                LeaseError::UsageMismatch {
                    reserved,
                    candidate: merged.usage,
                },
                merged,
            ));
        }

        let mut state = self.lock();
        if merged
            .keys
            .iter()
            .any(|key| state.source_keys.contains(key))
        {
            drop(state);
            return Err(RejectedSourceMerge::new(
                LeaseError::DuplicateSource,
                merged,
            ));
        }
        let next = (|| {
            let next = BatchAccountingSnapshot {
                sources: state
                    .usage
                    .sources
                    .checked_add(1)
                    .ok_or(LeaseError::BatchSourcesExceeded)?,
                skills: state
                    .usage
                    .skills
                    .checked_add(merged.skill_count)
                    .ok_or(LeaseError::BatchSkillsExceeded)?,
                entries: state
                    .usage
                    .entries
                    .checked_add(merged.usage.entries)
                    .ok_or(LeaseError::BatchEntriesExceeded)?,
                bytes: state
                    .usage
                    .bytes
                    .checked_add(merged.usage.bytes)
                    .ok_or(LeaseError::BatchBytesExceeded)?,
            };
            if next.sources > MAX_SOURCES_PER_BATCH {
                return Err(LeaseError::BatchSourcesExceeded);
            }
            if next.skills > MAX_SKILLS_PER_BATCH {
                return Err(LeaseError::BatchSkillsExceeded);
            }
            if next.entries > MAX_ENTRIES_PER_BATCH {
                return Err(LeaseError::BatchEntriesExceeded);
            }
            if next.bytes > MAX_BYTES_PER_BATCH {
                return Err(LeaseError::BatchBytesExceeded);
            }
            Ok(next)
        })();
        let next = match next {
            Ok(next) => next,
            Err(error) => {
                drop(state);
                return Err(RejectedSourceMerge::new(error, merged));
            }
        };
        for key in &merged.keys {
            state.source_keys.insert(key.clone());
        }
        state.usage = next;
        merged.accounted = true;
        drop(state);
        Ok(merged)
    }

    fn lock(&self) -> MutexGuard<'_, BatchAccountingInner> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

#[derive(Debug)]
pub(crate) struct RejectedSourceMerge {
    error: LeaseError,
    candidate: MergedSourceGuard,
}

impl RejectedSourceMerge {
    fn new(error: LeaseError, candidate: MergedSourceGuard) -> Self {
        Self { error, candidate }
    }

    pub(crate) fn into_parts(self) -> (LeaseError, MergedSourceGuard) {
        (self.error, self.candidate)
    }
}

/// 批次状态层按来源持有 guard。取消、拒绝或异常丢弃时，先原子撤销批次用量，
/// 再由 `SourceReservation` 清理目录和释放配置级额度。
#[derive(Debug)]
pub(crate) struct MergedSourceGuard {
    accounting: BatchAccounting,
    keys: Vec<SourceKey>,
    skill_count: usize,
    usage: StagingUsage,
    reservation: Option<SourceReservation>,
    accounted: bool,
}

impl MergedSourceGuard {
    pub(crate) fn staging_root(&self) -> Option<&Path> {
        self.reservation
            .as_ref()
            .map(SourceReservation::staging_root)
    }

    /// 批次取消或迟到来源被拒绝时的显式清理入口。先撤销批次内记账，再执行
    /// 可能涉及文件系统与配置级文件锁的来源目录/配额清理；状态层因此可以在
    /// 释放批次 mutex 后调用本函数，而不依赖 `Drop` 的尽力而为语义。
    pub(crate) fn cleanup(mut self) -> Result<(), CleanupGuardError<Self>> {
        self.release_accounting();
        if let Some(reservation) = self.reservation.take() {
            if let Err(failure) = reservation.cleanup_owned() {
                let (error, reservation) = failure.into_parts();
                self.reservation = Some(reservation);
                return Err(CleanupGuardError::new(error, self));
            }
        }
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn clear_cleanup_error(&mut self) {
        if let Some(reservation) = &mut self.reservation {
            reservation.clear_cleanup_error();
        }
    }

    fn release_accounting(&mut self) {
        if !self.accounted {
            return;
        }
        let mut state = self.accounting.lock();
        state.usage.sources = state.usage.sources.saturating_sub(1);
        state.usage.skills = state.usage.skills.saturating_sub(self.skill_count);
        state.usage.entries = state.usage.entries.saturating_sub(self.usage.entries);
        state.usage.bytes = state.usage.bytes.saturating_sub(self.usage.bytes);
        for key in &self.keys {
            state.source_keys.remove(key);
        }
        self.accounted = false;
    }
}

impl Drop for MergedSourceGuard {
    fn drop(&mut self) {
        self.release_accounting();
        // 字段声明顺序保证批次账已撤销后才释放配置级 reservation。
        self.reservation.take();
    }
}

fn random_id() -> Result<String, LeaseError> {
    let mut bytes = [0u8; 24];
    getrandom::getrandom(&mut bytes).map_err(|error| LeaseError::io("生成不可预测标识", error))?;
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write as _;
        write!(&mut output, "{byte:02x}").expect("写入 String 不会失败");
    }
    Ok(output)
}

#[cfg(test)]
#[path = "lease_tests.rs"]
mod tests;
