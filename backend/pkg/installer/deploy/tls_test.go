package deploy

import (
	"crypto/ecdsa"
	"crypto/x509"
	"encoding/pem"
	"os"
	"path/filepath"
	"testing"
)

func TestGenerateSelfSignedTLSUsesECDSAKey(t *testing.T) {
	dir := t.TempDir()
	certFile := filepath.Join(dir, "server.crt")
	keyFile := filepath.Join(dir, "server.key")

	if err := GenerateSelfSignedTLS(TLSPlan{
		Host:     "10.0.0.1",
		CertFile: certFile,
		KeyFile:  keyFile,
	}); err != nil {
		t.Fatal(err)
	}

	keyPEM, err := os.ReadFile(keyFile)
	if err != nil {
		t.Fatal(err)
	}
	keyBlock, _ := pem.Decode(keyPEM)
	if keyBlock == nil {
		t.Fatal("key PEM block not found")
	}
	if keyBlock.Type != "EC PRIVATE KEY" {
		t.Fatalf("key PEM type = %q, want EC PRIVATE KEY", keyBlock.Type)
	}
	key, err := x509.ParseECPrivateKey(keyBlock.Bytes)
	if err != nil {
		t.Fatalf("parse EC private key: %v", err)
	}
	if key.Curve == nil {
		t.Fatal("EC private key curve is nil")
	}

	certPEM, err := os.ReadFile(certFile)
	if err != nil {
		t.Fatal(err)
	}
	certBlock, _ := pem.Decode(certPEM)
	if certBlock == nil {
		t.Fatal("cert PEM block not found")
	}
	cert, err := x509.ParseCertificate(certBlock.Bytes)
	if err != nil {
		t.Fatalf("parse certificate: %v", err)
	}
	if _, ok := cert.PublicKey.(*ecdsa.PublicKey); !ok {
		t.Fatalf("cert public key type = %T, want *ecdsa.PublicKey", cert.PublicKey)
	}
}
