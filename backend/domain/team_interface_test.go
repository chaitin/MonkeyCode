package domain

import (
	"context"
	"testing"
)

type memberManagerFunc struct{}

func (memberManagerFunc) AddUser(ctx context.Context, teamUser *TeamUser, req *AddTeamUserReq) (*AddTeamUserResp, error) {
	return &AddTeamUserResp{}, nil
}

func (memberManagerFunc) AddUserWithPassword(ctx context.Context, teamUser *TeamUser, req *AddTeamUserReq) (*AddTeamUserWithPasswordResp, error) {
	return &AddTeamUserWithPasswordResp{}, nil
}

func (memberManagerFunc) AddAdmin(ctx context.Context, teamUser *TeamUser, req *AddTeamAdminReq) (*AddTeamAdminResp, error) {
	return &AddTeamAdminResp{}, nil
}

func TestMemberManagerInterface(t *testing.T) {
	var manager MemberManager = memberManagerFunc{}
	if _, err := manager.AddUser(context.Background(), &TeamUser{}, &AddTeamUserReq{}); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.AddUserWithPassword(context.Background(), &TeamUser{}, &AddTeamUserReq{}); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.AddAdmin(context.Background(), &TeamUser{}, &AddTeamAdminReq{}); err != nil {
		t.Fatal(err)
	}
}
