use super::*;

use std::sync::atomic::{AtomicU64, Ordering};
use zip::write::SimpleFileOptions;
use zip::CompressionMethod;

static NEXT_TEST: AtomicU64 = AtomicU64::new(0);

struct TestArchive {
    root: PathBuf,
    zip: PathBuf,
    staging: PathBuf,
}

impl TestArchive {
    fn new(label: &str) -> Self {
        let id = NEXT_TEST.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "monkeycode-archive-import-{label}-{}-{id}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir(&root).unwrap();
        Self {
            zip: root.join(format!("{label}.zip")),
            staging: root.join("staging"),
            root,
        }
    }

    fn write(&self, entries: &[(&str, Option<&[u8]>)]) {
        self.write_with_compression(entries, CompressionMethod::Deflated);
    }

    fn write_stored(&self, entries: &[(&str, Option<&[u8]>)]) {
        self.write_with_compression(entries, CompressionMethod::Stored);
    }

    fn write_with_compression(
        &self,
        entries: &[(&str, Option<&[u8]>)],
        compression: CompressionMethod,
    ) {
        let file = File::create(&self.zip).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        for (name, content) in entries {
            if let Some(content) = content {
                writer
                    .start_file(
                        *name,
                        SimpleFileOptions::default().compression_method(compression),
                    )
                    .unwrap();
                writer.write_all(content).unwrap();
            } else {
                writer
                    .add_directory(
                        *name,
                        SimpleFileOptions::default().compression_method(CompressionMethod::Stored),
                    )
                    .unwrap();
            }
        }
        writer.finish().unwrap();
    }

    fn bytes(&self) -> Vec<u8> {
        fs::read(&self.zip).unwrap()
    }

    fn replace_bytes(&self, bytes: &[u8]) {
        fs::write(&self.zip, bytes).unwrap();
    }
}

impl Drop for TestArchive {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn small_limits() -> ArchiveLimits {
    ArchiveLimits {
        archive_bytes: 1024 * 1024,
        metadata_bytes: 64 * 1024,
        archive_entries: 100,
        entries_per_skill: 100,
        bytes_per_skill: 1024,
        bytes_per_file: 512,
        skill_md_bytes: 256,
        entries_per_batch: 100,
        bytes_per_batch: 4096,
        copy_buffer_bytes: 3,
    }
}

fn stage_with_limits(
    archive: &TestArchive,
    limits: ArchiveLimits,
) -> Result<(StagedArchiveSource, FolderBatchUsage), ArchiveImportError> {
    let mut usage = FolderBatchUsage::default();
    let result =
        stage_archive_source_inner(&archive.zip, &archive.staging, &mut usage, limits, None)?;
    Ok((result, usage))
}

fn signatures(bytes: &[u8], signature: u32) -> Vec<usize> {
    let needle = signature.to_le_bytes();
    bytes
        .windows(4)
        .enumerate()
        .filter_map(|(index, value)| (value == needle).then_some(index))
        .collect()
}

fn central_offsets(bytes: &[u8]) -> Vec<usize> {
    signatures(bytes, CENTRAL_SIGNATURE)
}

fn local_offsets(bytes: &[u8]) -> Vec<usize> {
    signatures(bytes, LOCAL_SIGNATURE)
}

fn eocd_offset(bytes: &[u8]) -> usize {
    *signatures(bytes, EOCD_SIGNATURE).last().unwrap()
}

fn put_u16(bytes: &mut [u8], offset: usize, value: u16) {
    bytes[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
}

fn put_u32(bytes: &mut [u8], offset: usize, value: u32) {
    bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}

fn put_u64(bytes: &mut [u8], offset: usize, value: u64) {
    bytes[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
}

fn enable_bit3_without_descriptor(bytes: &mut [u8]) {
    let central = central_offsets(bytes)[0];
    let local = local_offsets(bytes)[0];
    let central_flags = le_u16(&bytes[central + 8..central + 10]);
    let local_flags = le_u16(&bytes[local + 6..local + 8]);
    put_u16(bytes, central + 8, central_flags | 0x0008);
    put_u16(bytes, local + 6, local_flags | 0x0008);
    bytes[local + 14..local + 26].fill(0);
}

fn add_32_bit_data_descriptor(mut bytes: Vec<u8>, signed: bool, wrong_crc: bool) -> Vec<u8> {
    let central = central_offsets(&bytes)[0];
    let old_eocd = eocd_offset(&bytes);
    let local = local_offsets(&bytes)[0];
    let crc32 = le_u32(&bytes[central + 16..central + 20]);
    let compressed = le_u32(&bytes[central + 20..central + 24]);
    let uncompressed = le_u32(&bytes[central + 24..central + 28]);
    let name_len = le_u16(&bytes[local + 26..local + 28]) as usize;
    let extra_len = le_u16(&bytes[local + 28..local + 30]) as usize;
    let data_end = local + 30 + name_len + extra_len + compressed as usize;
    enable_bit3_without_descriptor(&mut bytes);

    let mut descriptor = Vec::new();
    if signed {
        descriptor.extend_from_slice(&DATA_DESCRIPTOR_SIGNATURE.to_le_bytes());
    }
    descriptor.extend_from_slice(&(crc32 ^ u32::from(wrong_crc)).to_le_bytes());
    descriptor.extend_from_slice(&compressed.to_le_bytes());
    descriptor.extend_from_slice(&uncompressed.to_le_bytes());
    let descriptor_len = descriptor.len();
    bytes.splice(data_end..data_end, descriptor);
    let new_eocd = old_eocd + descriptor_len;
    put_u32(&mut bytes, new_eocd + 16, (central + descriptor_len) as u32);
    bytes
}

fn add_zip64_data_descriptor(mut bytes: Vec<u8>) -> Vec<u8> {
    let original_central = central_offsets(&bytes)[0];
    let original_eocd = eocd_offset(&bytes);
    let original_central_size = le_u32(&bytes[original_eocd + 12..original_eocd + 16]);
    let local = local_offsets(&bytes)[0];
    let crc32 = le_u32(&bytes[original_central + 16..original_central + 20]);
    let compressed = le_u32(&bytes[original_central + 20..original_central + 24]) as u64;
    let uncompressed = le_u32(&bytes[original_central + 24..original_central + 28]) as u64;
    let local_name_len = le_u16(&bytes[local + 26..local + 28]) as usize;
    let local_extra_len = le_u16(&bytes[local + 28..local + 30]) as usize;
    let data_end = local + 30 + local_name_len + local_extra_len + compressed as usize;
    enable_bit3_without_descriptor(&mut bytes);
    put_u16(&mut bytes, local + 4, 45);

    let mut descriptor = Vec::with_capacity(24);
    descriptor.extend_from_slice(&DATA_DESCRIPTOR_SIGNATURE.to_le_bytes());
    descriptor.extend_from_slice(&crc32.to_le_bytes());
    descriptor.extend_from_slice(&compressed.to_le_bytes());
    descriptor.extend_from_slice(&uncompressed.to_le_bytes());
    let descriptor_len = descriptor.len();
    bytes.splice(data_end..data_end, descriptor);

    let central = original_central + descriptor_len;
    put_u16(&mut bytes, central + 6, 45);
    put_u32(&mut bytes, central + 20, u32::MAX);
    put_u32(&mut bytes, central + 24, u32::MAX);
    let central_name_len = le_u16(&bytes[central + 28..central + 30]) as usize;
    let old_extra_len = le_u16(&bytes[central + 30..central + 32]) as usize;
    put_u16(&mut bytes, central + 30, (old_extra_len + 20) as u16);
    let extra_end = central + 46 + central_name_len + old_extra_len;
    let mut zip64_extra = Vec::with_capacity(20);
    zip64_extra.extend_from_slice(&0x0001u16.to_le_bytes());
    zip64_extra.extend_from_slice(&16u16.to_le_bytes());
    zip64_extra.extend_from_slice(&uncompressed.to_le_bytes());
    zip64_extra.extend_from_slice(&compressed.to_le_bytes());
    bytes.splice(extra_end..extra_end, zip64_extra);

    let eocd = original_eocd + descriptor_len + 20;
    put_u32(&mut bytes, eocd + 12, original_central_size + 20);
    put_u32(&mut bytes, eocd + 16, central as u32);
    bytes
}

fn add_deflate_trailing_garbage(mut bytes: Vec<u8>) -> Vec<u8> {
    let central = central_offsets(&bytes)[0];
    let old_eocd = eocd_offset(&bytes);
    let local = local_offsets(&bytes)[0];
    let compressed = le_u32(&bytes[central + 20..central + 24]);
    let name_len = le_u16(&bytes[local + 26..local + 28]) as usize;
    let extra_len = le_u16(&bytes[local + 28..local + 30]) as usize;
    let data_end = local + 30 + name_len + extra_len + compressed as usize;
    bytes.insert(data_end, 0xa5);
    let new_central = central + 1;
    let new_eocd = old_eocd + 1;
    put_u32(&mut bytes, local + 18, compressed + 1);
    put_u32(&mut bytes, new_central + 20, compressed + 1);
    put_u32(&mut bytes, new_eocd + 16, new_central as u32);
    bytes
}

fn truncate_deflate_payload(mut bytes: Vec<u8>) -> Vec<u8> {
    let central = central_offsets(&bytes)[0];
    let old_eocd = eocd_offset(&bytes);
    let local = local_offsets(&bytes)[0];
    let compressed = le_u32(&bytes[central + 20..central + 24]);
    assert!(compressed > 1);
    let name_len = le_u16(&bytes[local + 26..local + 28]) as usize;
    let extra_len = le_u16(&bytes[local + 28..local + 30]) as usize;
    let data_end = local + 30 + name_len + extra_len + compressed as usize;
    bytes.remove(data_end - 1);
    let new_central = central - 1;
    let new_eocd = old_eocd - 1;
    put_u32(&mut bytes, local + 18, compressed - 1);
    put_u32(&mut bytes, new_central + 20, compressed - 1);
    put_u32(&mut bytes, new_eocd + 16, new_central as u32);
    bytes
}

fn corrupt_declared_crc(mut bytes: Vec<u8>) -> Vec<u8> {
    let central = central_offsets(&bytes)[0];
    let local = local_offsets(&bytes)[0];
    let crc32 = le_u32(&bytes[central + 16..central + 20]) ^ 1;
    put_u32(&mut bytes, central + 16, crc32);
    put_u32(&mut bytes, local + 14, crc32);
    bytes
}

fn rewrite_entry_name_encoding(bytes: &mut [u8], entry_index: usize, raw_name: &[u8], utf8: bool) {
    let central = central_offsets(bytes)[entry_index];
    let local = local_offsets(bytes)[entry_index];
    let central_name_len = le_u16(&bytes[central + 28..central + 30]) as usize;
    let local_name_len = le_u16(&bytes[local + 26..local + 28]) as usize;
    assert_eq!(central_name_len, raw_name.len());
    assert_eq!(local_name_len, raw_name.len());
    bytes[central + 46..central + 46 + raw_name.len()].copy_from_slice(raw_name);
    bytes[local + 30..local + 30 + raw_name.len()].copy_from_slice(raw_name);

    let update_flags = |flags: u16| {
        if utf8 {
            flags | 0x0800
        } else {
            flags & !0x0800
        }
    };
    let central_flags = le_u16(&bytes[central + 8..central + 10]);
    let local_flags = le_u16(&bytes[local + 6..local + 8]);
    put_u16(bytes, central + 8, update_flags(central_flags));
    put_u16(bytes, local + 6, update_flags(local_flags));
}

#[test]
fn one_zip_discovers_multiple_skills_in_stable_order_and_only_stages_skills() {
    let archive = TestArchive::new("multi");
    archive.write(&[
        ("outside.txt", Some(b"not staged")),
        ("z/SKILL.md", Some(b"z")),
        ("z/data.txt", Some(b"z-data")),
        (".claude/skills/a/SKILL.md", Some(b"a")),
        (".agents/skills/b/SKILL.md", Some(b"b")),
        (".ohmyagent/skills/c/SKILL.md", Some(b"c")),
    ]);

    let (staged, usage) = stage_with_limits(&archive, small_limits()).unwrap();
    assert_eq!(
        staged
            .skills
            .iter()
            .map(|skill| skill.relative_root.as_str())
            .collect::<Vec<_>>(),
        [
            ".agents/skills/b",
            ".claude/skills/a",
            ".ohmyagent/skills/c",
            "z"
        ]
    );
    assert!(!archive.staging.join("outside.txt").exists());
    assert!(archive.staging.join("z/data.txt").is_file());
    assert_eq!(staged.entry_count, usage.entries);
}

#[test]
fn virtual_root_uses_zip_stem_and_stops_nested_discovery() {
    let archive = TestArchive::new("virtual-root-name");
    archive.write(&[
        ("SKILL.md", Some(b"# root")),
        ("examples/nested/SKILL.md", Some(b"nested")),
    ]);

    let (staged, _) = stage_with_limits(&archive, small_limits()).unwrap();
    assert_eq!(staged.skills.len(), 1);
    assert_eq!(staged.skills[0].relative_root, ".");
    assert_eq!(staged.skills[0].fallback_name, "virtual-root-name");
    assert!(archive.staging.join("examples/nested/SKILL.md").is_file());
}

#[test]
fn nested_skill_hit_stops_descendants_but_keeps_sibling() {
    let archive = TestArchive::new("nested-stop");
    archive.write(&[
        ("outer/SKILL.md", Some(b"outer")),
        ("outer/examples/inner/SKILL.md", Some(b"inner")),
        ("sibling/SKILL.md", Some(b"sibling")),
        (".git/hidden/SKILL.md", Some(b"hidden")),
        ("__MACOSX/noise/SKILL.md", Some(b"noise")),
    ]);
    let (staged, _) = stage_with_limits(&archive, small_limits()).unwrap();
    assert_eq!(
        staged
            .skills
            .iter()
            .map(|skill| skill.relative_root.as_str())
            .collect::<Vec<_>>(),
        ["outer", "sibling"]
    );
    assert!(!archive.staging.join(".git").exists());
}

#[test]
fn every_excluded_directory_and_platform_metadata_entry_is_omitted_from_zip_staging() {
    let archive = TestArchive::new("all-exclusions");
    archive.write(&[
        (".git/hidden/SKILL.md", Some(b"hidden")),
        ("__MACOSX/hidden/SKILL.md", Some(b"hidden")),
        (".imports/hidden/SKILL.md", Some(b"hidden")),
        (".backups/hidden/SKILL.md", Some(b"hidden")),
        (".transactions/hidden/SKILL.md", Some(b"hidden")),
        ("visible/SKILL.md", Some(b"visible")),
        ("visible/.DS_Store", Some(b"metadata")),
        ("visible/._fork", Some(b"metadata")),
        ("visible/Thumbs.db", Some(b"metadata")),
    ]);

    let (staged, _) = stage_with_limits(&archive, small_limits()).unwrap();
    assert_eq!(
        staged
            .skills
            .iter()
            .map(|skill| skill.relative_root.as_str())
            .collect::<Vec<_>>(),
        ["visible"]
    );
    for omitted in [
        ".git",
        "__MACOSX",
        ".imports",
        ".backups",
        ".transactions",
        "visible/.DS_Store",
        "visible/._fork",
        "visible/Thumbs.db",
    ] {
        assert!(
            !archive.staging.join(omitted).exists(),
            "unexpected {omitted}"
        );
    }
}

#[test]
fn shared_wrapper_ancestors_count_once_and_skill_root_counts_as_entry() {
    let archive = TestArchive::new("shared-wrapper");
    archive.write(&[
        ("wrapper/shared/a/SKILL.md", Some(b"a")),
        ("wrapper/shared/b/SKILL.md", Some(b"b")),
    ]);
    let (staged, usage) = stage_with_limits(&archive, small_limits()).unwrap();
    assert_eq!(staged.skills[0].entry_count, 2);
    assert_eq!(staged.skills[1].entry_count, 2);
    assert_eq!(usage.entries, 6); // wrapper + shared + 两个技能根 + 两个文件
}

#[test]
fn zip_slip_absolute_drive_unc_empty_and_dot_components_are_rejected() {
    for (label, path) in [
        ("parent", "../escape/SKILL.md"),
        ("absolute", "/absolute/SKILL.md"),
        ("drive", "C:\\skills\\bad\\SKILL.md"),
        ("unc", "\\\\server\\share\\SKILL.md"),
        ("empty", "a//SKILL.md"),
        ("dot", "a/./SKILL.md"),
    ] {
        let archive = TestArchive::new(label);
        archive.write(&[(path, Some(b"x"))]);
        let error = stage_with_limits(&archive, small_limits()).unwrap_err();
        assert!(
            matches!(error, ArchiveImportError::UnsafeEntry { .. }),
            "{path}: {error}"
        );
        assert!(!archive.staging.exists());
    }
}

#[test]
fn nul_path_is_rejected_by_streaming_index() {
    let archive = TestArchive::new("nul");
    archive.write(&[("badx/SKILL.md", Some(b"x"))]);
    let mut bytes = archive.bytes();
    let central = central_offsets(&bytes)[0];
    let local = local_offsets(&bytes)[0];
    bytes[central + 46 + 3] = 0;
    bytes[local + 30 + 3] = 0;
    archive.replace_bytes(&bytes);
    let error = stage_with_limits(&archive, small_limits()).unwrap_err();
    assert!(matches!(error, ArchiveImportError::UnsafeEntry { .. }));
}

#[test]
fn cp437_cafe_auxiliary_file_is_decoded_and_imported_by_production_parser() {
    let archive = TestArchive::new("cp437-cafe");
    archive.write(&[
        ("skill/SKILL.md", Some(b"# cp437")),
        ("skill/cafx.txt", Some(b"coffee")),
    ]);
    let mut bytes = archive.bytes();
    rewrite_entry_name_encoding(&mut bytes, 1, b"skill/caf\x82.txt", false);
    archive.replace_bytes(&bytes);

    let (staged, usage) = stage_with_limits(&archive, small_limits()).unwrap();
    assert_eq!(staged.skills.len(), 1);
    assert_eq!(usage.skills, 1);
    assert_eq!(
        fs::read(archive.staging.join("skill/café.txt")).unwrap(),
        b"coffee"
    );
}

#[test]
fn bit11_with_invalid_utf8_name_is_strictly_rejected() {
    let archive = TestArchive::new("invalid-bit11-utf8");
    archive.write(&[
        ("skill/SKILL.md", Some(b"# utf8")),
        ("skill/badX.txt", Some(b"bad")),
    ]);
    let mut bytes = archive.bytes();
    rewrite_entry_name_encoding(&mut bytes, 1, b"skill/bad\xff.txt", true);
    archive.replace_bytes(&bytes);

    let error = stage_with_limits(&archive, small_limits()).unwrap_err();
    assert!(matches!(
        error,
        ArchiveImportError::UnsafeEntry {
            reason: "UTF-8 标志位已设置但路径不是有效 UTF-8",
            ..
        }
    ));
    assert!(!archive.staging.exists());
}

#[test]
fn dangerous_parent_path_is_rejected_after_cp437_decoding() {
    let archive = TestArchive::new("cp437-parent");
    archive.write(&[("cafx/xx/SKILL.md", Some(b"unsafe"))]);
    let mut bytes = archive.bytes();
    rewrite_entry_name_encoding(&mut bytes, 0, b"caf\x82/../SKILL.md", false);
    archive.replace_bytes(&bytes);

    let error = stage_with_limits(&archive, small_limits()).unwrap_err();
    assert!(matches!(error, ArchiveImportError::UnsafeEntry { .. }));
    assert!(!archive.staging.exists());
}

#[test]
fn symlink_and_special_unix_entries_reject_whole_zip() {
    for (label, file_type) in [("symlink", 0o120777u32), ("fifo", 0o010644u32)] {
        let archive = TestArchive::new(label);
        archive.write(&[
            ("skill/SKILL.md", Some(b"x")),
            ("skill/object", Some(b"target")),
        ]);
        let mut bytes = archive.bytes();
        let central = central_offsets(&bytes)[1];
        put_u16(&mut bytes, central + 4, (3 << 8) | 20);
        put_u32(&mut bytes, central + 38, file_type << 16);
        archive.replace_bytes(&bytes);
        let error = stage_with_limits(&archive, small_limits()).unwrap_err();
        assert!(matches!(error, ArchiveImportError::UnsafeEntry { .. }));
        assert!(!archive.staging.exists());
    }
}

#[test]
fn damaged_encrypted_and_unsupported_compression_are_structured_source_failures() {
    let damaged = TestArchive::new("damaged");
    damaged.replace_bytes(b"not a zip");
    assert!(matches!(
        stage_with_limits(&damaged, small_limits()).unwrap_err(),
        ArchiveImportError::MalformedArchive { .. }
    ));

    let encrypted = TestArchive::new("encrypted");
    encrypted.write(&[("skill/SKILL.md", Some(b"x"))]);
    let mut bytes = encrypted.bytes();
    let central = central_offsets(&bytes)[0];
    let local = local_offsets(&bytes)[0];
    let central_flags = le_u16(&bytes[central + 8..central + 10]);
    let local_flags = le_u16(&bytes[local + 6..local + 8]);
    put_u16(&mut bytes, central + 8, central_flags | 1);
    put_u16(&mut bytes, local + 6, local_flags | 1);
    encrypted.replace_bytes(&bytes);
    assert!(matches!(
        stage_with_limits(&encrypted, small_limits()).unwrap_err(),
        ArchiveImportError::EncryptedEntry { .. }
    ));

    let unsupported = TestArchive::new("unsupported");
    unsupported.write(&[("skill/SKILL.md", Some(b"x"))]);
    let mut bytes = unsupported.bytes();
    let central = central_offsets(&bytes)[0];
    let local = local_offsets(&bytes)[0];
    put_u16(&mut bytes, central + 10, 12);
    put_u16(&mut bytes, local + 8, 12);
    unsupported.replace_bytes(&bytes);
    assert!(matches!(
        stage_with_limits(&unsupported, small_limits()).unwrap_err(),
        ArchiveImportError::UnsupportedCompression { method: 12, .. }
    ));
}

#[test]
fn valid_signed_and_unsigned_data_descriptors_are_accepted() {
    for (label, signed) in [("descriptor-signed", true), ("descriptor-unsigned", false)] {
        let archive = TestArchive::new(label);
        archive.write(&[("skill/SKILL.md", Some(b"descriptor content"))]);
        archive.replace_bytes(&add_32_bit_data_descriptor(archive.bytes(), signed, false));
        let (staged, usage) = stage_with_limits(&archive, small_limits()).unwrap();
        assert_eq!(staged.skills.len(), 1);
        assert_eq!(usage.skills, 1);
        assert_eq!(
            fs::read(archive.staging.join("skill/SKILL.md")).unwrap(),
            b"descriptor content"
        );
    }

    let zip64 = TestArchive::new("descriptor-zip64");
    zip64.write(&[("skill/SKILL.md", Some(b"zip64 descriptor"))]);
    zip64.replace_bytes(&add_zip64_data_descriptor(zip64.bytes()));
    let (staged, usage) = stage_with_limits(&zip64, small_limits()).unwrap();
    assert_eq!(staged.skills.len(), 1);
    assert_eq!(usage.skills, 1);
    assert_eq!(
        fs::read(zip64.staging.join("skill/SKILL.md")).unwrap(),
        b"zip64 descriptor"
    );
}

#[test]
fn unsigned_descriptor_crc_equal_to_signature_is_not_misread_as_signed() {
    // CRC32([ac, 0a, 7a, d5]) == 0x08074b50，恰好等于可选 descriptor 签名。
    let archive = TestArchive::new("descriptor-crc-signature-collision");
    let collision = [0xac, 0x0a, 0x7a, 0xd5];
    archive.write(&[("skill/SKILL.md", Some(&collision))]);
    let bytes = archive.bytes();
    let central = central_offsets(&bytes)[0];
    assert_eq!(
        le_u32(&bytes[central + 16..central + 20]),
        DATA_DESCRIPTOR_SIGNATURE
    );
    archive.replace_bytes(&add_32_bit_data_descriptor(bytes, false, false));

    let (staged, usage) = stage_with_limits(&archive, small_limits()).unwrap();
    assert_eq!(staged.skills.len(), 1);
    assert_eq!(usage.skills, 1);
    assert_eq!(
        fs::read(archive.staging.join("skill/SKILL.md")).unwrap(),
        collision
    );
}

#[test]
fn missing_truncated_or_mismatched_data_descriptor_rejects_whole_zip() {
    let missing = TestArchive::new("descriptor-missing");
    missing.write(&[("skill/SKILL.md", Some(b"x"))]);
    let mut bytes = missing.bytes();
    enable_bit3_without_descriptor(&mut bytes);
    missing.replace_bytes(&bytes);
    assert!(matches!(
        stage_with_limits(&missing, small_limits()).unwrap_err(),
        ArchiveImportError::MalformedArchive { .. }
    ));
    assert!(!missing.staging.exists());

    let wrong = TestArchive::new("descriptor-wrong");
    wrong.write(&[("skill/SKILL.md", Some(b"x"))]);
    wrong.replace_bytes(&add_32_bit_data_descriptor(wrong.bytes(), true, true));
    assert!(matches!(
        stage_with_limits(&wrong, small_limits()).unwrap_err(),
        ArchiveImportError::MalformedArchive { .. }
    ));
    assert!(!wrong.staging.exists());

    let truncated = TestArchive::new("descriptor-truncated");
    truncated.write(&[("skill/SKILL.md", Some(b"x"))]);
    let mut bytes = add_32_bit_data_descriptor(truncated.bytes(), true, false);
    let central = central_offsets(&bytes)[0];
    bytes.drain(central - 3..central);
    let eocd = eocd_offset(&bytes);
    put_u32(&mut bytes, eocd + 16, (central - 3) as u32);
    truncated.replace_bytes(&bytes);
    assert!(matches!(
        stage_with_limits(&truncated, small_limits()).unwrap_err(),
        ArchiveImportError::MalformedArchive { .. }
    ));
    assert!(!truncated.staging.exists());
}

#[test]
fn archive_input_and_central_directory_exact_boundaries_are_accepted() {
    let archive = TestArchive::new("exact-index-limits");
    archive.write(&[("skill/SKILL.md", Some(b"x"))]);
    let bytes = archive.bytes();
    let eocd = eocd_offset(&bytes);
    let central_size = le_u32(&bytes[eocd + 12..eocd + 16]) as u64;
    let mut limits = small_limits();
    limits.archive_bytes = bytes.len() as u64;
    limits.metadata_bytes = central_size;
    limits.archive_entries = 1;

    let (staged, usage) = stage_with_limits(&archive, limits).unwrap();
    assert_eq!(staged.skills.len(), 1);
    assert_eq!(usage.skills, 1);
    fs::remove_dir_all(&archive.staging).unwrap();

    limits.archive_bytes -= 1;
    assert_eq!(
        stage_with_limits(&archive, limits).unwrap_err(),
        ArchiveImportError::SourceTooLarge
    );
    limits.archive_bytes += 1;
    limits.metadata_bytes -= 1;
    assert_eq!(
        stage_with_limits(&archive, limits).unwrap_err(),
        ArchiveImportError::MetadataTooLarge
    );
    limits.metadata_bytes += 1;
    limits.archive_entries = 0;
    assert_eq!(
        stage_with_limits(&archive, limits).unwrap_err(),
        ArchiveImportError::TooManyEntries
    );
}

#[test]
fn archive_metadata_entry_and_offset_limits_precede_zip_crate_index() {
    let archive = TestArchive::new("pre-index-limits");
    archive.write(&[("skill/SKILL.md", Some(b"x"))]);

    let mut limits = small_limits();
    limits.archive_bytes = 8;
    assert_eq!(
        stage_with_limits(&archive, limits).unwrap_err(),
        ArchiveImportError::SourceTooLarge
    );

    let mut limits = small_limits();
    limits.metadata_bytes = 10;
    assert_eq!(
        stage_with_limits(&archive, limits).unwrap_err(),
        ArchiveImportError::MetadataTooLarge
    );

    let mut limits = small_limits();
    limits.archive_entries = 0;
    assert_eq!(
        stage_with_limits(&archive, limits).unwrap_err(),
        ArchiveImportError::TooManyEntries
    );

    let mut bytes = archive.bytes();
    let eocd = eocd_offset(&bytes);
    put_u32(&mut bytes, eocd + 16, u32::MAX - 1);
    archive.replace_bytes(&bytes);
    assert!(matches!(
        stage_with_limits(&archive, small_limits()).unwrap_err(),
        ArchiveImportError::MalformedArchive { .. }
    ));
}

#[test]
fn invalid_eocd_signature_inside_comment_does_not_hide_earlier_real_eocd() {
    let archive = TestArchive::new("fake-eocd-comment");
    archive.write(&[("skill/SKILL.md", Some(b"x"))]);
    let mut bytes = archive.bytes();
    let real_eocd = eocd_offset(&bytes);
    put_u16(&mut bytes, real_eocd + 20, 30);
    let mut comment = vec![0u8; 30];
    put_u32(&mut comment, 0, EOCD_SIGNATURE);
    put_u16(&mut comment, 4, 1); // 伪候选使用非法多磁盘字段。
    put_u16(&mut comment, 20, 8); // 仍精确延伸到文件末尾，必须继续向前搜索。
    bytes.extend_from_slice(&comment);
    archive.replace_bytes(&bytes);

    let (staged, usage) = stage_with_limits(&archive, small_limits()).unwrap();
    assert_eq!(staged.skills.len(), 1);
    assert_eq!(usage.skills, 1);
}

#[test]
fn boundary_valid_fake_eocd_with_oversized_central_falls_back_after_full_parse() {
    let archive = TestArchive::new("fake-eocd-central-consumption");
    archive.write(&[("skill/SKILL.md", Some(b"x"))]);
    let mut bytes = archive.bytes();
    let real_eocd = eocd_offset(&bytes);
    let count = le_u16(&bytes[real_eocd + 10..real_eocd + 12]);
    let central_offset = le_u32(&bytes[real_eocd + 16..real_eocd + 20]);
    put_u16(&mut bytes, real_eocd + 20, EOCD_BYTES as u16);

    let fake_offset = real_eocd + EOCD_BYTES as usize;
    let mut fake = vec![0u8; EOCD_BYTES as usize];
    put_u32(&mut fake, 0, EOCD_SIGNATURE);
    put_u16(&mut fake, 8, count);
    put_u16(&mut fake, 10, count);
    put_u32(&mut fake, 12, fake_offset as u32 - central_offset); // 边界恰好到伪 EOCD，但夹入真实 EOCD。
    put_u32(&mut fake, 16, central_offset);
    put_u16(&mut fake, 20, 0);
    bytes.extend_from_slice(&fake);
    archive.replace_bytes(&bytes);

    let (staged, usage) = stage_with_limits(&archive, small_limits()).unwrap();
    assert_eq!(staged.skills.len(), 1);
    assert_eq!(usage.skills, 1);
}

#[test]
fn fully_parsed_fake_central_with_local_flag_mismatch_falls_back_to_real_eocd() {
    let archive = TestArchive::new("fake-eocd-local-mismatch");
    archive.write(&[("skill/SKILL.md", Some(b"x"))]);
    let mut bytes = archive.bytes();
    let real_eocd = eocd_offset(&bytes);
    let count = le_u16(&bytes[real_eocd + 10..real_eocd + 12]);
    let central_size = le_u32(&bytes[real_eocd + 12..real_eocd + 16]) as usize;
    let central_offset = le_u32(&bytes[real_eocd + 16..real_eocd + 20]) as usize;
    let mut fake_central = bytes[central_offset..central_offset + central_size].to_vec();
    let flags = le_u16(&fake_central[8..10]);
    assert_eq!(
        flags & 0x0800,
        0,
        "ASCII fixture 的真实 local/central 未设置 UTF-8 位"
    );
    put_u16(&mut fake_central, 8, flags | 0x0800);

    let real_comment_len = central_size + EOCD_BYTES as usize;
    put_u16(&mut bytes, real_eocd + 20, real_comment_len as u16);
    let fake_central_offset = bytes.len();
    bytes.extend_from_slice(&fake_central);
    let fake_eocd_offset = bytes.len();
    let mut fake_eocd = vec![0u8; EOCD_BYTES as usize];
    put_u32(&mut fake_eocd, 0, EOCD_SIGNATURE);
    put_u16(&mut fake_eocd, 8, count);
    put_u16(&mut fake_eocd, 10, count);
    put_u32(&mut fake_eocd, 12, central_size as u32);
    put_u32(&mut fake_eocd, 16, fake_central_offset as u32);
    bytes.extend_from_slice(&fake_eocd);
    archive.replace_bytes(&bytes);

    // 精确证明伪候选的外部边界和 central 完整解析均成功，只在 local 关联验证失败。
    let mut file = File::open(&archive.zip).unwrap();
    let fake_bounds = validate_eocd_candidate(
        &mut file,
        bytes.len() as u64,
        fake_eocd_offset as u64,
        &fake_eocd,
        small_limits(),
    )
    .unwrap();
    let mut fake_entries =
        parse_central_directory(&mut file, bytes.len() as u64, fake_bounds, small_limits())
            .unwrap();
    assert!(matches!(
        validate_local_headers(
            &mut file,
            bytes.len() as u64,
            fake_bounds,
            &mut fake_entries,
        ),
        Err(ArchiveImportError::MalformedArchive { .. })
    ));

    let (staged, usage) = stage_with_limits(&archive, small_limits()).unwrap();
    assert_eq!(staged.skills.len(), 1);
    assert_eq!(usage.skills, 1);
    assert_eq!(
        fs::read(archive.staging.join("skill/SKILL.md")).unwrap(),
        b"x"
    );
}

#[test]
fn declared_10001_entries_rejected_before_any_entry_vector_allocation() {
    let archive = TestArchive::new("entry-count");
    archive.write(&[("skill/SKILL.md", Some(b"x"))]);
    let mut bytes = archive.bytes();
    let eocd = eocd_offset(&bytes);
    put_u16(&mut bytes, eocd + 8, 10_001);
    put_u16(&mut bytes, eocd + 10, 10_001);
    archive.replace_bytes(&bytes);
    let error = stage_archive_source(
        &archive.zip,
        &archive.staging,
        &mut FolderBatchUsage::default(),
    )
    .unwrap_err();
    assert_eq!(error, ArchiveImportError::TooManyEntries);
}

#[test]
fn zip64_eocd_is_bounded_and_valid_small_zip64_is_accepted() {
    let archive = TestArchive::new("zip64");
    archive.write(&[("skill/SKILL.md", Some(b"x"))]);
    let original = archive.bytes();
    let old_eocd = eocd_offset(&original);
    let count = le_u16(&original[old_eocd + 10..old_eocd + 12]) as u64;
    let central_size = le_u32(&original[old_eocd + 12..old_eocd + 16]) as u64;
    let central_offset = le_u32(&original[old_eocd + 16..old_eocd + 20]) as u64;
    let mut zip64 = vec![0u8; 76];
    put_u32(&mut zip64, 0, ZIP64_EOCD_SIGNATURE);
    put_u64(&mut zip64, 4, 44);
    put_u16(&mut zip64, 12, 45);
    put_u16(&mut zip64, 14, 45);
    put_u64(&mut zip64, 24, count);
    put_u64(&mut zip64, 32, count);
    put_u64(&mut zip64, 40, central_size);
    put_u64(&mut zip64, 48, central_offset);
    put_u32(&mut zip64, 56, ZIP64_LOCATOR_SIGNATURE);
    put_u64(&mut zip64, 64, old_eocd as u64);
    put_u32(&mut zip64, 72, 1);

    let mut result = original[..old_eocd].to_vec();
    result.extend_from_slice(&zip64);
    let mut eocd = original[old_eocd..].to_vec();
    put_u16(&mut eocd, 8, u16::MAX);
    put_u16(&mut eocd, 10, u16::MAX);
    put_u32(&mut eocd, 12, u32::MAX);
    put_u32(&mut eocd, 16, u32::MAX);
    result.extend_from_slice(&eocd);
    archive.replace_bytes(&result);

    let (staged, _) = stage_with_limits(&archive, small_limits()).unwrap();
    assert_eq!(staged.skills.len(), 1);

    let mut invalid = result;
    let locator = old_eocd + 56;
    put_u64(&mut invalid, locator + 8, u64::MAX - 10);
    archive.replace_bytes(&invalid);
    assert!(matches!(
        stage_with_limits(&archive, small_limits()).unwrap_err(),
        ArchiveImportError::MalformedArchive { .. }
    ));
}

#[test]
fn duplicate_case_unicode_alias_and_file_prefix_conflicts_reject_entire_zip() {
    let cases: &[(&str, &[(&str, Option<&[u8]>)])] = &[
        (
            "case-alias",
            &[
                ("Skill/SKILL.md", Some(b"x")),
                ("skill/SKILL.md", Some(b"x")),
            ],
        ),
        (
            "unicode-alias",
            &[
                ("caf\u{e9}/SKILL.md", Some(b"x")),
                ("cafe\u{301}/SKILL.md", Some(b"x")),
            ],
        ),
        (
            "prefix",
            &[("node", Some(b"file")), ("node/SKILL.md", Some(b"x"))],
        ),
        (
            "implicit-case-ancestor",
            &[("Root/SKILL.md", Some(b"x")), ("root", Some(b"file"))],
        ),
        (
            "implicit-unicode-ancestor",
            &[
                ("caf\u{e9}/SKILL.md", Some(b"x")),
                ("cafe\u{301}", Some(b"file")),
            ],
        ),
    ];
    let duplicate = TestArchive::new("duplicate");
    duplicate.write(&[
        ("skill/SKILL.md", Some(b"x")),
        ("other/SKILL.md", Some(b"x")),
    ]);
    let mut bytes = duplicate.bytes();
    let centrals = central_offsets(&bytes);
    let locals = local_offsets(&bytes);
    let replacement = b"skill/SKILL.md";
    bytes[centrals[1] + 46..centrals[1] + 46 + replacement.len()].copy_from_slice(replacement);
    bytes[locals[1] + 30..locals[1] + 30 + replacement.len()].copy_from_slice(replacement);
    duplicate.replace_bytes(&bytes);
    assert!(matches!(
        stage_with_limits(&duplicate, small_limits()).unwrap_err(),
        ArchiveImportError::DuplicatePath { .. }
    ));

    for (label, entries) in cases {
        let archive = TestArchive::new(label);
        archive.write(entries);
        let error = stage_with_limits(&archive, small_limits()).unwrap_err();
        assert!(
            matches!(
                error,
                ArchiveImportError::DuplicatePath { .. }
                    | ArchiveImportError::TargetCollision { .. }
            ),
            "{label}: {error}"
        );
        assert!(!archive.staging.exists());
    }
}

#[test]
fn existing_target_is_never_overwritten_or_removed() {
    let archive = TestArchive::new("existing-target");
    archive.write(&[("skill/SKILL.md", Some(b"new"))]);
    fs::create_dir(&archive.staging).unwrap();
    fs::write(archive.staging.join("keep"), b"keep").unwrap();
    let error = stage_with_limits(&archive, small_limits()).unwrap_err();
    assert!(matches!(error, ArchiveImportError::TargetCollision { .. }));
    assert_eq!(fs::read(archive.staging.join("keep")).unwrap(), b"keep");
}

#[test]
fn exact_file_skill_manifest_and_batch_output_boundaries_are_accepted() {
    let archive = TestArchive::new("exact-output-limits");
    archive.write(&[
        ("skill/SKILL.md", Some(b"12345678")),
        ("skill/data.bin", Some(b"abcdefgh")),
    ]);
    let mut limits = small_limits();
    limits.bytes_per_file = 8;
    limits.skill_md_bytes = 8;
    limits.bytes_per_skill = 16;
    limits.entries_per_skill = 3;
    limits.entries_per_batch = 3;
    limits.bytes_per_batch = 16;

    let (staged, usage) = stage_with_limits(&archive, limits).unwrap();
    assert_eq!(staged.skills.len(), 1);
    assert!(staged.skills[0].invalid_reason.is_none());
    assert_eq!(staged.skills[0].entry_count, 3);
    assert_eq!(staged.skills[0].total_size, 16);
    assert_eq!(usage.entries, 3);
    assert_eq!(usage.bytes, 16);
}

#[test]
fn actual_output_limits_stop_compression_bomb_and_isolate_only_bad_skill() {
    let archive = TestArchive::new("output-limit");
    let bomb = vec![b'A'; 200];
    archive.write(&[
        ("a-bad/SKILL.md", Some(b"x")),
        ("a-bad/bomb.txt", Some(&bomb)),
        ("b-good/SKILL.md", Some(b"good")),
        ("b-good/data.txt", Some(b"ok")),
    ]);
    let mut limits = small_limits();
    limits.bytes_per_file = 32;
    limits.copy_buffer_bytes = 7;
    let (staged, usage) = stage_with_limits(&archive, limits).unwrap();
    assert!(staged.skills[0].invalid_reason.is_some());
    assert!(staged.skills[1].invalid_reason.is_none());
    assert!(!archive.staging.join("a-bad").exists());
    assert_eq!(
        fs::read(archive.staging.join("b-good/data.txt")).unwrap(),
        b"ok"
    );
    assert_eq!(usage.skills, 2, "无效技能也计入批次技能上限");
    assert_eq!(usage.bytes, 6);
}

#[test]
fn skill_md_skill_total_and_entry_limits_are_skill_local() {
    let archive = TestArchive::new("skill-limits");
    archive.write(&[
        ("a/SKILL.md", Some(b"123456789")),
        ("b/SKILL.md", Some(b"b")),
        ("b/one", Some(b"111111")),
        ("b/two", Some(b"222222")),
        ("c/SKILL.md", Some(b"c")),
        ("c/empty/", None),
        ("c/other/", None),
        ("c/third/", None),
        ("d/SKILL.md", Some(b"d")),
    ]);
    let mut limits = small_limits();
    limits.skill_md_bytes = 8;
    limits.bytes_per_skill = 10;
    limits.entries_per_skill = 4;
    let (staged, usage) = stage_with_limits(&archive, limits).unwrap();
    assert_eq!(usage.skills, 4);
    assert!(staged.skills[0]
        .invalid_reason
        .as_deref()
        .unwrap()
        .contains("SKILL.md"));
    assert!(staged.skills[1]
        .invalid_reason
        .as_deref()
        .unwrap()
        .contains("技能总大小"));
    assert!(staged.skills[2]
        .invalid_reason
        .as_deref()
        .unwrap()
        .contains("条目数"));
    assert!(staged.skills[3].invalid_reason.is_none());
    assert!(archive.staging.join("d/SKILL.md").is_file());
}

#[test]
fn skill_object_plan_stops_at_limit_plus_one_instead_of_indexing_all_declared_paths() {
    let archive = TestArchive::new("bounded-plan");
    let mut owned = vec![("skill/SKILL.md".to_string(), b"x".to_vec())];
    for index in 0..50 {
        owned.push((
            format!("skill/deep-{index}/nested-{index}/data"),
            b"x".to_vec(),
        ));
    }
    let borrowed = owned
        .iter()
        .map(|(name, content)| (name.as_str(), Some(content.as_slice())))
        .collect::<Vec<_>>();
    archive.write(&borrowed);
    let mut limits = small_limits();
    limits.entries_per_skill = 2;
    let (staged, usage) = stage_with_limits(&archive, limits).unwrap();
    assert_eq!(staged.skills[0].entry_count, 3);
    assert!(staged.skills[0].invalid_reason.is_some());
    assert_eq!(
        usage,
        FolderBatchUsage {
            skills: 1,
            ..FolderBatchUsage::default()
        }
    );
}

#[test]
fn archive_skill_batch_limit_rejects_before_staging_and_is_atomic_across_sources() {
    let many = TestArchive::new("101-skills");
    let owned = (0..101)
        .map(|index| (format!("skill-{index}/SKILL.md"), b"x".to_vec()))
        .collect::<Vec<_>>();
    let borrowed = owned
        .iter()
        .map(|(name, content)| (name.as_str(), Some(content.as_slice())))
        .collect::<Vec<_>>();
    many.write(&borrowed);
    let mut limits = small_limits();
    limits.archive_entries = 200;
    let mut usage = FolderBatchUsage::default();
    let error =
        stage_archive_source_inner(&many.zip, &many.staging, &mut usage, limits, None).unwrap_err();
    assert_eq!(error, ArchiveImportError::BatchSkillsExceeded);
    assert_eq!(usage, FolderBatchUsage::default());
    assert!(!many.staging.exists());

    let next = TestArchive::new("cross-source-skill-limit");
    next.write(&[("skill/SKILL.md", Some(b"x"))]);
    let mut usage = FolderBatchUsage {
        skills: MAX_SKILLS_PER_BATCH,
        entries: 11,
        bytes: 12,
    };
    let original = usage;
    let error =
        stage_archive_source_inner(&next.zip, &next.staging, &mut usage, small_limits(), None)
            .unwrap_err();
    assert_eq!(error, ArchiveImportError::BatchSkillsExceeded);
    assert_eq!(usage, original);
    assert!(!next.staging.exists());
}

#[test]
fn batch_byte_or_entry_limit_cleans_whole_source_and_preserves_usage() {
    let archive = TestArchive::new("batch-limit");
    archive.write(&[
        ("a/SKILL.md", Some(b"123456")),
        ("b/SKILL.md", Some(b"123456")),
    ]);
    let mut usage = FolderBatchUsage {
        skills: 5,
        entries: 7,
        bytes: 0,
    };
    let mut limits = small_limits();
    limits.bytes_per_batch = 10;
    let error =
        stage_archive_source_inner(&archive.zip, &archive.staging, &mut usage, limits, None)
            .unwrap_err();
    assert_eq!(error, ArchiveImportError::BatchBytesExceeded);
    assert_eq!(
        usage,
        FolderBatchUsage {
            skills: 5,
            entries: 7,
            bytes: 0
        }
    );
    assert!(!archive.staging.exists());

    let mut usage = FolderBatchUsage {
        skills: 6,
        entries: 1,
        bytes: 2,
    };
    let mut limits = small_limits();
    limits.entries_per_batch = 4;
    let error =
        stage_archive_source_inner(&archive.zip, &archive.staging, &mut usage, limits, None)
            .unwrap_err();
    assert_eq!(error, ArchiveImportError::BatchEntriesExceeded);
    assert_eq!(
        usage,
        FolderBatchUsage {
            skills: 6,
            entries: 1,
            bytes: 2
        }
    );
    assert!(!archive.staging.exists());
}

#[test]
fn cleanup_failure_is_observable_preserves_staging_and_does_not_update_usage() {
    let archive = TestArchive::new("cleanup-failure");
    archive.write(&[
        ("a/SKILL.md", Some(b"123456")),
        ("b/SKILL.md", Some(b"123456")),
    ]);
    let staging = archive.staging.clone();
    let fail_root = staging.clone();
    let cleanup = move |path: &Path| {
        if path == fail_root {
            Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "injected cleanup failure",
            ))
        } else {
            Ok(())
        }
    };
    let mut usage = FolderBatchUsage::default();
    let mut limits = small_limits();
    limits.bytes_per_batch = 10;
    let error =
        stage_archive_source_inner(&archive.zip, &staging, &mut usage, limits, Some(&cleanup))
            .unwrap_err();
    assert!(matches!(error, ArchiveImportError::CleanupFailed { .. }));
    assert!(staging.exists(), "清理失败内容必须保留给后续 lease 回收");
    assert_eq!(usage, FolderBatchUsage::default());
    assert!(!error
        .to_string()
        .contains(archive.root.to_string_lossy().as_ref()));
}

#[test]
fn skill_cleanup_failure_is_observable_and_preserved() {
    let archive = TestArchive::new("skill-cleanup-failure");
    archive.write(&[
        ("bad/SKILL.md", Some(b"x")),
        ("bad/big", Some(b"123456789")),
        ("good/SKILL.md", Some(b"good")),
    ]);
    let cleanup = |path: &Path| {
        if path.ends_with("bad") {
            Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "injected skill cleanup failure",
            ))
        } else {
            Ok(())
        }
    };
    let mut usage = FolderBatchUsage::default();
    let mut limits = small_limits();
    limits.bytes_per_file = 8;
    let error = stage_archive_source_inner(
        &archive.zip,
        &archive.staging,
        &mut usage,
        limits,
        Some(&cleanup),
    )
    .unwrap_err();
    assert!(matches!(error, ArchiveImportError::CleanupFailed { .. }));
    assert!(archive.staging.exists());
    assert_eq!(usage, FolderBatchUsage::default());
}

#[test]
fn source_handle_change_after_index_rejects_whole_zip_without_usage_update() {
    let archive = TestArchive::new("source-change");
    archive.write(&[("skill/SKILL.md", Some(b"original"))]);
    let source = archive.zip.clone();
    let hook = || {
        let mut file = OpenOptions::new().append(true).open(&source).unwrap();
        file.write_all(b"changed").unwrap();
        file.flush().unwrap();
    };
    let mut usage = FolderBatchUsage::default();
    let error = stage_archive_source_inner_with_hook(
        &archive.zip,
        &archive.staging,
        &mut usage,
        small_limits(),
        None,
        Some(&hook),
    )
    .unwrap_err();
    assert_eq!(error, ArchiveImportError::SourceChanged);
    assert_eq!(usage, FolderBatchUsage::default());
    assert!(!archive.staging.exists());
}

#[test]
fn selected_source_path_replacement_is_detected_and_staged_source_is_cleaned() {
    let archive = TestArchive::new("source-replacement");
    archive.write(&[("skill/SKILL.md", Some(b"original"))]);
    let source = archive.zip.clone();
    let replacement = archive.root.join("replacement.zip");
    let hook = || {
        fs::copy(&source, &replacement).unwrap();
        fs::rename(&replacement, &source).unwrap();
    };
    let mut usage = FolderBatchUsage::default();
    let error = stage_archive_source_inner_with_hook(
        &archive.zip,
        &archive.staging,
        &mut usage,
        small_limits(),
        None,
        Some(&hook),
    )
    .unwrap_err();
    assert_eq!(error, ArchiveImportError::SourceChanged);
    assert_eq!(usage, FolderBatchUsage::default());
    assert!(!archive.staging.exists());
}

#[test]
fn corrupted_deflate_stream_rejects_and_cleans_whole_source() {
    let archive = TestArchive::new("crc-corrupt");
    archive.write(&[("skill/SKILL.md", Some(b"some content to compress"))]);
    let mut bytes = archive.bytes();
    let local = local_offsets(&bytes)[0];
    let name_len = le_u16(&bytes[local + 26..local + 28]) as usize;
    let extra_len = le_u16(&bytes[local + 28..local + 30]) as usize;
    let data = local + 30 + name_len + extra_len;
    bytes[data] ^= 0x7f;
    archive.replace_bytes(&bytes);
    let error = stage_with_limits(&archive, small_limits()).unwrap_err();
    assert!(matches!(error, ArchiveImportError::MalformedArchive { .. }));
    assert!(!archive.staging.exists());
}

#[test]
fn store_entry_is_streamed_from_verified_data_offset() {
    let archive = TestArchive::new("stored-entry");
    archive.write_stored(&[
        ("skill/SKILL.md", Some(b"stored skill")),
        ("skill/data.bin", Some(b"stored payload")),
    ]);
    let (staged, usage) = stage_with_limits(&archive, small_limits()).unwrap();
    assert_eq!(staged.skills.len(), 1);
    assert_eq!(usage.skills, 1);
    assert_eq!(
        fs::read(archive.staging.join("skill/data.bin")).unwrap(),
        b"stored payload"
    );
}

#[test]
fn deflate_truncation_trailing_garbage_and_crc_mismatch_reject_whole_source() {
    for (label, mutate) in [
        (
            "deflate-truncated",
            truncate_deflate_payload as fn(Vec<u8>) -> Vec<u8>,
        ),
        ("deflate-trailing", add_deflate_trailing_garbage),
        ("deflate-crc", corrupt_declared_crc),
    ] {
        let archive = TestArchive::new(label);
        archive.write(&[(
            "skill/SKILL.md",
            Some(b"content long enough to exercise strict deflate validation"),
        )]);
        archive.replace_bytes(&mutate(archive.bytes()));
        let error = stage_with_limits(&archive, small_limits()).unwrap_err();
        assert!(
            matches!(error, ArchiveImportError::MalformedArchive { .. }),
            "{label}: {error}"
        );
        assert!(!archive.staging.exists());
    }
}

#[test]
fn path_depth_and_windows_target_aliases_are_rejected() {
    let exact = (0..63)
        .map(|index| format!("d{index}"))
        .collect::<Vec<_>>()
        .join("/");
    let exact_archive = TestArchive::new("depth-exact");
    exact_archive.write(&[(format!("{exact}/SKILL.md").as_str(), Some(b"x"))]);
    let (staged, _) = stage_with_limits(&exact_archive, small_limits()).unwrap();
    assert_eq!(staged.skills.len(), 1);

    let deep = (0..65)
        .map(|index| format!("d{index}"))
        .collect::<Vec<_>>()
        .join("/");
    let archive = TestArchive::new("depth");
    archive.write(&[(format!("{deep}/SKILL.md").as_str(), Some(b"x"))]);
    assert!(matches!(
        stage_with_limits(&archive, small_limits()).unwrap_err(),
        ArchiveImportError::PathTooDeep { .. }
    ));

    for (label, path) in [
        ("trailing-dot", "skill./SKILL.md"),
        ("reserved", "CON/SKILL.md"),
        ("ads", "skill:name/SKILL.md"),
    ] {
        let archive = TestArchive::new(label);
        archive.write(&[(path, Some(b"x"))]);
        assert!(matches!(
            stage_with_limits(&archive, small_limits()).unwrap_err(),
            ArchiveImportError::UnsafeEntry { .. }
        ));
    }
}

#[test]
fn errors_and_internal_serializable_contract_never_expose_absolute_source_path() {
    let archive = TestArchive::new("redaction");
    archive.replace_bytes(b"bad");
    let error = stage_with_limits(&archive, small_limits()).unwrap_err();
    assert!(!error
        .to_string()
        .contains(archive.root.to_string_lossy().as_ref()));
    let source = include_str!("archive.rs");
    assert!(!source.contains("derive(Serialize"));
}

#[test]
fn parser_has_no_whole_archive_or_central_directory_read_to_end() {
    let source = include_str!("archive.rs");
    assert!(!source.contains("read_to_end"));
    assert!(
        !source.contains("zip::"),
        "生产解压不得让 ZIP crate 重扫索引"
    );
    assert!(source.contains("let index = index_archive"));
    assert!(source.contains("DeflateDecoder::new"));
    assert!(source.contains("entry.data_offset"));
    assert!(source.contains("MAX_EOCD_SEARCH_BYTES"));
    assert!(source.contains("remaining = bounds.size"));
}

#[test]
fn windows_backend_contract_uses_nt_parent_relative_open_and_read_only_sharing() {
    let source = include_str!("archive.rs");
    let start = source.find("// Windows 最终 ZIP 组件").unwrap();
    let end = source[start..]
        .find("#[cfg(not(any(unix, windows)))]")
        .map(|offset| start + offset)
        .unwrap();
    let backend = &source[start..end];
    for required in [
        "NtCreateFile",
        "RootDirectory",
        "FILE_OPEN_REPARSE_POINT",
        "FILE_TYPE_DISK",
        "FILE_SHARE_READ",
        "_parent: OwnedHandle",
    ] {
        assert!(
            backend.contains(required),
            "Windows 后端缺少安全语义: {required}"
        );
    }
    for forbidden in [
        "FILE_SHARE_WRITE",
        "FILE_SHARE_DELETE",
        "UnsupportedPlatformSafety",
    ] {
        assert!(
            !backend.contains(forbidden),
            "Windows 后端不得放宽或失败降级: {forbidden}"
        );
    }
}

#[cfg(windows)]
#[test]
fn windows_archive_import_succeeds_and_fixed_handle_denies_write_and_delete_sharing() {
    let archive = TestArchive::new("windows-safe-open");
    archive.write(&[("skill/SKILL.md", Some(b"x"))]);
    {
        let opened = platform::open_archive(&archive.zip).unwrap();
        assert!(OpenOptions::new().write(true).open(&archive.zip).is_err());
        assert!(fs::remove_file(&archive.zip).is_err());
        platform::verify_handle(&opened).unwrap();
    }
    let (staged, usage) = stage_with_limits(&archive, small_limits()).unwrap();
    assert_eq!(staged.skills.len(), 1);
    assert_eq!(usage.skills, 1);
}
