CREATE TABLE IF NOT EXISTS {{MODEL_USAGE_TABLE}}
ON CLUSTER mcai_cluster
(
	event_time DateTime64(3, 'UTC'),
	team_id String,
	user_id String,
	task_id String,
	project_id String,
	provider LowCardinality(String),
	model_id String,
	model_name String,
	input_tokens UInt64,
	output_tokens UInt64,
	cached_tokens UInt64,
	total_tokens UInt64,
	request_count UInt64 DEFAULT 1,
	success UInt8,
	duration_ms UInt64,
	trace_id String,
	request_id String,
	source LowCardinality(String),
	created_at DateTime64(3, 'UTC') DEFAULT now64(3, 'UTC')
)
ENGINE = ReplicatedMergeTree('/clickhouse/tables/{shard}/mcai/{{MODEL_USAGE_TABLE_RAW}}', '{replica}')
PARTITION BY toYYYYMM(event_time)
ORDER BY (team_id, event_time, user_id, task_id, model_id)
TTL toDateTime(event_time) + INTERVAL 400 DAY;
