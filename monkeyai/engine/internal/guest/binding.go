package guest

import (
	"errors"
	"strings"
)

func ParseBinding(commandline string) (Binding, error) {
	values := map[string]string{}
	for _, part := range strings.Fields(commandline) {
		key, value, ok := strings.Cut(part, "=")
		if !strings.HasPrefix(key, "monkeyai.") {
			continue
		}
		if !ok || value == "" {
			return Binding{}, errors.New("虚拟机启动身份参数缺失")
		}
		if _, exists := values[key]; exists {
			return Binding{}, errors.New("虚拟机启动身份参数重复")
		}
		values[key] = value
	}
	if values["monkeyai.guest"] != "1" {
		return Binding{}, errors.New("未确认处于平台管理的开发虚拟机内")
	}
	b := Binding{EnvironmentID: values["monkeyai.environment"], InstanceID: values["monkeyai.instance"], BootID: values["monkeyai.boot"]}
	return b, b.Validate()
}
