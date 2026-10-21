package designcatalog

import (
	"bytes"
	"encoding/json"
	"errors"
	"slices"
)

func (f *FileRef) UnmarshalJSON(b []byte) error {
	type plain FileRef
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(b, &fields); err != nil {
		return err
	}
	if role, ok := fields["role"]; ok && bytes.Equal(bytes.TrimSpace(role), []byte("null")) {
		return errors.New("files.role 不接受 null")
	}
	var value plain
	if err := json.Unmarshal(b, &value); err != nil {
		return err
	}
	*f = FileRef(value)
	return nil
}
func validateProvenance(b json.RawMessage) error {
	if len(b) == 0 || bytes.Equal(bytes.TrimSpace(b), []byte("null")) {
		return nil
	}
	var fields map[string]json.RawMessage
	if err := decode(b, &fields); err != nil || fields == nil {
		return errors.New("provenance 必须是对象")
	}
	for key, raw := range fields {
		if !slices.Contains([]string{"source_id", "upstream_id", "upstream_digest", "upstream_asset_snapshot_id", "upstream_url"}, key) {
			return errors.New("provenance 字段不支持")
		}
		if len(raw) == 0 || raw[0] != '"' {
			return errors.New("provenance 字段必须是字符串")
		}
	}
	return nil
}
