//! 批量技能导入的公共契约与纯分析逻辑。
//!
//! `folder` 与 `archive` 分别实现安全文件夹/ZIP 枚举、发现与暂存，`state`
//! 提供不依赖 Tauri 的单实例批次状态机；命令编排由后续任务实现。

// 公共契约将在后续导入命令和状态机任务中逐步接线。
#![allow(dead_code)]

pub(crate) mod archive;
pub(crate) mod commands;
pub(crate) mod folder;
pub(crate) mod lease;
pub mod model;
pub(crate) mod state;
pub(crate) mod store;

use std::collections::HashMap;
use std::path::Path;

use model::{
    SkillImportItem, SkillImportRisk, SkillImportRiskKind, SkillImportSource,
    SkillImportSourceKind, SkillImportSourceStatus,
};

/// 尚未向 WebView 投影的来源信息。绝对路径只存在于这个不可序列化的壳侧
/// 输入中；转换后的 `SkillImportSource` 仅含末级显示名。
#[derive(Clone, Debug)]
pub(crate) struct SkillImportSourcePreviewInput {
    pub source_id: String,
    pub order: usize,
    pub kind: SkillImportSourceKind,
    pub source_path: std::path::PathBuf,
    pub status: SkillImportSourceStatus,
    pub skill_count: usize,
    pub error: Option<String>,
}

impl From<SkillImportSourcePreviewInput> for SkillImportSource {
    fn from(input: SkillImportSourcePreviewInput) -> Self {
        let display_name = source_display_name(&input.source_path);
        let error = input
            .error
            .map(|message| redact_source_path(&message, &input.source_path, &display_name));
        Self {
            source_id: input.source_id,
            order: input.order,
            kind: input.kind,
            display_name,
            status: input.status,
            skill_count: input.skill_count,
            error,
        }
    }
}

fn redact_source_path(message: &str, source_path: &Path, display_name: &str) -> String {
    let source = source_path.to_string_lossy();
    if source.is_empty() {
        return message.to_string();
    }
    message.replace(source.as_ref(), display_name)
}

/// 仅返回文件或末级目录名；根路径等没有末级名称的输入返回空字符串。
pub fn source_display_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// 将壳侧来源路径投影为技能预览显示名，不在可序列化模型中保留原始路径。
pub fn with_source_display_name(mut item: SkillImportItem, source_path: &Path) -> SkillImportItem {
    let display_name = source_display_name(source_path);
    item.last_error = item
        .last_error
        .map(|message| redact_source_path(&message, source_path, &display_name));
    item.source_display_name = display_name;
    item
}

/// `scripts/` 下的文件、带平台可执行标记的文件以及常见脚本扩展名均视为
/// 可执行内容。调用方只应对普通文件调用本函数。
pub fn is_executable_file(relative_path: &str, platform_executable: bool) -> bool {
    if platform_executable {
        return true;
    }
    let normalized = relative_path.replace('\\', "/");
    let components: Vec<_> = normalized.split('/').collect();
    if components.len() > 1
        && components[..components.len() - 1]
            .iter()
            .any(|component| component.eq_ignore_ascii_case("scripts"))
    {
        return true;
    }
    let extension = components
        .last()
        .copied()
        .unwrap_or_default()
        .rsplit_once('.');
    extension.is_some_and(|(_, extension)| {
        matches!(
            extension.to_ascii_lowercase().as_str(),
            "sh" | "bash"
                | "zsh"
                | "fish"
                | "ps1"
                | "bat"
                | "cmd"
                | "com"
                | "exe"
                | "msi"
                | "py"
                | "pl"
                | "rb"
                | "php"
                | "js"
                | "mjs"
                | "cjs"
                | "ts"
        )
    })
}

/// 从 SKILL.md 声明及已识别的可执行路径生成稳定、去重的风险列表。
pub fn analyze_skill_risks(skill_md: &str, executable_paths: &[String]) -> Vec<SkillImportRisk> {
    let mut risks = Vec::new();
    if !executable_paths.is_empty() {
        let mut paths = executable_paths.to_vec();
        paths.sort();
        paths.dedup();
        risks.push(SkillImportRisk {
            kind: SkillImportRiskKind::ExecutableContent,
            paths,
        });
    }

    let declarations: &[(SkillImportRiskKind, &[&str])] = &[
        (
            SkillImportRiskKind::Tools,
            &["tool", "tools", "allowed-tools"],
        ),
        (SkillImportRiskKind::Scripts, &["script", "scripts"]),
        (SkillImportRiskKind::Hooks, &["hook", "hooks"]),
        (SkillImportRiskKind::Mcp, &["mcp", "mcp-servers"]),
        (SkillImportRiskKind::Network, &["network", "http", "https"]),
    ];
    for (kind, words) in declarations {
        if words
            .iter()
            .any(|word| contains_ascii_token(skill_md, word))
        {
            risks.push(SkillImportRisk {
                kind: *kind,
                paths: Vec::new(),
            });
        }
    }
    risks
}

fn contains_ascii_token(text: &str, needle: &str) -> bool {
    text.split(|character: char| !character.is_ascii_alphanumeric() && character != '-')
        .any(|token| token.eq_ignore_ascii_case(needle))
}

/// 来源按加入顺序稳定排序；ID 仅作为异常重复 order 时的确定性兜底。
pub fn sort_import_sources(sources: &mut [SkillImportSource]) {
    sources.sort_by(|left, right| {
        left.order
            .cmp(&right.order)
            .then_with(|| left.source_id.cmp(&right.source_id))
    });
}

/// 技能按来源加入顺序、来源内规范相对路径排序。未知来源排在已知来源之后，
/// `item_id` 只用于重复路径时保持跨运行结果确定。
pub fn sort_import_items(items: &mut [SkillImportItem], sources: &[SkillImportSource]) {
    let source_orders: HashMap<&str, usize> = sources
        .iter()
        .map(|source| (source.source_id.as_str(), source.order))
        .collect();
    items.sort_by(|left, right| {
        source_orders
            .get(left.source_id.as_str())
            .copied()
            .unwrap_or(usize::MAX)
            .cmp(
                &source_orders
                    .get(right.source_id.as_str())
                    .copied()
                    .unwrap_or(usize::MAX),
            )
            .then_with(|| left.relative_root.cmp(&right.relative_root))
            .then_with(|| left.item_id.cmp(&right.item_id))
    });
    for (order, item) in items.iter_mut().enumerate() {
        item.order = order;
    }
}

#[cfg(test)]
mod tests;
