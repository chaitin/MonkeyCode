package installer

import (
	"crypto/x509"
	"encoding/pem"
	"net"
	"os"
	"path/filepath"
	"testing"
)

func TestGenerateSelfSignedTLSWithIPSAN(t *testing.T) {
	dir := t.TempDir()
	certFile := filepath.Join(dir, "server.crt")
	keyFile := filepath.Join(dir, "server.key")

	err := GenerateSelfSignedTLS(TLSPlan{
		Host:     "192.168.1.10",
		CertFile: certFile,
		KeyFile:  keyFile,
	})
	if err != nil {
		t.Fatal(err)
	}

	cert := readCert(t, certFile)
	if len(cert.IPAddresses) != 1 || !cert.IPAddresses[0].Equal(net.ParseIP("192.168.1.10")) {
		t.Fatalf("IPAddresses = %#v", cert.IPAddresses)
	}
	if _, err := os.Stat(keyFile); err != nil {
		t.Fatal(err)
	}
}

func TestGenerateSelfSignedTLSWithDNSSAN(t *testing.T) {
	dir := t.TempDir()
	certFile := filepath.Join(dir, "server.crt")

	err := GenerateSelfSignedTLS(TLSPlan{
		Host:     "monkeycode.local",
		CertFile: certFile,
		KeyFile:  filepath.Join(dir, "server.key"),
	})
	if err != nil {
		t.Fatal(err)
	}

	cert := readCert(t, certFile)
	if len(cert.DNSNames) != 1 || cert.DNSNames[0] != "monkeycode.local" {
		t.Fatalf("DNSNames = %#v", cert.DNSNames)
	}
}

func readCert(t *testing.T, certFile string) *x509.Certificate {
	t.Helper()
	data, err := os.ReadFile(certFile)
	if err != nil {
		t.Fatal(err)
	}
	block, _ := pem.Decode(data)
	if block == nil {
		t.Fatal("missing PEM block")
	}
	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		t.Fatal(err)
	}
	return cert
}
