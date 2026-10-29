# 轮次月分区与历史列表分页

`sessions` 保持普通表。迁移 34 将 `session_turns` 准备为按 `started_at` RANGE 分区的事实表，每个上海自然月一个子表，例如 `session_turns_2026_10` 的范围为 `[2026-10-01 00:00:00+08, 2026-11-01 00:00:00+08)`。跨月会话的轮次分别进入对应月份。

## 全局身份与外键

`session_turns_keys` 的主键是 `(session_id,turn_index)`，保存唯一的 `started_at`；另有包含时间的唯一约束。事实表主键按 `(session_id,started_at,turn_index)` 排列，以三列组合外键绑定登记表，因此同一轮次不能在不同月份重复存在。登记表仍随历史增长，分区不减少总数据量。

工具、技能事件的轮次外键在切换时改为指向登记表，保留原有 `ON DELETE CASCADE` 语义。事实、登记与关联删除处于同一事务。会话、模型、资源快照等原有外键继续保护事实表；会话 ID、轮次编号、开始时间不能在轮次更新时修改。原普通表的登记触发器在实际 INSERT 成功后运行，忽略的冲突插入不产生孤立身份。

服务端通过 `session_turn_time` 和 `session_turn_times` 定位月份，迁移未覆盖的历史身份只在原关系仍占用正式表名时回退原表。切换后按实际关系 OID 判断权威来源，旧事务快照不会重新读取旧副本补回已清除的身份。指定任务的列表分页通过登记表的 `(session_id,started_at,turn_index)` 索引读取最早／最晚时间，再按事实表的会话和时间索引读取当前页；不先逐条读取该任务全部事实后排序。时间范围与列表在同一只读快照中读取，首个命令锁定逻辑表父表，防止切换跨越这两步读取；迁移准备阶段以普通表为准，不用尚未完整回填的登记范围限制结果。客户端协议和权限判断继续使用原有会话及轮次字段。

## 历史接口

`GET /api/admin/v1/statistics/history` 和 `/statistics/conversations` 返回 `{items,page,page_size,has_next}`。每页查询容量加一条，裁掉额外记录并生成 `has_next`；不执行分页总数 COUNT，也不返回 `total`。越界请求返回原请求页码、空数组和 `has_next=false`。

界面显示当前页和记录范围，提供前后页；界面默认容量 50，支持 20/50/100/200/500。筛选、容量变化回到第一页，清除导致后续页为空时自动回到第一页。两页仍支持全部历史及既有时间筛选。

任务列表读取 `sessions.turn_count`，不逐任务统计事实。`turn_count_verified` 区分历史缓存和已核对缓存：存量默认未验证，后台按主键水位每批最多 100 个会话校准；新会话默认已验证，初始为零。未校准列表行返回 `turn_count=null`，前端显示 `—`。当前页仍有待校准行时每 5 秒刷新，全部校准后停止；隐藏页面跳过请求，错误时停止自动刷新并保留手动重试。上报的派生信息重算会核对并标记该缓存；事实增删触发器在权威表维护缓存，并且在未校准时也锁定会话行，防止校准与并发写入丢计数。影子回填、镜像和 DEFAULT 物理搬迁不重复计数。

## 发布与进度

升级前备份，停止旧后端和直接写入者，执行迁移 34 的结构准备，随后配套发布后端和管理端。up 不全量复制历史事实或在持有结构锁时校准计数。新增会话字段使用 PostgreSQL 快速默认值；固定水位以准备时的主键最大值记录。

新后端启动独立的会话维护 worker，以 schema 范围 advisory lock 协调多副本。每轮校准最多 100 个会话、回填最多 1000 个轮次，各批独立提交；正常回填节流 10ms，错误一分钟后重试。可停止、重启后端恢复。修改、清除实时镜像到目标；回填先固定候选身份，按会话 ID 顺序锁定会话，再重新读取这些身份的最新事实，避免等待锁期间的清除被旧快照恢复。

```sql
SELECT phase,end_session,end_turn,cursor_session,cursor_turn,checked_rows,
       count_end,count_cursor,counts_ready,mirror_legacy,switched_at
FROM session_turns_partition_state;

SELECT phase,
       pg_size_pretty(pg_total_relation_size(source_relation)) AS original_or_legacy,
       (SELECT pg_size_pretty(coalesce(sum(pg_total_relation_size(p.relid)),0)::bigint)
        FROM pg_partition_tree(target_relation) p WHERE p.isleaf) AS partitions
FROM session_turns_partition_state;
```

`checked_rows` 是实际比对过的回填行数，游标按已检查的候选身份前进，即使候选在等待会话锁期间被合法删除也能继续。返回值约定：复制函数正数为已访问候选数、0 为扫描完成、-1 为已切换、-2 为其他维护实例占锁；校准函数正数为已处理会话数、0 为本次完成水位、-1 为校准已经完成、-2 为锁忙。

校准和回填完成后，worker 在同一快照核对两份完整内容和登记数，再以 NOWAIT 获取源、目标及引用表的锁，重挂外键并切换表名；锁竞争会完整回滚本次尝试，保留源表并稍后重试。外键重挂采用 NOT VALID 避免锁内再次扫描历史；原数据由原外键保护，新写入立即受新约束保护。可在维护窗口对工具、技能表执行 `VALIDATE CONSTRAINT` 补齐标志。

完整内容校验在 DDL 锁之前执行，仍需读取两份历史，需按数据规模评估低峰窗口和磁盘/WAL。旧关系的直接写入在切换后报 `40001`，应结束旧事务并重试。

需要暂停自动维护或手动限速时，可在独立数据库连接持有相同的 session advisory lock。它不阻塞业务镜像写入；保持连接期间，其他实例的自动维护返回锁忙。在同一连接可按需要的批次和间隔手动调用校准、回填函数，每次调用独立提交：

```sql
SELECT pg_advisory_lock(hashtextextended(current_schema() || ':session-turns-monthly',0));
-- 仅暂停时保持此连接即可；手动限速时按所需频率调用，例如每批 100。
SELECT session_calibrate_turn_counts(100);
SELECT session_copy_turn_batch(100);
-- 释放后，自动 worker 在下一次检查时继续；连接关闭也会释放会话锁。
SELECT pg_advisory_unlock(hashtextextended(current_schema() || ':session-turns-monthly',0));
```

## 月份维护

准备及后台维护预建当前与未来 3 个月，成功后每 24 小时维护，失败一分钟后重试。历史月份在各回填批次复制前按实际数据创建，不用连续补齐没有数据的月份。迟到或意外时间进入 DEFAULT，由维护任务发现后搬迁。

```sql
SELECT session_ensure_turn_months(now());
SELECT tableoid::regclass,count(*) FROM session_turns GROUP BY tableoid;
```

自动维护以最多 10001 行检查 DEFAULT 积压，超过 10000 时停止自动 DDL 并记录错误。需要大批搬迁时，在停止写入的维护窗口显式按月处理：

```sql
-- 0 仅供明确安排的维护窗口，取消自动搬迁的行数上限。
SELECT session_create_turn_month('2026-01-01 00:00:00+08',0);
```

物理搬迁持有分区树结构锁，抑制镜像、计数和登记删除；分区挂接恢复完整约束。所有历史月份均保留，未接入自动归档或删除。

## 观察与回滚

切换后旧表改名 `session_turns_legacy`，新事实在同一事务继续镜像到旧表。确认稳定后可显式结束观察：

```sql
SELECT session_finish_turn_observation();
```

返回 false 表示尚未切换或锁竞争。结束观察会将旧副本转为只读快照并移除其外键，避免旧快照阻止当前资源快照等关联清理；不删除旧副本。

回滚前停止全部后端及直接写入者，在维护窗口执行 `down 1` 并部署匹配的旧版本。回滚先获取 NOWAIT 锁，失败完整回滚。已切换时始终从当前权威分区表重建普通表，包括观察结束后的新增、修改和删除，再恢复外键和原名；不会复活已清除轮次。未切换时以原普通表为准。回滚需预留全历史重写的空间、WAL 和维护时间；支持再次 up 后重新后台迁移。

## 验证与限制

数据库测试覆盖上海月界、跨年、跨月会话、全局重复、忽略冲突插入、外键级联及孤立关联拒绝、计数校准并发、回填与清除并发、多写入者、游标续传、DEFAULT 搬迁、旧快照/旧写入防护、观察后回滚和真实 HTTP 上报/清除；历史接口测试比较切换前后输出。执行计划验证单轮次定位不执行无关月份分区，并以 2000 轮的长任务验证查询 51 条时事实读取量保持在当前页范围；并发测试验证读取等待切换提交后使用完整的新快照。浏览器脚本 `test:browser:history` 使用实际构建产物和模拟 API，覆盖无总数分页、校准占位、空页回退、分页容量、搜索、错误重试及移动端。

无时间条件的全历史查询仍涉及全部月份；深 OFFSET、正文/标题包含匹配，以及长会话派生信息全量重算的成本独立于此次去总数改造，后续可按实际负载优化。
