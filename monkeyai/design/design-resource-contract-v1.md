# 设计资源包 v1 本地契约

实施进度见 [导入方案](design-resource-import-plan.md)，生产样本见 [v30 验证基线](design-resource-package-baseline.md)。本文件冻结 MonkeyAI 的本地校验行为；尚未获得 respub 生产验证器或 Desktop 的跨项目互验结果，不能视为联合契约已全部验收。

## 身份与摘要

- 设计 schema_version=1、digest_schema=design-content-v1。release.publisher.id、manifest.publisher_id、catalog.publisher_id 必须非空且一致，release_id 与 version 不得被导入方改写。
- CHECKSUMS.sha256 使用小写原始 SHA，按路径排序且双向覆盖全部外包文件，不含自身。嵌套 ZIP 的原始字节先通过该清单与 manifest/catalog artifact SHA 校验，再验证恢复后的文件。
- manifest_sha256 的投影完全移除顶层同名属性，保持发布 DTO 顺序，使用 Go JSON 紧凑编码与字符串转义；与 release 声明互验。该实现已验证 v30，其他生产 DTO 的互验待补。
- design-content-v1 投影只有 kind/id/metadata/files。metadata 保留原字段名、空值及数字表示语义，files 按 UTF-8 逻辑路径排序。使用固定版本的 RFC 8785 JCS 实现，不用 encoding/json 代替规范编码。
- metadata 白名单见实施方案 A.7；template.localizedPrompt 是语言到字符串，direction.localizedPrompt 是语言到结构化提示对象，不能共用字符串映射 DTO。author/colors 可为任意合法 JSON；可选结构字段 preview/card_preview/profile/metadata 允许 null。翻译对象、布尔、文本和计数字段不接受 null。必填字段由校验器按资源类型检查，其余缺省字段保持缺省，不写回展示默认值。
- JCS 拒绝重复 JSON 键、非法 UTF-8/代理项与非有限数字；整数文字超出 IEEE-754 精确整数范围拒绝，避免 Go 隐式舍入。结构化提示词、tokens、colors 和 profile 内数组保持原顺序；triggers/capabilities 按集合顺序计算摘要并拒绝重复元素，保留原 metadata 存储，不用排序后的值重写源业务字段。

## 源文件与发布层

catalog.files 是逻辑路径、SHA、size、MIME、role 的权威来源。嵌套 DTO 的 content_digest 可为空；非空时必须一致。嵌套 files 允许省略 role，其余字段必须逐路径一致，显式 role 冲突拒绝；catalog中的role缺省与显式空字符串保持区别，null不是有效role。

source_file_paths 与 source_file_refs 同时存在时必须一致；逻辑源路径唯一，两端都是安全相对路径，目标存在。不同源路径可以共享归档目标，分别核对源 SHA/size。普通未映射文件按原路径读取。保留名避让必须使用显式映射，不能猜包装前缀或按后缀删除普通源文件。

模板提示词与设计系统正文在导入时读取并与 catalog 完整文本比较。只把 catalog.files 中的已验证源文件保存为内容地址对象；发布层 template.json、design-system.json、外置提示词等不自动变成源文件。

新增详情解析字段 source_skill_path 不参与业务摘要：has_skill=false 时为 null；否则精确匹配逻辑路径，或由显式映射唯一反解。原 skillPath 保持原值。该字段仍须与 respub/Desktop 同步后联合验收。

## 限额与临时文件

外包2 GiB；ZIP条目数、元数据文件大小、嵌套包展开大小和累计保留的发布元数据不设独立上限，仍受整次导入展开字节预算约束；导入入口在拼接上传块/解析multipart之前取得最多2个并发预算。整次导入实际读取展开字节累计4 GiB。路径拒绝绝对路径、空段、点段、反斜杠、NUL及控制换行，拒绝重复 ZIP 条目、符号链接和文件/目录前缀冲突。逻辑文件按原路径校验，源数据流式写临时目录并按 SHA 复用；成功或失败均由调用方关闭包清理目录。请求取消中止读取。

## 固定夹具

`backend/testdata/design-contract/v1/release.zip` 是独立 Python/Node 生成器产出的微型冻结样本，包含 bundle、prompt、系统、风格媒体、方向、词表、保留名源文件、多源共享归档目标和普通 ._source。`canonical.json` 保存独立 JCS 测试向量，`catalog.json` 保存期望目录；SHA256SUMS 固定字节。普通测试不运行生成器，不调用线上资源，不从被测导入器生成期望值。

修改夹具需要显式运行 generate.py 并审查摘要差异；真实包只通过 MONKEYAI_DESIGN_FIXTURE_ZIP 显式启用，不提交原大包。剩余上游互验、Desktop 字段联调及系统故障验收继续在实施方案中保持未完成。
