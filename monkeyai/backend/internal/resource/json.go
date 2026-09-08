package resource

import "encoding/json"

func DecodeObject(data []byte, err error) (Object, error) {
	if err != nil {
		return nil, err
	}
	var object Object
	err = json.Unmarshal(data, &object)
	return object, err
}

func DecodeObjects(data [][]byte, err error) ([]Object, error) {
	if err != nil {
		return nil, err
	}
	objects := make([]Object, 0, len(data))
	for _, raw := range data {
		var object Object
		if err := json.Unmarshal(raw, &object); err != nil {
			return nil, err
		}
		objects = append(objects, object)
	}
	return objects, nil
}
