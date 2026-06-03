package nls

import (
	"encoding/json"
	"time"
)

// 以下回调由阿里云 NLS SDK 在内部 goroutine 里调用(SDK 内部单线程串行,无需额外加锁)。
// param 是 NewSpeechTranscription 时传入的 *TranscriptionSession。

func onTrTaskFailed(text string, param any) {
	s, ok := param.(*TranscriptionSession)
	if !ok {
		return
	}
	s.logger.Println("onTaskFailed:", text)

	// 默认用原始 text 作为描述。能解出阿里云 header 就用阿里云的。
	header := AliyunHeader{Status: 0, StatusText: text}
	var resp transcriptionResp
	if err := json.Unmarshal([]byte(text), &resp); err == nil && resp.Header.Name != "" {
		header = resp.Header
	}

	s.emit(TranscriptionEvent{
		Type:      EventError,
		Header:    &header,
		Timestamp: time.Now().UnixMilli(),
	})
	s.markTerminated()
}

func onTrStarted(text string, param any) {
	s, ok := param.(*TranscriptionSession)
	if !ok {
		return
	}
	s.logger.Println("onStarted:", text)
	// `ready` 事件由 handler 在 NewTranscriptionSession 返回后直接下发,
	// 这里只打日志即可。
}

func onTrSentenceBegin(text string, param any) {
	s, ok := param.(*TranscriptionSession)
	if !ok {
		return
	}
	s.logger.Println("onSentenceBegin:", text)
	var resp transcriptionResp
	if err := json.Unmarshal([]byte(text), &resp); err != nil {
		s.logger.Printf("parse sentence_begin: %v", err)
		return
	}
	s.emit(TranscriptionEvent{
		Type:      EventSentenceBegin,
		Index:     resp.Payload.Index,
		Timestamp: time.Now().UnixMilli(),
	})
}

func onTrResultChanged(text string, param any) {
	s, ok := param.(*TranscriptionSession)
	if !ok {
		return
	}
	s.logger.Println("onResultChanged:", text)
	var resp transcriptionResp
	if err := json.Unmarshal([]byte(text), &resp); err != nil {
		s.logger.Printf("parse result_changed: %v", err)
		return
	}
	s.emit(TranscriptionEvent{
		Type:      EventPartial,
		Index:     resp.Payload.Index,
		Text:      resp.Payload.Result,
		Timestamp: time.Now().UnixMilli(),
	})
}

func onTrSentenceEnd(text string, param any) {
	s, ok := param.(*TranscriptionSession)
	if !ok {
		return
	}
	s.logger.Println("onSentenceEnd:", text)
	var resp transcriptionResp
	if err := json.Unmarshal([]byte(text), &resp); err != nil {
		s.logger.Printf("parse sentence_end: %v", err)
		return
	}
	s.emit(TranscriptionEvent{
		Type:      EventFinal,
		Index:     resp.Payload.Index,
		Text:      resp.Payload.Result,
		Timestamp: time.Now().UnixMilli(),
	})
}

func onTrCompleted(text string, param any) {
	s, ok := param.(*TranscriptionSession)
	if !ok {
		return
	}
	s.logger.Println("onCompleted:", text)
	s.emit(TranscriptionEvent{
		Type:      EventDone,
		Timestamp: time.Now().UnixMilli(),
	})
	s.markTerminated()
}

func onTrClose(param any) {
	s, ok := param.(*TranscriptionSession)
	if !ok {
		return
	}
	s.logger.Println("onClosed")
	// 已经被 onTrCompleted / onTrTaskFailed 标记过的话,这里就不再补 error 事件。
	// 否则视为异常断开,补一个本地错误。
	if !s.isTerminated() {
		s.emit(TranscriptionEvent{
			Type: EventError,
			Header: &AliyunHeader{
				Status:     0,
				StatusText: "nls connection closed",
			},
			Timestamp: time.Now().UnixMilli(),
		})
	}
	s.markTerminated()
}
