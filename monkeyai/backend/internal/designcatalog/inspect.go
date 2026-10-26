package designcatalog

import (
	"archive/zip"
	"encoding/json"
	"io"
	"os"
	"strings"
)

type SectionInfo struct {
	Present       bool `json:"present"`
	Supported     bool `json:"supported"`
	SchemaVersion int  `json:"schema_version,omitempty"`
}
type Inspection struct {
	Agent     SectionInfo `json:"agent"`
	Design    SectionInfo `json:"design"`
	NewDesign bool        `json:"-"`
}

func Inspect(reader io.ReaderAt, size int64) (Inspection, error) {
	var out Inspection
	if size <= 0 || size > MaxPackage {
		return out, fault(400, "invalid_argument", "资源包大小超限")
	}
	z, err := zip.NewReader(reader, size)
	if err != nil {
		return out, err
	}
	var f *zip.File
	var expanded uint64
	for _, entry := range z.File {
		if !SafePath(strings.TrimSuffix(entry.Name, "/")) || entry.Mode()&os.ModeSymlink != 0 {
			return out, fault(400, "invalid_argument", "不安全ZIP路径")
		}
		if !entry.FileInfo().IsDir() {
			if entry.UncompressedSize64 > uint64(MaxExpanded)-expanded {
				return out, fault(400, "invalid_argument", "ZIP 展开大小超限")
			}
			expanded += entry.UncompressedSize64
		}
		if entry.Name == "manifest.json" && f == nil {
			f = entry
		}
	}
	if f == nil {
		return out, fault(400, "invalid_argument", "缺少 manifest.json")
	}
	r, err := f.Open()
	if err != nil {
		return out, err
	}
	defer r.Close()
	b, err := io.ReadAll(io.LimitReader(r, int64(f.UncompressedSize64)+1))
	if err != nil {
		return out, err
	}
	if !json.Valid(b) {
		return out, fault(400, "invalid_argument", "manifest JSON 无效")
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(b, &fields) != nil {
		return out, nil
	}
	raw, ok := fields["agent_resources"]
	out.Agent = SectionInfo{Present: ok && string(raw) != "null", Supported: true}
	raw, ok = fields["design_resources"]
	out.Design.Present = ok && string(raw) != "null"
	if !out.Design.Present {
		return out, nil
	}
	var design map[string]json.RawMessage
	if json.Unmarshal(raw, &design) != nil {
		return out, nil
	}
	_, out.NewDesign = design["schema_version"]
	_ = json.Unmarshal(design["schema_version"], &out.Design.SchemaVersion)
	out.Design.Supported = out.Design.SchemaVersion == SchemaVersion && stringValue(design["digest_schema"]) == DigestSchema
	return out, nil
}
