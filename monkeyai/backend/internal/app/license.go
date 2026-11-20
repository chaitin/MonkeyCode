package app

import (
	"github.com/chaitin/MonkeyCode/monkeyai/backend/extension"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/license"
)

func licenseReader(registrars []AdminRegistrar) license.Reader {
	installed := false
	for _, registrar := range registrars {
		if _, ok := registrar.(extension.Module); ok {
			installed = true
			break
		}
	}
	if !installed {
		return nil
	}
	for _, registrar := range registrars {
		if reader, ok := registrar.(license.Reader); ok {
			return reader
		}
	}
	return nil
}
