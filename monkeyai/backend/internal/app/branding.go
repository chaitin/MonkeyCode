package app

import "github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"

func configurePublicLicense(service *identity.Service, registrars []AdminRegistrar) {
	for _, registrar := range registrars {
		if reader, ok := registrar.(PublicLicenseReader); ok {
			service.WithPublicLicense(reader)
			return
		}
	}
}
