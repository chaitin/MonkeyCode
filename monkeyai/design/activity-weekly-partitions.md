# 计费交易与调用记录按周分区

迁移 `000032_billing_activity_weekly` 延续积分流水 `000029` 的周分区策略。覆盖 `billing_transactions`、`model_calls`、`mcp_tool_calls`、`image_calls`、`video_calls`。钱包记录、任务、周期账户和小时汇总不在本次改造范围。

## 时间与约束

交易、模型、工具、生图调用按 `started_at` 分区；视频调用按其现有的 `created_at` 分区。上海时区周一零点，左闭右开，分区名为 `<table>_YYYYMMDD`。预建当前及未来 8 周，DEFAULT 接收迟到、超前和维护未完成时的数据。ID 和分区时间不能更新；完成时间、用量、结算状态仍可更新。

每张事实表有独立的 `<table>_keys` 登记表，保存全局 ID 和分区时间。交易登记保留 `(user_id,category,idempotency_key)` 全局唯一性；生图、视频登记保留 `job_id` 和 `billing_transaction_id` 全局唯一性。登记表每个事实一行，也会随历史增长。事实主键为 `(id,分区时间)`；视频的 UPSERT 目标为 `(job_id,created_at)`，同时保持全局任务约束。

账本、钱包、任务等引用交易 ID 的外键在交易切换时改为引用交易登记表，继续阻止删除仍有关联的交易。历史外键使用 `NOT VALID` 重新挂接，避免在切换锁内再次全表扫描：旧数据此前由原外键保护，迁移已验证所有交易和登记笔数，新的写入立即受新外键约束。可在维护窗口通过 `ALTER TABLE ... VALIDATE CONSTRAINT ...` 补充数据库验证标志。

查询单笔交易先通过 `billing_activity_time` 用主键获取登记时间；回填未覆盖的历史 ID 从固定原表 OID 的 `<table>_original` 视图回退。回退仅在原关系仍占用正式表名时启用，以实际关系标识识别切换，避免旧事务快照继续把已切换的旧副本当作权威来源。切换后缺失的登记不会从旧快照补回，幂等查找及任务补齐也不再读取旧副本的身份、时间，防止已清理的交易重新被引用。查询以明确的时间定位分区；统计触发器读取交易、同步模型用量时也带上登记时间或受影响时间边界，避免每次调用遍历全部历史分区。幂等查询通过全局登记索引与带时间的 LATERAL 查询定位事实。原表和分区表均保留时间索引，避免回填每一批都扫描排序全表。

生图记录可能先由计费结算写入，再由异步任务补齐；后续写入沿用已登记的时间，避免任务与计费开始时间不同或跨周完成造成重复。视频写入沿用既有 ID/时间，新记录使用任务 ID 和任务创建时间，确保并发重复完成仍幂等。

## 准备、回填与切换

这是需要维护窗口的准备迁移：先停止旧后端及其他直接写入者，再运行迁移并部署新后端。准备阶段会为原表创建兼容的复合唯一索引及回填时间索引，预建历史周和未来周、影子表与事务内 INSERT/UPDATE/DELETE 镜像；**不会在迁移事务里复制全部事实**。原表索引创建及历史范围检查仍需读取历史数据，应按体量预留维护时间、空间和 WAL 容量。

分区及索引会增加 PostgreSQL 锁表容量需求，应结合连接数、分区数核对 `max_locks_per_transaction` 及共享内存。默认值 64 在本次并行运行完整迁移测试时不足，独立测试实例使用 512；生产准备迁移应在维护窗口串行执行，并按实际容量配置，不能把单表分区的锁预算直接用于五张表。

新后端启动独立维护 worker。每表使用 schema 范围的数据库事务 advisory lock 协调多副本，每批 1000 行、独立提交，有限的 `(source_end_at,source_end_id)` 水位和已提交游标支持重启续传。先完成交易切换，再回填、切换调用表；维护不阻塞钱包恢复和账户刷新循环。

原普通表在实际 INSERT/UPDATE 成功后的行触发器中登记，再进行镜像；被 `ON CONFLICT DO NOTHING` 忽略的插入不会留下无事实对应的登记。分区目标在 BEFORE 触发器中登记，以满足事实表的登记外键。更新未回填的历史行时按 OLD 核对身份，继续禁止改变 ID、分区时间及交易幂等身份。

这些事实可变，复制批次先锁定原表记录，再复制并比较完整行，防止并发删除被旧快照回填恢复，或用旧内容覆盖新状态。批次比较同时使用 ID 和分区时间，经 LATERAL 查询只访问对应周，避免每一行遍历全部历史分区。镜像递归标记按表隔离：计费状态触发模型 `usage_known` 更新时，嵌套的另一张表仍需镜像。

切换前在一个快照中比较两份完整事实及登记笔数，昂贵的校验放在 DDL 锁之前。随后用 NOWAIT 取得源、目标及必要引用表的锁；锁竞争使事务回滚重试。原表改名 `<table>_legacy`，目标获得正式表名。统计触发器（含语句级 transition table）随权威表移动，影子回填和旧副本不重复累加小时统计。切换后直接针对旧关系的写入返回 `40001`，调用方应结束旧事务后重试，不能继续向旧关系写入。

## 维护与观察

```sql
SELECT table_name, phase, source_end_at, source_end_id, cursor_at, cursor_id,
       checked_rows, switched_at, mirror_legacy
FROM billing_activity_partition_state ORDER BY table_name;
```

每 24 小时维护周分区，失败一分钟后重试。DEFAULT 的总积压以最多 10001 行检查；超过 10000 时停止自动 DDL并报警，避免长时间扫描与锁表。维护窗口可逐周迁移：

```sql
SELECT billing_create_activity_week('model_calls','2031-01-06 00:00:00+08',0);
```

物理迁移 DEFAULT 数据不会删除全局身份、反向镜像或重复修改小时统计。大批迁移后分析、清理 DEFAULT 分区。

五张表均切换且业务验证通过后，可显式停止旧副本镜像：

```sql
SELECT billing_finish_activity_observation();
```

返回 false 表示尚未全部切换或有锁竞争。该操作不删除旧副本；会移除只读旧副本的外键，防止其过时关联阻止权威调用表正常清理。之后的新记录不写旧副本，旧关系直接写入仍被拒绝。旧副本的备份、保留窗口及删除需另行制定，本实现不自动删除历史周、交易或账本。

可用如下查询观察实际容量（父表自身大小不包含全部子分区）：

```sql
SELECT s.table_name,s.phase,
       pg_size_pretty(pg_total_relation_size(s.source_relation)) AS original_or_legacy,
       pg_size_pretty((SELECT sum(pg_total_relation_size(p.relid))::bigint
                      FROM pg_partition_tree(s.target_relation) p)) AS partitions,
       pg_size_pretty(pg_total_relation_size(to_regclass(format('%I.%I',current_schema(),s.table_name||'_keys')))) AS identities
FROM billing_activity_partition_state s ORDER BY s.table_name;
```

分区改善时间范围查询及后续归档管理，不减少历史总容量。观察期间额外保留旧副本和登记表，磁盘与写放大需纳入容量评估。

## 回滚

停止新后端及全部直接写入者，在维护窗口运行 `down 1`，成功后部署匹配旧版本。回滚对所有源/目标关系使用 NOWAIT；无法取得锁则完整回滚 SQL 事务，不强行继续。

对已切换表，原子地用当前权威事实替换旧快照，既恢复观察期结束后的新增、修改，也移除权威表已清理的调用记录，避免复活会话清理数据。这个过程读取、重写历史，必须预留维护窗口和额外磁盘/WAL。恢复业务外键和原表名，并将统计触发器移回原表；物理恢复不重复修改汇总。未切换表继续保留原表权威事实。移除影子、登记、状态和迁移辅助对象，支持再次 up。
