package nls

import (
	"encoding/json"
	"errors"
	"log"
	"time"

	nls "github.com/aliyun/alibabacloud-nls-go-sdk"
)

func onTaskFailed(text string, param any) {
	cbParam, ok := param.(*CallbackParam)
	if !ok {
		log.Default().Fatal("invalid callback param")
		return
	}
	cbParam.Logger.Println("TaskFailed:", text)
}

func onStarted(text string, param any) {
	cbParam, ok := param.(*CallbackParam)
	if !ok {
		log.Default().Fatal("invalid callback param")
		return
	}
	cbParam.Logger.Println("onStarted:", text)
}

func onResultChangedWithCtx(text string, param any) {
	cbParam, ok := param.(*CallbackParam)
	if !ok {
		log.Default().Fatal("invalid callback param")
		return
	}

	cbParam.Logger.Println("onResultChanged:", text)

	var response SpeechRecognitionResponse
	if err := json.Unmarshal([]byte(text), &response); err != nil {
		cbParam.Logger.Printf("failed to parse recognition response: %v", err)
		return
	}

	result := RecognitionResult{
		Text:      response.Payload.Result,
		IsFinal:   false,
		UserID:    cbParam.UserID,
		Timestamp: time.Now().UnixMilli(),
	}

	select {
	case cbParam.ResultCh <- result:
	default:
		cbParam.Logger.Println("result channel full, skipping result")
	}
}

func onCompletedWithCtx(text string, param any) {
	cbParam, ok := param.(*CallbackParam)
	if !ok {
		log.Default().Fatal("invalid callback param")
		return
	}

	cbParam.Logger.Println("onCompleted:", text)

	var response SpeechRecognitionResponse
	if err := json.Unmarshal([]byte(text), &response); err != nil {
		cbParam.Logger.Printf("failed to parse recognition response: %v", err)
		return
	}

	result := RecognitionResult{
		Text:      response.Payload.Result,
		IsFinal:   true,
		UserID:    cbParam.UserID,
		Timestamp: time.Now().UnixMilli(),
	}

	select {
	case cbParam.ResultCh <- result:
	default:
		cbParam.Logger.Println("result channel full, skipping result")
	}
}

func onClose(param any) {
	cbParam, ok := param.(*CallbackParam)
	if !ok {
		log.Default().Fatal("invalid callback param")
		return
	}
	cbParam.Logger.Println("onClosed:")
}

func waitReady(ch chan bool, logger *nls.NlsLogger) error {
	select {
	case done := <-ch:
		if !done {
			logger.Println("Wait failed")
			return errors.New("wait failed")
		}
		logger.Println("Wait done")
	case <-time.After(20 * time.Second):
		logger.Println("Wait timeout")
		return errors.New("wait timeout")
	}
	return nil
}
