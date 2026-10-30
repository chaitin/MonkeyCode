package standalone

import (
	"context"
	"encoding/base64"
	"errors"
	"regexp"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
)

const Binary = "/opt/monkeyai/monkeyai-runtime"
const Engine = "/opt/monkeyai/ohmyagent"
const StateDir = "/var/lib/monkeyai/state"

var machineID = regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$`)

type Request struct {
	EnvironmentID string `json:"environment_id"`
	InstanceID    string `json:"instance_id"`
	Generation    int64  `json:"generation"`
	MachineID     string `json:"machine_id"`
	PublicKey     string `json:"public_key"`
	UserCode      string `json:"user_code,omitempty"`
}
type Reply struct {
	Request Request `json:"request"`
	Reason  string  `json:"reason"`
}
type Approve func(context.Context, Request) error

type Status struct {
	MachineID  string   `json:"machineId"`
	PublicKey  string   `json:"publicKey"`
	Authorized bool     `json:"authorized"`
	Account    *Account `json:"account"`
}
type Account struct {
	Server   string `json:"serverUrl"`
	ServerID string `json:"serverId"`
	UserID   string `json:"userId"`
}

func (s Status) Valid() bool {
	public, err := base64.RawURLEncoding.Strict().DecodeString(s.PublicKey)
	return err == nil && len(public) == 32 && machineID.MatchString(s.MachineID)
}
func (s Status) matches(r *lifecycle.Runtime) bool {
	return s.Valid() && s.Authorized && s.Account != nil && s.Account.Server == r.Server && s.Account.ServerID == r.ServerID && s.Account.UserID == r.UserID
}

type Runner interface {
	Status(context.Context, lifecycle.Spec) (Status, error)
	Login(context.Context, lifecycle.Spec, func(string) error) error
	Serve(context.Context, lifecycle.Spec, bool) error
}

func Ensure(ctx context.Context, s lifecycle.Spec, runner Runner, approve Approve, observe bool) error {
	if s.Runtime == nil {
		return nil
	}
	if err := s.Validate(); err != nil {
		return err
	}
	if approve == nil {
		return errors.New("缺少后台运行时授权入口")
	}
	status, err := runner.Status(ctx, s)
	if err != nil {
		return err
	}
	request := func(status Status, code string) error {
		if !status.Valid() {
			return errors.New("运行时公开身份无效")
		}
		return approve(ctx, Request{EnvironmentID: s.EnvironmentID, InstanceID: s.InstanceID, Generation: s.Generation, MachineID: status.MachineID, PublicKey: status.PublicKey, UserCode: code})
	}
	if !status.matches(s.Runtime) {
		if observe {
			return errors.New("运行时授权已丢失，不自动登录")
		}
		if status.Account != nil && (status.Account.UserID != s.Runtime.UserID || status.Account.ServerID != s.Runtime.ServerID || status.Account.Server != s.Runtime.Server) {
			return errors.New("持久目录已属于其他账号或后台")
		}
		if err := runner.Login(ctx, s, func(code string) error {
			current, err := runner.Status(ctx, s)
			if err != nil {
				return err
			}
			return request(current, code)
		}); err != nil {
			return err
		}
		status, err = runner.Status(ctx, s)
		if err != nil {
			return err
		}
		if !status.matches(s.Runtime) {
			return errors.New("运行时登录未确认预期身份")
		}
	}
	if err := request(status, ""); err != nil {
		return err
	}
	return runner.Serve(ctx, s, observe)
}
