package relay

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"testing"
	"testing/synctest"
	"time"
)

func TestOverloadWindowCapturesHoldersAtRejection(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		var log bytes.Buffer
		b := newDataBudget(&relayMetrics{})
		b.logger = slog.New(slog.NewJSONHandler(&log, nil))
		file := b.reserve("read_file", false, nil)
		finish := file.retain()
		file.release()
		time.Sleep(time.Second)
		for range 14 {
			defer b.reserve("read_session", false, nil).release()
		}
		for range 77 {
			if b.reserve("read_config", false, nil) != nil {
				t.Fatal("满额时不应接纳配置读取")
			}
		}
		finish()
		time.Sleep(overloadInterval)
		synctest.Wait()
		var report struct {
			Event      string
			Rejections int
			Peak       int            `json:"peak_active"`
			Rejected   map[string]int `json:"rejected_by_operation"`
			Active     map[string]int `json:"active_by_operation"`
			Oldest     map[string]int `json:"oldest_ms_by_operation"`
		}
		if err := json.Unmarshal(log.Bytes(), &report); err != nil {
			t.Fatal(err)
		}
		if report.Event != "relay.data.overload" || report.Peak != 15 || report.Rejections != 77 || report.Rejected["read_config"] != 77 || report.Active["read_session"] != 14 || report.Active["read_file"] != 1 || report.Oldest["read_file"] != 1000 {
			t.Fatal(log.String())
		}
		log.Reset()
		defer b.reserve("upload_file", false, nil).release()
		b.reserve("read_config", false, nil)
		time.Sleep(overloadInterval)
		synctest.Wait()
		if !bytes.Contains(log.Bytes(), []byte(`"rejections":1,`)) || bytes.Contains(log.Bytes(), []byte("read_file")) {
			t.Fatal(log.String())
		}
	})
}
