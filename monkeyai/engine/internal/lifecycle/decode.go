package lifecycle

import (
	"encoding/json"
	"errors"
	"regexp"
)

var fieldName = regexp.MustCompile(`^[a-z][a-z0-9_]*$`)

func fields(d *json.Decoder) error {
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
			if !ok || !fieldName.MatchString(name) || seen[name] {
				return errors.New("规格包含重复字段或非规范字段名")
			}
			seen[name] = true
			if err := fields(d); err != nil {
				return err
			}
		}
		_, err = d.Token()
		return err
	case json.Delim('['):
		for d.More() {
			if err := fields(d); err != nil {
				return err
			}
		}
		_, err = d.Token()
		return err
	}
	return nil
}
