package nls

import (
	"context"
	"log"
	"log/slog"
	"os"
	"time"

	nls "github.com/aliyun/alibabacloud-nls-go-sdk"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/chaitin/MonkeyCode/backend/config"
)

const (
	NLS_ACCESS_TOKEN_KEY = "nls:token"
)

func NewNLS(cfg *config.Config, logger *slog.Logger, redis *redis.Client) *NLS {
	return &NLS{
		cfg:    cfg,
		redis:  redis,
		logger: logger,
	}
}

func (n *NLS) getToken(ctx context.Context) (string, error) {
	token, err := n.redis.Get(ctx, NLS_ACCESS_TOKEN_KEY).Result()
	if err == nil && token != "" {
		return token, nil
	}

	tokenMsg, err := nls.GetToken(nls.DEFAULT_DISTRIBUTE, nls.DEFAULT_DOMAIN, n.cfg.NLS.AkID, n.cfg.NLS.AkKey, nls.DEFAULT_VERSION)
	if err != nil {
		return "", err
	}
	n.logger.With("token", tokenMsg).DebugContext(ctx, "token from remote")
	token = tokenMsg.TokenResult.Id
	now := time.Now().Unix()
	if err := n.redis.Set(ctx, NLS_ACCESS_TOKEN_KEY, token, time.Duration(tokenMsg.TokenResult.ExpireTime-now)*time.Second).Err(); err != nil {
		return "", err
	}

	return token, nil
}

func (n *NLS) SpeechRecognition(ctx context.Context, user uuid.UUID, audio []byte) (<-chan RecognitionResult, <-chan error) {
	resultCh := make(chan RecognitionResult, 10)
	errorCh := make(chan error, 1)

	sessionID := uuid.NewString()

	go func() {
		defer close(resultCh)
		defer close(errorCh)

		token, err := n.getToken(ctx)
		if err != nil {
			errorCh <- err
			return
		}

		config := nls.NewConnectionConfigWithToken(nls.DEFAULT_URL, n.cfg.NLS.AppKey, token)

		logger := nls.NewNlsLogger(os.Stderr, sessionID, log.LstdFlags|log.Lmicroseconds)
		logger.SetLogSil(false)
		logger.SetDebug(true)

		param := nls.DefaultSpeechRecognitionParam()
		callbackParam := &CallbackParam{
			Logger:    logger,
			SessionID: sessionID,
			ResultCh:  resultCh,
			UserID:    user.String(),
		}
		sr, err := nls.NewSpeechRecognition(config, logger, onTaskFailed, onStarted, onResultChangedWithCtx, onCompletedWithCtx, onClose, callbackParam)
		if err != nil {
			errorCh <- err
			return
		}

		ready, err := sr.Start(param, nil)
		if err != nil {
			errorCh <- err
			return
		}

		if err := waitReady(ready, logger); err != nil {
			errorCh <- err
			return
		}

		// 320 samples * 2 bytes per sample for 16-bit PCM
		chunkSize := 320 * 2
		for i := 0; i < len(audio); i += chunkSize {
			end := i + chunkSize
			if end > len(audio) {
				end = len(audio)
			}
			chunk := audio[i:end]
			if err := sr.SendAudioData(chunk); err != nil {
				errorCh <- err
				return
			}
			time.Sleep(10 * time.Millisecond)
		}

		ready, err = sr.Stop()
		if err != nil {
			errorCh <- err
			return
		}

		if err := waitReady(ready, logger); err != nil {
			errorCh <- err
			return
		}

		sr.Shutdown()
	}()

	return resultCh, errorCh
}
