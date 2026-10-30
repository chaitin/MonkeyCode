package driver

import (
	"github.com/opencontainers/go-digest"
	"github.com/opencontainers/image-spec/identity"
)

func chainID(ids []digest.Digest) string { return identity.ChainID(ids).String() }
