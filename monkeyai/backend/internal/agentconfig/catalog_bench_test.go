package agentconfig

import (
	"testing"
)

func BenchmarkCatalogLists(b *testing.B) {
	r, user, _ := catalogDatabase(b)
	catalogExec(b, r, `INSERT INTO skills(ownership_type,owner_user_id,name,description,package_file_name,package_s3_key,package_size_bytes,package_sha256)
		SELECT 'user',$1,'skill-'||n,'description','skill.zip','skill.zip',1,'sha256'
		FROM generate_series(1,1000) n`, user)
	handler := catalogHandler(b, r, user)
	path := "/skills?page_size=20"
	etag := catalogRead(b, handler, user, path, "").Header().Get("ETag")
	trace := r.store.Pool.Config().ConnConfig.Tracer.(*catalogTrace)
	for _, test := range []struct {
		name string
		etag string
		code int
	}{{"list", "", 200}, {"conditional", etag, 304}} {
		b.Run(test.name, func(b *testing.B) {
			trace.reset()
			b.ReportAllocs()
			b.ResetTimer()
			for range b.N {
				if response := catalogRead(b, handler, user, path, test.etag); response.Code != test.code {
					b.Fatalf("status=%d want=%d", response.Code, test.code)
				}
			}
			b.StopTimer()
			calls := 0
			for _, count := range trace.counts() {
				calls += count
			}
			b.ReportMetric(float64(calls)/float64(b.N), "db_calls/op")
		})
	}
}
