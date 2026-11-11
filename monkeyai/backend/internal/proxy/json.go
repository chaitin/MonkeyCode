package proxy

import (
	"bytes"
	"encoding/json"
	"encoding/json/jsontext"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
)

var objectDecoders = sync.Pool{New: func() any {
	return jsontext.NewDecoder(http.NoBody)
}}

// rawObject 借用输入中的字段值，调用方必须保持 data 不变；另返回顶层是否重名。
func rawObject(data []byte) (map[string]json.RawMessage, bool, error) {
	decoder := objectDecoders.Get().(*jsontext.Decoder)
	decoder.Reset(bytes.NewBuffer(data), json.DefaultOptionsV1())
	defer func() {
		decoder.Reset(http.NoBody)
		objectDecoders.Put(decoder)
	}()
	token, err := decoder.ReadToken()
	if err != nil {
		return nil, false, err
	}
	var object map[string]json.RawMessage
	duplicate := false
	switch token.Kind() {
	case 'n':
	case '{':
		object = make(map[string]json.RawMessage)
		for decoder.PeekKind() != '}' {
			name, err := decoder.ReadToken()
			if err != nil {
				return nil, false, err
			}
			key := strings.Clone(name.String())
			value, err := decoder.ReadValue()
			if err != nil {
				return nil, false, err
			}
			end := int(decoder.InputOffset())
			if _, exists := object[key]; exists {
				duplicate = true
			}
			object[key] = data[end-len(value) : end]
		}
		if _, err := decoder.ReadToken(); err != nil {
			return nil, false, err
		}
	default:
		return nil, false, errors.New("请求体必须是 JSON 对象")
	}
	if _, err := decoder.ReadToken(); err != io.EOF {
		if err == nil {
			err = errors.New("请求体只能包含一个 JSON 对象")
		}
		return nil, false, err
	}
	return object, duplicate, nil
}
