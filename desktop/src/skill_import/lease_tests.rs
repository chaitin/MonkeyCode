use super::*;

use std::io::{self, Write as _};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use crate::skill_import::archive::stage_archive_source_with_reservation;
use crate::skill_import::folder::{stage_folder_source_with_reservation, FolderBatchUsage};

static NEXT_TEST: AtomicU64 = AtomicU64::new(0);

struct TestConfig {
    root: PathBuf,
}

impl TestConfig {
    fn new(label: &str) -> Self {
        let id = NEXT_TEST.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "monkeycode-skill-lease-{label}-{}-{id}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir(&root).unwrap();
        Self { root }
    }

    fn instance(&self, entries: usize, bytes: u64) -> StagingInstance {
        StagingInstance::open_with_limits(&self.root, |_| false, QuotaLimits { entries, bytes })
            .unwrap()
    }
}

impl Drop for TestConfig {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn ledger_usage(config: &Path, limits: QuotaLimits) -> StagingUsage {
    LedgerStore::new(config, limits).usage().unwrap()
}

#[test]
fn reservation_is_incremental_atomic_and_raii_released() {
    let config = TestConfig::new("quota-raii");
    let instance = config.instance(3, 8);
    let mut source = instance.begin_source().unwrap();
    source.reserve_entries(2).unwrap();
    source.reserve_bytes(5).unwrap();
    assert_eq!(
        instance.config_usage().unwrap(),
        StagingUsage {
            entries: 2,
            bytes: 5
        }
    );

    let checkpoint = source.checkpoint();
    source.reserve_entries(1).unwrap();
    source.reserve_bytes(3).unwrap();
    assert_eq!(
        source.reserve_entries(1),
        Err(LeaseError::ConfigEntriesExceeded)
    );
    assert_eq!(
        source.reserve_bytes(1),
        Err(LeaseError::ConfigBytesExceeded)
    );
    assert_eq!(
        source.usage(),
        StagingUsage {
            entries: 3,
            bytes: 8
        }
    );
    source.rollback_to(checkpoint).unwrap();
    assert_eq!(
        source.usage(),
        StagingUsage {
            entries: 2,
            bytes: 5
        }
    );

    fs::create_dir(source.staging_root()).unwrap();
    fs::write(source.staging_root().join("partial"), b"12345").unwrap();
    let path = source.staging_root().to_path_buf();
    drop(source);
    assert!(!path.exists());
    assert_eq!(instance.config_usage().unwrap(), StagingUsage::default());
}

#[test]
fn source_cleanup_failure_keeps_ledger_reserved_until_delete_succeeds() {
    let config = TestConfig::new("cleanup-failure-keeps-quota");
    let instance = config.instance(1, 4);
    let mut first = instance.begin_source().unwrap();
    first.reserve_entries(1).unwrap();
    first.reserve_bytes(4).unwrap();
    fs::create_dir(first.staging_root()).unwrap();
    fs::write(first.staging_root().join("residual"), b"data").unwrap();

    let error = first
        .release_inner_with(&|_| Err(io::Error::new(io::ErrorKind::PermissionDenied, "injected")))
        .unwrap_err();
    assert!(matches!(error, LeaseError::CleanupFailed { .. }));
    assert_eq!(
        instance.config_usage().unwrap(),
        StagingUsage {
            entries: 1,
            bytes: 4
        }
    );
    assert!(first.staging_root().exists());

    let mut second = instance.begin_source().unwrap();
    assert_eq!(
        second.reserve_entries(1),
        Err(LeaseError::ConfigEntriesExceeded)
    );
    assert_eq!(
        second.reserve_bytes(4),
        Err(LeaseError::ConfigBytesExceeded)
    );
    drop(second);

    first.cleanup().unwrap();
    first.cleanup().unwrap(); // ownership release is idempotent; later Drop must not release twice.
    assert_eq!(instance.config_usage().unwrap(), StagingUsage::default());
}

#[test]
fn consuming_cleanup_failure_returns_guard_for_retry() {
    let config = TestConfig::new("consuming-cleanup-retry");
    let instance = config.instance(1, 4);
    let mut source = instance.begin_source().unwrap();
    source.reserve_entries(1).unwrap();
    source.reserve_bytes(4).unwrap();
    fs::create_dir(source.staging_root()).unwrap();
    fs::write(source.staging_root().join("residual"), b"data").unwrap();
    let path = source.staging_root().to_path_buf();

    let failure = source
        .cleanup_owned_with(&|_| Err(io::Error::new(io::ErrorKind::PermissionDenied, "injected")))
        .unwrap_err();
    let (error, source) = failure.into_parts();
    assert!(matches!(error, LeaseError::CleanupFailed { .. }));
    assert!(path.exists());
    assert_eq!(
        instance.config_usage().unwrap(),
        StagingUsage {
            entries: 1,
            bytes: 4,
        }
    );

    source.cleanup_owned().unwrap();
    assert!(!path.exists());
    assert_eq!(instance.config_usage().unwrap(), StagingUsage::default());
}

#[test]
fn folder_and_archive_stage_through_real_quota_interface() {
    let config = TestConfig::new("stage-integration");
    let instance = config.instance(100, 4096);

    let folder = config.root.join("folder-source");
    fs::create_dir(&folder).unwrap();
    fs::write(folder.join("SKILL.md"), b"folder").unwrap();
    fs::create_dir(folder.join("empty")).unwrap();
    let mut folder_reservation = instance.begin_source().unwrap();
    let mut usage = FolderBatchUsage::default();
    let staged =
        stage_folder_source_with_reservation(&folder, &mut usage, &mut folder_reservation).unwrap();
    assert_eq!(
        folder_reservation.usage(),
        StagingUsage {
            entries: staged.entry_count,
            bytes: staged.total_size,
        }
    );
    assert_eq!(staged.entry_count, 3);
    drop(folder_reservation);
    assert_eq!(instance.config_usage().unwrap(), StagingUsage::default());

    let archive = config.root.join("source.zip");
    let file = File::create(&archive).unwrap();
    let mut writer = zip::ZipWriter::new(file);
    writer
        .start_file("skill/SKILL.md", zip::write::SimpleFileOptions::default())
        .unwrap();
    writer.write_all(b"archive").unwrap();
    writer.finish().unwrap();
    let mut archive_reservation = instance.begin_source().unwrap();
    let mut usage = FolderBatchUsage::default();
    let staged =
        stage_archive_source_with_reservation(&archive, &mut usage, &mut archive_reservation)
            .unwrap();
    assert_eq!(
        archive_reservation.usage(),
        StagingUsage {
            entries: staged.entry_count,
            bytes: staged.total_size,
        }
    );
    drop(archive_reservation);
    assert_eq!(instance.config_usage().unwrap(), StagingUsage::default());
}

#[test]
fn merge_is_atomic_counts_failed_and_empty_and_releases_every_rejection() {
    let config = TestConfig::new("merge");
    let instance = config.instance(MAX_ENTRIES_PER_BATCH + 10, MAX_BYTES_PER_BATCH + 10);
    let batch = BatchAccounting::default();

    let failed = batch
        .merge(
            SourceMergeCandidate::failed_or_empty(SourceKey("failed".into())),
            None,
        )
        .unwrap();
    let empty = batch
        .merge(
            SourceMergeCandidate::failed_or_empty(SourceKey("empty".into())),
            None,
        )
        .unwrap();
    assert_eq!(batch.snapshot().sources, 2);

    let duplicate_before = batch.snapshot();
    assert!(matches!(
        batch.merge(
            SourceMergeCandidate::failed_or_empty(SourceKey("empty".into())),
            None
        ),
        Err(LeaseError::DuplicateSource)
    ));
    assert_eq!(batch.snapshot(), duplicate_before);

    let mut reservation = instance.begin_source().unwrap();
    reservation
        .reserve_entries(MAX_ENTRIES_PER_BATCH + 1)
        .unwrap();
    let path = reservation.staging_root().to_path_buf();
    fs::create_dir(&path).unwrap();
    let before = batch.snapshot();
    assert!(matches!(
        batch.merge(
            SourceMergeCandidate {
                keys: vec![SourceKey("too-many-entries".into())],
                skill_count: 0,
                usage: reservation.usage(),
            },
            Some(reservation),
        ),
        Err(LeaseError::BatchEntriesExceeded)
    ));
    assert_eq!(batch.snapshot(), before);
    assert!(!path.exists(), "被拒来源必须由 RAII 清理");
    assert_eq!(instance.config_usage().unwrap(), StagingUsage::default());

    drop(empty);
    drop(failed);
    assert_eq!(batch.snapshot(), BatchAccountingSnapshot::default());

    let mut guards = Vec::new();
    for index in 0..MAX_SOURCES_PER_BATCH {
        guards.push(
            batch
                .merge(
                    SourceMergeCandidate::failed_or_empty(SourceKey(format!("source-{index}"))),
                    None,
                )
                .unwrap(),
        );
    }
    let full = batch.snapshot();
    assert!(matches!(
        batch.merge(
            SourceMergeCandidate::failed_or_empty(SourceKey("overflow".into())),
            None
        ),
        Err(LeaseError::BatchSourcesExceeded)
    ));
    assert_eq!(batch.snapshot(), full);
    drop(guards);

    let hundred_skills = batch
        .merge(
            SourceMergeCandidate {
                keys: vec![SourceKey("hundred-skills".into())],
                skill_count: MAX_SKILLS_PER_BATCH,
                usage: StagingUsage::default(),
            },
            None,
        )
        .unwrap();
    let skills_full = batch.snapshot();
    assert!(matches!(
        batch.merge(
            SourceMergeCandidate {
                keys: vec![SourceKey("one-more-skill".into())],
                skill_count: 1,
                usage: StagingUsage::default(),
            },
            None,
        ),
        Err(LeaseError::BatchSkillsExceeded)
    ));
    assert_eq!(batch.snapshot(), skills_full);
    drop(hundred_skills);

    let mut bytes_reservation = instance.begin_source().unwrap();
    bytes_reservation
        .reserve_bytes(MAX_BYTES_PER_BATCH + 1)
        .unwrap();
    let before = batch.snapshot();
    assert!(matches!(
        batch.merge(
            SourceMergeCandidate {
                keys: vec![SourceKey("too-many-bytes".into())],
                skill_count: 0,
                usage: bytes_reservation.usage(),
            },
            Some(bytes_reservation),
        ),
        Err(LeaseError::BatchBytesExceeded)
    ));
    assert_eq!(batch.snapshot(), before);
    assert_eq!(instance.config_usage().unwrap(), StagingUsage::default());
}

#[test]
fn merged_source_holds_quota_until_batch_guard_is_dropped() {
    let config = TestConfig::new("merged-hold");
    let instance = config.instance(10, 10);
    let mut reservation = instance.begin_source().unwrap();
    reservation.reserve_entries(1).unwrap();
    reservation.reserve_bytes(4).unwrap();
    fs::create_dir(reservation.staging_root()).unwrap();
    fs::write(reservation.staging_root().join("x"), b"1234").unwrap();
    let canonical = SourceKey("canonical".into());
    let selection = SourceKey("selection".into());
    let batch = BatchAccounting::default();
    let merged = batch
        .merge(
            SourceMergeCandidate::staged(selection, canonical, 1, reservation.usage()),
            Some(reservation),
        )
        .unwrap();
    let staged_root = merged.staging_root().unwrap().to_path_buf();
    assert!(staged_root.exists());
    assert_eq!(
        instance.config_usage().unwrap(),
        StagingUsage {
            entries: 1,
            bytes: 4
        }
    );
    drop(merged);
    assert_eq!(batch.snapshot(), BatchAccountingSnapshot::default());
    assert_eq!(instance.config_usage().unwrap(), StagingUsage::default());
    assert!(!staged_root.exists());
}

#[test]
fn panic_cancel_and_usage_mismatch_all_release_source_reservation() {
    let config = TestConfig::new("all-failures");
    let instance = config.instance(10, 10);

    let result = std::panic::catch_unwind({
        let instance = instance.clone();
        move || {
            let mut reservation = instance.begin_source().unwrap();
            reservation.reserve_entries(2).unwrap();
            reservation.reserve_bytes(3).unwrap();
            fs::create_dir(reservation.staging_root()).unwrap();
            panic!("模拟后台异常");
        }
    });
    assert!(result.is_err());
    assert_eq!(instance.config_usage().unwrap(), StagingUsage::default());

    let mut mismatch = instance.begin_source().unwrap();
    mismatch.reserve_entries(1).unwrap();
    let path = mismatch.staging_root().to_path_buf();
    fs::create_dir(&path).unwrap();
    assert!(matches!(
        BatchAccounting::default().merge(
            SourceMergeCandidate::failed_or_empty(SourceKey("mismatch".into())),
            Some(mismatch)
        ),
        Err(LeaseError::UsageMismatch { .. })
    ));
    assert!(!path.exists());
    assert_eq!(instance.config_usage().unwrap(), StagingUsage::default());
}

#[test]
fn source_keys_cover_selection_and_stable_fingerprints() {
    let config = TestConfig::new("source-key");
    let nested = config.root.join("a").join("..").join("source.zip");
    let normalized = config.root.join("source.zip");
    assert_eq!(
        SourceKey::from_selection(SkillImportSourceKind::Zips, &nested).unwrap(),
        SourceKey::from_selection(SkillImportSourceKind::Zips, &normalized).unwrap()
    );
    assert_ne!(
        SourceKey::folder_identity(1, 2),
        SourceKey::archive_identity(1, 2, 0)
    );
}

fn spawn_helper(config: &Path, mode: &str, name: &str, entries: usize, bytes: u64) -> Child {
    Command::new(std::env::current_exe().unwrap())
        .arg("--exact")
        .arg("skill_import::lease::tests::multiprocess_helper")
        .arg("--nocapture")
        .env("MC_LEASE_HELPER_MODE", mode)
        .env("MC_LEASE_HELPER_CONFIG", config)
        .env("MC_LEASE_HELPER_NAME", name)
        .env("MC_LEASE_HELPER_ENTRIES", entries.to_string())
        .env("MC_LEASE_HELPER_BYTES", bytes.to_string())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap()
}

fn wait_for(path: &Path) {
    let deadline = Instant::now() + Duration::from_secs(15);
    while !path.exists() {
        assert!(Instant::now() < deadline, "等待 {} 超时", path.display());
        thread::sleep(Duration::from_millis(20));
    }
}

fn wait_success(mut child: Child) {
    let status = child.wait().unwrap();
    assert!(status.success(), "helper 退出状态 {status}");
}

#[test]
fn multiprocess_reservations_never_exceed_limit_and_active_lease_is_retained() {
    let config = TestConfig::new("multiprocess-concurrent");
    let start = config.root.join("start");
    let stop = config.root.join("stop");
    let mut left = spawn_helper(&config.root, "race", "left", 6, 1);
    let mut right = spawn_helper(&config.root, "race", "right", 6, 1);
    fs::write(&start, b"go").unwrap();
    wait_for(&config.root.join("left.result"));
    wait_for(&config.root.join("right.result"));
    wait_for(&config.root.join("left.instance"));
    wait_for(&config.root.join("right.instance"));
    let results = [
        fs::read_to_string(config.root.join("left.result")).unwrap(),
        fs::read_to_string(config.root.join("right.result")).unwrap(),
    ];
    assert_eq!(
        results
            .iter()
            .filter(|result| result.trim() == "ok")
            .count(),
        1
    );
    assert_eq!(
        results
            .iter()
            .filter(|result| result.trim() == "quota")
            .count(),
        1
    );
    let active_path = results
        .iter()
        .enumerate()
        .find(|(_, result)| result.trim() == "ok")
        .map(|(index, _)| {
            fs::read_to_string(config.root.join(if index == 0 {
                "left.instance"
            } else {
                "right.instance"
            }))
            .unwrap()
        })
        .unwrap();
    let active_path = PathBuf::from(active_path.trim());
    assert!(active_path.exists());

    // 第三个进程执行启动清理；活动 lease 必须保留，没有时间宽限参与判断。
    wait_success(spawn_helper(&config.root, "clean", "clean", 6, 1));
    assert!(active_path.exists());
    assert_eq!(
        ledger_usage(
            &config.root,
            QuotaLimits {
                entries: 6,
                bytes: 1
            }
        ),
        StagingUsage {
            entries: 6,
            bytes: 1
        }
    );

    fs::write(&stop, b"stop").unwrap();
    let left_status = left.wait().unwrap();
    let right_status = right.wait().unwrap();
    assert!(left_status.success() && right_status.success());
}

#[test]
fn multiprocess_byte_reservations_are_serialized_independently_of_entry_quota() {
    let config = TestConfig::new("multiprocess-bytes");
    let start = config.root.join("start");
    let stop = config.root.join("stop");
    let mut left = spawn_helper(&config.root, "race", "byte-left", 0, 6);
    let mut right = spawn_helper(&config.root, "race", "byte-right", 0, 6);
    fs::write(&start, b"go").unwrap();
    wait_for(&config.root.join("byte-left.result"));
    wait_for(&config.root.join("byte-right.result"));

    let results = [
        fs::read_to_string(config.root.join("byte-left.result")).unwrap(),
        fs::read_to_string(config.root.join("byte-right.result")).unwrap(),
    ];
    assert_eq!(
        results
            .iter()
            .filter(|result| result.trim() == "ok")
            .count(),
        1
    );
    assert_eq!(
        results
            .iter()
            .filter(|result| result.trim() == "quota")
            .count(),
        1
    );
    assert_eq!(
        ledger_usage(
            &config.root,
            QuotaLimits {
                entries: 0,
                bytes: 6,
            },
        ),
        StagingUsage {
            entries: 0,
            bytes: 6,
        }
    );

    fs::write(&stop, b"stop").unwrap();
    assert!(left.wait().unwrap().success());
    assert!(right.wait().unwrap().success());
}

#[test]
fn crashed_instance_is_reclaimed_immediately_but_transaction_is_exempt() {
    let config = TestConfig::new("multiprocess-crash");
    wait_success(spawn_helper(&config.root, "crash", "crash", 7, 9));
    let crashed = PathBuf::from(
        fs::read_to_string(config.root.join("crash.instance"))
            .unwrap()
            .trim(),
    );
    assert!(crashed.exists());
    assert_eq!(
        ledger_usage(
            &config.root,
            QuotaLimits {
                entries: 7,
                bytes: 9
            }
        ),
        StagingUsage {
            entries: 7,
            bytes: 9
        }
    );

    let protected = StagingInstance::open_with_limits(
        &config.root,
        |path| path == crashed,
        QuotaLimits {
            entries: 7,
            bytes: 9,
        },
    )
    .unwrap();
    assert!(crashed.exists(), "安装事务引用的孤儿必须豁免");
    assert_eq!(
        protected.config_usage().unwrap(),
        StagingUsage {
            entries: 7,
            bytes: 9
        }
    );
    drop(protected);

    let cleaner = config.instance(7, 9);
    assert!(!crashed.exists(), "lease 已释放的非事务孤儿应立即清理");
    assert_eq!(cleaner.config_usage().unwrap(), StagingUsage::default());
}

#[test]
fn failed_orphan_delete_keeps_quota_until_later_successful_reap() {
    let config = TestConfig::new("orphan-delete-retry");
    let limits = QuotaLimits {
        entries: 1,
        bytes: 4,
    };
    // 先保留一个活动实例，使验证者可在不触发自动 startup reap 的情况下尝试
    // 第二来源；崩溃 helper 是同配置目录中的另一个真实进程。
    let live = StagingInstance::open_with_limits(&config.root, |_| false, limits).unwrap();
    wait_success(spawn_helper(&config.root, "crash", "residual", 1, 4));
    let crashed = PathBuf::from(
        fs::read_to_string(config.root.join("residual.instance"))
            .unwrap()
            .trim(),
    );
    assert!(crashed.exists());

    let staging = config.root.join(STAGING_DIRECTORY);
    let error = live
        .inner
        .ledger
        .with_locked(|ledger| {
            cleanup_released_instances_with(&staging, ledger, &|_| false, &|path| {
                if path == crashed {
                    Err(io::Error::new(
                        io::ErrorKind::PermissionDenied,
                        "injected orphan cleanup failure",
                    ))
                } else {
                    fs::remove_dir_all(path)
                }
            })
        })
        .unwrap_err();
    assert!(matches!(error, LeaseError::CleanupFailed { .. }));
    assert!(crashed.exists());
    assert_eq!(
        live.config_usage().unwrap(),
        StagingUsage {
            entries: 1,
            bytes: 4
        }
    );

    let mut second = live.begin_source().unwrap();
    assert_eq!(
        second.reserve_entries(1),
        Err(LeaseError::ConfigEntriesExceeded)
    );
    assert_eq!(
        second.reserve_bytes(4),
        Err(LeaseError::ConfigBytesExceeded)
    );
    drop(second);

    live.inner
        .ledger
        .with_locked(|ledger| cleanup_released_instances(&staging, ledger, &|_| false))
        .unwrap();
    assert!(!crashed.exists());
    assert_eq!(live.config_usage().unwrap(), StagingUsage::default());

    let mut after_reap = live.begin_source().unwrap();
    after_reap.reserve_entries(1).unwrap();
    after_reap.reserve_bytes(4).unwrap();
    assert_eq!(
        live.config_usage().unwrap(),
        StagingUsage {
            entries: 1,
            bytes: 4
        }
    );
}

/// 由当前 Rust test binary 作为真正的第二个进程运行，覆盖 OS advisory lock，
/// 而不是用线程模拟文件锁。
#[test]
fn multiprocess_helper() {
    let Ok(mode) = std::env::var("MC_LEASE_HELPER_MODE") else {
        return;
    };
    let config = PathBuf::from(std::env::var_os("MC_LEASE_HELPER_CONFIG").unwrap());
    let name = std::env::var("MC_LEASE_HELPER_NAME").unwrap();
    let entries: usize = std::env::var("MC_LEASE_HELPER_ENTRIES")
        .unwrap()
        .parse()
        .unwrap();
    let bytes: u64 = std::env::var("MC_LEASE_HELPER_BYTES")
        .unwrap()
        .parse()
        .unwrap();
    let limits = QuotaLimits { entries, bytes };

    match mode.as_str() {
        "race" => {
            wait_for(&config.join("start"));
            let instance = StagingInstance::open_with_limits(&config, |_| false, limits).unwrap();
            let mut reservation = instance.begin_source().unwrap();
            let result = reservation
                .reserve_entries(entries)
                .and_then(|_| reservation.reserve_bytes(bytes));
            let value = match result {
                Ok(()) => "ok",
                Err(LeaseError::ConfigEntriesExceeded | LeaseError::ConfigBytesExceeded) => "quota",
                Err(error) => panic!("意外预留错误: {error}"),
            };
            fs::write(config.join(format!("{name}.result")), value).unwrap();
            fs::write(
                config.join(format!("{name}.instance")),
                instance.root().to_string_lossy().as_bytes(),
            )
            .unwrap();
            if value == "ok" {
                wait_for(&config.join("stop"));
            }
        }
        "crash" => {
            let instance = StagingInstance::open_with_limits(&config, |_| false, limits).unwrap();
            let mut reservation = instance.begin_source().unwrap();
            reservation.reserve_entries(entries).unwrap();
            reservation.reserve_bytes(bytes).unwrap();
            fs::create_dir(reservation.staging_root()).unwrap();
            fs::write(reservation.staging_root().join("staged"), b"data").unwrap();
            fs::write(
                config.join(format!("{name}.instance")),
                instance.root().to_string_lossy().as_bytes(),
            )
            .unwrap();
            std::process::exit(0);
        }
        "clean" => {
            let _instance = StagingInstance::open_with_limits(&config, |_| false, limits).unwrap();
        }
        other => panic!("未知 helper mode: {other}"),
    }
}
