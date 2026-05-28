package main

import (
	"testing"

	"github.com/chaitin/MonkeyCode/backend/pkg/installer/app"
	"github.com/chaitin/MonkeyCode/backend/pkg/installer/logging"
)

func TestBuildAppIncludesUpgradeActions(t *testing.T) {
	logger := logging.NewDiscard()
	center := buildApp(modeCenter, logger)
	if !hasAction(center.Actions, "upgrade") || !hasAction(center.Actions, "rollback") {
		t.Fatalf("center actions = %#v", center.Actions)
	}
	host := buildApp(modeHost, logger)
	if !hasAction(host.Actions, "upgrade") {
		t.Fatalf("host actions = %#v", host.Actions)
	}
}

func hasAction(actions []app.Action, value string) bool {
	for _, action := range actions {
		if action.Value == value {
			return true
		}
	}
	return false
}
