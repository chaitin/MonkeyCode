# 设计资源 v30 发布包验证基线

本文记录用户提供的 `release.zip.001` 的离线验证结果，作为 [设计资源导入实施方案](design-resource-import-plan.md) 的输入。仅验证文件与契约数据，不表示 MonkeyAI 已支持设计导入，也不表示数据库、S3、HTTP 或 Desktop 联调已完成。

## 1. 样本身份

原包位于本次评估环境的 Downloads 目录，未提交到 Git。后续使用包字节 SHA 识别同一样本，不依赖用户目录或文件名。

| 项目 | 实际值 |
| --- | --- |
| 文件名 | `release.zip.001` |
| 文件字节数 | `288714449`，约 275.34 MiB |
| 文件 SHA-256 | `f914fb340d81ee591e98f32b0d62ddc4f0dffb0ef6bbc7a3f088c06c172838bd` |
| publisher_id | `2de5ff13-0471-430e-9b95-0f0c89899408` |
| publisher.name | `monkeyai-respub` |
| release_id | `0ad61800-2289-491f-b8c6-ce27ee1c10f1` |
| version | `30` |
| design schema_version | `1` |
| digest_schema | `design-content-v1` |

这个 `.001` 文件本身具备完整 ZIP 中央目录，可以独立读取，不需要后续分卷。此结论只适用于本 SHA 对应的样本，不能据此将所有 `.001` 文件视为完整包；后续上传仍使用既有分卷封存与完整性检查流程。

## 2. 规模与分区

| 项目 | 数量 |
| --- | ---: |
| 外包 ZIP 条目 | 598 |
| 外包累计展开字节 | 294536590 |
| 外包最大单文件字节 | 23790984 |
| CHECKSUMS.sha256 条目 | 597 |
| 模板 | 219：110 个 bundle、109 个 prompt |
| 设计系统 | 152 |
| 风格 | 96 |
| 方向 | 5 |
| 设计资源总数 | 472 |
| 模板/系统嵌套 ZIP | 371 |
| 嵌套 ZIP 合计条目 | 5358 |
| 嵌套 ZIP 合计展开字节 | 289017485 |
| 嵌套 ZIP 最大单包条目 | 142 |
| 嵌套 ZIP 最大单包展开字节 | 24968571 |
| 模板与系统源文件引用 | 4439 |
| 风格媒体文件引用 | 96 |
| taxonomy modes/categories | 8 / 72 |
| taxonomy mode_categories/resource_categories | 86 / 219 |

Agent 顶层清单有4个 Skill、2个 Rule、9个 Connector、1个 Expert。release.counts 中 skill=29，不能直接用顶层 skills 数量判错：本轮没有完整解析 Expert 的 Agent 依赖，也没有验证 Agent 导入结果。设计校验覆盖外包 Agent 文件的字节完整性，但不意味着其业务语义已验收。

外包598条未触及现有5000条限制；嵌套合计5358条已经超过5000，但单包最大仅142条。应分别设置外包/单个嵌套包条目限制，另设整次导入展开字节、磁盘与并发预算，不应把5000误用成所有层级条目总和。

## 3. 已实际核验的结果

- [x] 外包全部598个文件可读取，ZIP CRC 可通过读取验证。
- [x] CHECKSUMS 的597条逐条 SHA 匹配，恰好覆盖除 CHECKSUMS 自身外的全部文件。
- [x] release/manifest/catalog 的发布者与 release_id 一致，release/manifest version 一致。
- [x] manifest 的472个设计产物与 catalog 的身份、artifact path/SHA、content_digest 声明逐条一致。
- [x] 371个嵌套 ZIP 全部读取；4439个模板/系统源文件引用按 catalog 逻辑路径和显式映射定位，SHA/size 全部一致。
- [x] 96个风格媒体文件按 `design/style-assets/<slug>/<files.path>` 定位，SHA/size 全部一致。
- [x] 110个资源提供源路径映射；两种映射表一致，目标存在；其余资源可按未映射逻辑路径直接读取。
- [x] 模板外置提示词/描述/示例恢复结果与 catalog 对应字段一致，262个非空字段完成本地文本恢复；152个系统正文与 catalog.content 一致。
- [x] `design/taxonomy.json` 与 catalog.taxonomy 解析后的内容一致，219个模板关联 ID 覆盖模板集合。
- [x] 472个资源按 kind/id/原始 metadata/按逻辑 path 排序的 files 投影进行 JCS 编码并计算 SHA，全部匹配 content_digest。

这是样本级验证，不覆盖生产导入器的限额、并发、数据库事务或 HTTP 行为。JCS 重算采用离线校验脚本与标准序列化规则，未在本次文档任务中接入生产 Go 校验器；M0 仍需对独立实现进行数字、Unicode、空值与集合边界互验。

## 4. 实际包与原方案的差异

### 4.1 嵌套摘要为空，files 缺 role

全部371个 `template.json` / `design-system.json` 的 `content_digest` 都是空字符串。它们的 files 与 catalog.files 的 path/sha256/size/mime 一致，但都没有 catalog 中的 role。

这属于发布层 DTO 与权威 catalog 的表示差异，不是文件损坏。导入规则应为：catalog 必须具备有效内容摘要并重算验证；嵌套摘要空/缺省可接受，非空必须匹配。files 按路径逐项比对，缺省 role 取 catalog 值，显式 role 冲突拒绝；不对两个完整 DTO 直接判等。

### 4.2 skillPath 不是可直接使用的逻辑源路径

全部219个模板的 metadata.skillPath 为 `SKILL.md`，它不直接出现在对应 catalog.files 中，但这219项分为两种情况：

| 模板类型 | 数量 | 语义 |
| --- | ---: | --- |
| bundle | 110 | has_skill=true，显式映射可唯一定位真实逻辑源路径 |
| prompt | 109 | has_skill=false，skillPath 是遗留默认值，不需要存在技能文件 |

bundle 样例 `aethera-hero`：

```text
metadata.skillPath = SKILL.md
catalog.files.path = catalog-template-aethera-hero/SKILL.md
source_file_paths["catalog-template-aethera-hero/SKILL.md"] = SKILL.md
ZIP 实际条目 = SKILL.md
```

恢复逻辑路径后，native ZIP 应包含 `catalog-template-aethera-hero/SKILL.md`。不能继续让 Desktop 把原 skillPath 当成 ZIP 根目录文件路径。

实施方案增加不参与摘要的 `source_skill_path` 详情字段：有技能时按精确逻辑路径或显式反向映射解析；无技能时为 null。这个新增协议尚待 M0 与 respub/Desktop 同步，不能声明现有上游 API 已返回该字段。原 metadata.skillPath 与业务摘要保持不变。

### 4.3 manifest 有两种不同的 SHA

| 摘要 | 值 |
| --- | --- |
| release/manifest 声明的 manifest_sha256 | `sha256:aafd1556a4b06a9c7e8686000672dfe99c60080bbebb0c1147d54f63b8a1acc8` |
| manifest.json 原始文件字节 SHA | `sha256:a51bb72b3e1cc5952246a24a0d0e8ad7d8113d08ab89ae80a12e69556594a8f2` |

本样本中，移除顶层 manifest_sha256 属性，保持其余 DTO 字段顺序，用紧凑 JSON、Go HTML/Unicode 特殊字符转义、无尾换行重新编码，能够复现声明摘要。仅将该字段设为空字符串不能得到相同结果。原始文件摘要则由 CHECKSUMS 校验。

这是已复现的样本行为；M0 仍需由上游生产 DTO 和冻结测试向量确定通用算法，不能用随机 map 编码、JCS 或原始文件 SHA 代替。

### 4.4 包内没有 catalog_rank

472个资源均未携带 catalog_rank。方案规定这类条目按 `(kind,catalog_id)` 稳定回退；新增秩字段时使用可空类型，避免把合法0与未提供混淆。此包不能验证有秩/无秩混排或重复秩行为。

## 5. 仍需补充的夹具与验收

本包没有提供可覆盖多源共享 archive_path、`._source` 避让冲突的样本；合法映射全部可恢复，不能替代反例测试。M0 还需构造：

- 多源共享归档条目但逻辑路径不同，以及任一路径 SHA/size 不符。
- 保留名避让、源占用避让目标、普通 `._source` 文件与历史显式 `.source/` 映射。
- 路径穿越、重复 ZIP 条目、文件/目录前缀冲突、悬空或不一致映射。
- 缺省/空值/Unicode/数字/集合顺序的摘要向量，metadata 与导出 DTO 混用的反例。
- 同 release 改变 taxonomy、排序或来源信息的冲突。
- 无技能默认 skillPath、有技能但文件不存在、反向映射歧义。

未执行的系统验收仍包括：数据库/S3 实际导入、确定性 native ZIP 生成与持久化、Range/HEAD/ETag、设备归属/JWT、分区幂等与部分成功、并发 current 激活、共享对象回收、断网 HTTP 读取和 Desktop 双源互验。原包的全量读取验证不能将这些任务标为通过。

## 6. 样本使用方式

普通测试只使用 M0 提交的小型冻结夹具。需要显式验证这个大包时，由本地环境提供文件路径并先核对本页 SHA；不要在代码或测试中硬编码 Downloads 路径，不自动联网下载，不把原包或真实凭据提交到仓库。

离线核验顺序固定为：外包路径/目录 → 全文件读取与 CHECKSUMS 双向覆盖 → 发布身份与产物引用 → catalog/taxonomy → 嵌套文件与显式映射 → 原逻辑路径下 SHA/size → JCS 业务摘要。读取 ZIP/JSON 中的内容不执行其中的代码或脚本。
