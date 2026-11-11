package proxy

import (
	"bytes"
	"encoding/json"
	"reflect"
	"testing"
)

func legacyRewriteModel(body []byte, model string) ([]byte, error) {
	var object map[string]json.RawMessage
	if err := json.Unmarshal(body, &object); err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(model)
	if err != nil {
		return nil, err
	}
	object["model"] = encoded
	return json.Marshal(object)
}

func TestRawObjectAndRewriteCompatibility(t *testing.T) {
	cases := [][]byte{
		[]byte(`{}`),
		[]byte(`null`),
		[]byte(` {"model":"old", "messages": [ {"content":"你好 <>&\u2028"} ], "n":9007199254740993} `),
		[]byte(`{"model":"first","model":"last","\u006dodel":"escaped","nested":{"a":1,"a":2}}`),
		[]byte(`{"model":null,"fields":[null,true,false,-1.25e+9],"empty":[],"object":{}}`),
		[]byte(`{"model":"\ud800","\ud800":"value"}`),
		append([]byte(`{"model":"old","text":"`), 0xff, '"', '}'),
		[]byte(`{}` + "\n\t "),
		[]byte(`{"model":"x","data":[1,]}`),
		[]byte(`{"model":}`),
		[]byte(`{} {}`),
		[]byte(`[]`),
		[]byte(`"model"`),
		nil,
	}
	for _, body := range cases {
		t.Run(string(body), func(t *testing.T) {
			original := bytes.Clone(body)
			var want map[string]json.RawMessage
			wantErr := json.Unmarshal(body, &want)
			got, _, err := rawObject(body)
			if (err == nil) != (wantErr == nil) || (err == nil && !reflect.DeepEqual(got, want)) {
				t.Fatalf("字段解析不兼容: got=%v err=%v want=%v err=%v", got, err, want, wantErr)
			}
			if !bytes.Equal(body, original) {
				t.Fatal("字段解析修改了原请求")
			}
			if wantErr != nil || want == nil {
				return
			}
			for _, model := range []string{"actual-model", "模型<&>\u2028", "", "\xff"} {
				got, err := rewriteModel(body, model)
				want, wantErr := legacyRewriteModel(body, model)
				if (err == nil) != (wantErr == nil) || !bytes.Equal(got, want) {
					t.Fatalf("重写结果改变了计费哈希输入: got=%s err=%v want=%s err=%v", got, err, want, wantErr)
				}
			}
		})
	}
}

func FuzzRawObjectCompatibility(f *testing.F) {
	for _, seed := range []string{`{}`, `{"model":"old","messages":[{"content":"hello"}]}`, `{"a":1,"a":2,"\u0061":3}`, `null`, `{"x":"\ud800"}`} {
		f.Add([]byte(seed))
	}
	f.Fuzz(func(t *testing.T, body []byte) {
		var want map[string]json.RawMessage
		wantErr := json.Unmarshal(body, &want)
		got, _, err := rawObject(body)
		if (err == nil) != (wantErr == nil) || (err == nil && !reflect.DeepEqual(got, want)) {
			t.Fatalf("字段解析不兼容: got=%v err=%v want=%v err=%v", got, err, want, wantErr)
		}
	})
}
