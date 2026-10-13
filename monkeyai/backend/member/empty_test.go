package member

import (
	"context"
	"testing"
)

var (
	_ UserWriter  = EmptyUserWriter{}
	_ GroupWriter = EmptyGroupWriter{}
)

func TestEmptyUserWriter(t *testing.T) {
	writer := EmptyUserWriter{}
	tests := []struct {
		name string
		call func() error
	}{
		{
			name: "EnsureInitialAdmin",
			call: func() error {
				return writer.EnsureInitialAdmin(context.Background(), InitialAdmin{})
			},
		},
		{
			name: "CreateUser",
			call: func() error {
				_, err := writer.CreateUser(context.Background(), CreateUser{})
				return err
			},
		},
		{
			name: "UpdateUser",
			call: func() error {
				_, err := writer.UpdateUser(context.Background(), nil, UpdateUser{})
				return err
			},
		},
		{
			name: "RegisterEmailUser",
			call: func() error {
				_, err := writer.RegisterEmailUser(context.Background(), nil, "")
				return err
			},
		},
		{
			name: "UpsertIdentity",
			call: func() error {
				_, err := writer.UpsertIdentity(context.Background(), OAuthIdentity{})
				return err
			},
		},
		{
			name: "ResetPassword",
			call: func() error {
				_, err := writer.ResetPassword(context.Background(), nil, PasswordReset{})
				return err
			},
		},
		{
			name: "ResetUserPassword",
			call: func() error {
				return writer.ResetUserPassword(context.Background(), nil, "", "")
			},
		},
		{
			name: "TouchLogin",
			call: func() error {
				return writer.TouchLogin(context.Background(), "")
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := test.call(); err != ErrWriterUnavailable {
				t.Fatalf("got error %v, want %v", err, ErrWriterUnavailable)
			}
		})
	}
}

func TestEmptyGroupWriter(t *testing.T) {
	writer := EmptyGroupWriter{}
	tests := []struct {
		name string
		call func() error
	}{
		{
			name: "SetMembers",
			call: func() error {
				return writer.SetMembers(context.Background(), nil, GroupMembers{})
			},
		},
		{
			name: "MoveMembers",
			call: func() error {
				return writer.MoveMembers(context.Background(), nil, MoveMembers{})
			},
		},
		{
			name: "RemoveAllMembers",
			call: func() error {
				return writer.RemoveAllMembers(context.Background(), nil, "")
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := test.call(); err != ErrWriterUnavailable {
				t.Fatalf("got error %v, want %v", err, ErrWriterUnavailable)
			}
		})
	}
}
