package lifecycle

import (
	"encoding/json"
	"errors"
	"regexp"
)

var fieldName = regexp.MustCompile(`^[a-z][a-z0-9_]*$`)

func fields(d *json.Decoder) error { return fieldsAt(d, "") }

func fieldsAt(d *json.Decoder, path string) error {
	token, err := d.Token()
	if err != nil {
		return err
	}
	switch token {
	case json.Delim('{'):
		seen := map[string]bool{}
		for d.More() {
			token, err := d.Token()
			if err != nil {
				return err
			}
			name, ok := token.(string)
			canonical := fieldName.MatchString(name)
			if path == "runtime_package.files" {
				canonical = name == "monkeyai-runtime" || name == "ohmyagent" || name == "LICENSES.txt" || name == "bundle.json"
			}
			if !ok || !canonical || seen[name] {
				return errors.New("规格包含重复字段或非规范字段名")
			}
			seen[name] = true
			child := name
			if path != "" {
				child = path + "." + name
			}
			if err := fieldsAt(d, child); err != nil {
				return err
			}
		}
		_, err = d.Token()
		return err
	case json.Delim('['):
		for d.More() {
			if err := fieldsAt(d, path); err != nil {
				return err
			}
		}
		_, err = d.Token()
		return err
	}
	return nil
}
