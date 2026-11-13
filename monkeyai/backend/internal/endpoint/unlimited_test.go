package endpoint

import (
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
)

func TestExecutionEnrollmentWithoutCountLimit(t *testing.T) {
	pool := testDatabase(t)
	user := testUser(t, pool, "unlimited-execution")
	if _, err := pool.Exec(t.Context(), `INSERT INTO endpoints(user_id,machine_id,device_name,platform,os_version,arch,client_version)
SELECT $1,gen_random_uuid(),'电脑','macos','15','arm64','1' FROM generate_series(1,25)`, user); err != nil {
		t.Fatal(err)
	}
	execution := NewExecution(pool, identity.NewService(pool, nil, "http://localhost"))
	principal := executionPrincipal(t, pool, user, []string{"device:bind"})
	if _, err := execution.Enroll(t.Context(), principal, testEnrollment(t), 0); err != nil {
		t.Fatalf("超过 20 台设备后执行设备绑定失败: %v", err)
	}
}
