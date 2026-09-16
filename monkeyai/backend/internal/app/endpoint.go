package app

import (
	"context"
	"net/http"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/endpoint"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
)

type endpointAuth struct{ service *identity.Service }

func (a endpointAuth) Credential(r *http.Request) (endpoint.Credential, bool) {
	c, ok := identity.CredentialFromContext(r.Context())
	return endpoint.Credential{UserID: c.UserID, Reference: c.Reference, ExpiresAt: c.ExpiresAt}, ok
}

func (a endpointAuth) Valid(ctx context.Context, c endpoint.Credential) (bool, error) {
	return a.service.ValidCredential(ctx, identity.AccessCredential{UserID: c.UserID, Reference: c.Reference, ExpiresAt: c.ExpiresAt})
}
