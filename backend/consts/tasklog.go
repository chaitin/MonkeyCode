package consts

type LogStore string

const (
	LogStoreLoki       LogStore = "loki"
	LogStoreClickHouse LogStore = "clickhouse"
)
