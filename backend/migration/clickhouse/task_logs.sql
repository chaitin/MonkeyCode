CREATE TABLE IF NOT EXISTS task_logs
ON CLUSTER mcai_cluster
(
	task_id UUID,
	ts DateTime64(9, 'UTC'),
	event LowCardinality(String),
	kind LowCardinality(String),
	turn_seq UInt32,
	data String CODEC(ZSTD(3)),
	msg_seq_start UInt64,
	msg_seq_end UInt64,
	source LowCardinality(String),
	log_version UInt16,
	ingest_id UUID
)
ENGINE = ReplicatedMergeTree('/clickhouse/tables/{shard}/mcai/task_logs', '{replica}')
PARTITION BY toYYYYMM(ts)
ORDER BY (task_id, turn_seq, ts, msg_seq_start, ingest_id)
TTL ts + INTERVAL 60 DAY TO VOLUME 'warm'
SETTINGS storage_policy = 'hot_warm';
