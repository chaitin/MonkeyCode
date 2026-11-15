package lifecycle

import "testing"

func TestRuntimeServerHTTPAndHTTPS(t *testing.T) {
	for _, server := range []string{"http://server.example:8080", "https://server.example"} {
		spec := testSpec()
		spec.NetworkPolicy = "public-only"
		spec.Runtime = &Runtime{Server: server, ServerID: "server-1", UserID: "owner-1"}
		if err := spec.Validate(); err != nil {
			t.Fatal(server, err)
		}
		for _, bad := range []string{"ftp://server.example", "http://user:pass@server.example", "http://server.example/base", "http://server.example?", "http://server.example#x"} {
			spec.Runtime.Server = bad
			if spec.Validate() == nil {
				t.Fatal("接受非法runtime server", bad)
			}
		}
	}
}
