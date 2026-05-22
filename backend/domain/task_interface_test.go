package domain

import (
	"context"
	"testing"
)

type taskCreatorFunc struct{}

func (taskCreatorFunc) Create(ctx context.Context, user *User, req CreateTaskReq) (*ProjectTask, error) {
	return &ProjectTask{}, nil
}

func TestTaskCreatorInterface(t *testing.T) {
	var creator TaskCreator = taskCreatorFunc{}
	got, err := creator.Create(context.Background(), &User{}, CreateTaskReq{})
	if err != nil {
		t.Fatal(err)
	}
	if got == nil {
		t.Fatal("Create() returned nil task")
	}
}
