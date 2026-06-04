// Package doubao 封装火山引擎"豆包流式语音识别 2.0" (SAUC bigmodel) 的双向流式
// WebSocket 客户端,实现 asr.Transcriber 接口。
//
// 协议参考: https://www.volcengine.com/docs/6561/1354869
//   - bigmodel_async (双向流式优化版,结果变化才返回,推荐)
//   - bigmodel       (双向流式,每包响应一包)
//   - bigmodel_nostream (流式输入,整段输入后返回,本包不实现)
package doubao

import (
	"log/slog"

	"github.com/chaitin/MonkeyCode/backend/config"
)

const (
	// 服务端协议版本
	protocolVersion = 0b0001
	// header size = 4 字节 (headerSize value 1 表示 1*4 字节)
	headerSizeValue = 0b0001
)

// Message Type (header byte 1 的高 4 位)
const (
	msgTypeFullClientReq  byte = 0b0001 // 端上发送包含请求参数的 full client request
	msgTypeAudioOnlyReq   byte = 0b0010 // 端上发送音频数据
	msgTypeFullServerResp byte = 0b1001 // 服务端下发包含识别结果
	msgTypeServerError    byte = 0b1111 // 服务端处理错误
)

// Message Type Specific Flags (header byte 1 的低 4 位)
const (
	flagNoSeq      byte = 0b0000 // header 后不带 sequence
	flagPosSeq     byte = 0b0001 // header 后带正数 sequence
	flagNegNoSeq   byte = 0b0010 // header 后不带 sequence,但是最后一包
	flagNegWithSeq byte = 0b0011 // header 后带负数 sequence,且是最后一包
)

// Serialization (header byte 2 高 4 位) / Compression (低 4 位)
const (
	serNoSer byte = 0b0000
	serJSON  byte = 0b0001

	cmpNone byte = 0b0000
	cmpGzip byte = 0b0001
)

// Doubao 豆包流式 ASR 客户端工厂。
type Doubao struct {
	cfg    config.Doubao
	logger *slog.Logger
}

// fullClientPayload Full Client Request 的 JSON payload 结构,
// 字段与豆包文档一一对应。omitempty 用于让默认值不传,减少误差。
type fullClientPayload struct {
	User    userMeta    `json:"user"`
	Audio   audioMeta   `json:"audio"`
	Request requestMeta `json:"request"`
}

type userMeta struct {
	Uid string `json:"uid,omitempty"`
}

type audioMeta struct {
	Format  string `json:"format,omitempty"`
	Codec   string `json:"codec,omitempty"`
	Rate    int    `json:"rate,omitempty"`
	Bits    int    `json:"bits,omitempty"`
	Channel int    `json:"channel,omitempty"`
}

type requestMeta struct {
	ModelName string `json:"model_name"`
	// EnableNonstream 开启二遍识别 (流式实时上屏 + nostream 重识别提升准确率)。
	// 仅双向流式优化版 (bigmodel_async) 支持;开启后会默认开启 VAD 分句 (end_window_size 控制判停)。
	EnableNonstream bool `json:"enable_nonstream,omitempty"`
	EnableITN       bool `json:"enable_itn"`
	EnablePUNC      bool `json:"enable_punc"`
	EnableDDC       bool `json:"enable_ddc"`
	ShowUtterances  bool `json:"show_utterances"`
	// EndWindowSize 强制判停时间 (ms),静音超此值直接判停输出 definite 分句。
	// 文档默认 800,最小 200;0 表示走豆包默认 (即不传字段)。
	EndWindowSize int `json:"end_window_size,omitempty"`
	// Corpus 热词/上下文配置,空指针时不发送 corpus 字段
	Corpus *corpusMeta `json:"corpus,omitempty"`
}

// corpusMeta request.corpus 子结构,承载热词词表 ID/Name 与运行时直传热词上下文。
// 三个字段都可选,任意组合;同时配置词表和直传时,豆包侧直传优先级更高。
type corpusMeta struct {
	BoostingTableID   string `json:"boosting_table_id,omitempty"`
	BoostingTableName string `json:"boosting_table_name,omitempty"`
	// Context 热词或对话上下文,JSON 字符串 (注意是序列化后的 string,不是嵌套对象)。
	// 热词形态: {"hotwords":[{"word":"xxx"},...]} ;双向流式限 100 tokens。
	Context string `json:"context,omitempty"`
}

// serverRespPayload Server Full Response 的 JSON 解析结构(我们只关心识别结果部分)。
type serverRespPayload struct {
	AudioInfo struct {
		Duration int `json:"duration"`
	} `json:"audio_info"`
	Result struct {
		Text       string      `json:"text"`
		Utterances []utterance `json:"utterances,omitempty"`
	} `json:"result"`
	Error string `json:"error,omitempty"`
}

type utterance struct {
	Definite  bool   `json:"definite"`
	StartTime int    `json:"start_time"`
	EndTime   int    `json:"end_time"`
	Text      string `json:"text"`
}

// serverErrorPayload Server Error Response 的 JSON 解析结构。
type serverErrorPayload struct {
	Error string `json:"error,omitempty"`
}

// parsedFrame Server 下发帧的解析结果。
type parsedFrame struct {
	messageType byte
	isLastPkg   bool
	sequence    int32
	errorCode   uint32 // 仅 messageType=msgTypeServerError 有意义
	payload     []byte // 已 gzip 解压、未反序列化的 JSON 字节
}
