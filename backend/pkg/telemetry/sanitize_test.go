package telemetry

import (
	"testing"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

func TestSanitizeAttributesUsesAllowlist(t *testing.T) {
	attrs := sanitizeAttributes([]attribute.KeyValue{
		attribute.String("monkeycode.task.id", "task-1"),
		attribute.String("http.request.method", "POST"),
		attribute.String("url.full", "https://example.com/internal/task?token=secret"),
		attribute.String("http.request.body", "prompt-secret"),
		attribute.String("db.query.text", "select * from secret"),
	})
	got := make(map[string]string)
	for _, attr := range attrs {
		got[string(attr.Key)] = attr.Value.Emit()
	}
	if got["monkeycode.task.id"] != "task-1" || got["http.request.method"] != "POST" {
		t.Fatalf("allowed attributes = %#v", got)
	}
	for _, key := range []string{"url.full", "http.request.body", "db.query.text"} {
		if _, ok := got[key]; ok {
			t.Fatalf("sensitive attribute %q was retained", key)
		}
	}
}

func TestSanitizeAttributesMarksNoiseWithoutURL(t *testing.T) {
	attrs := sanitizeAttributes([]attribute.KeyValue{
		attribute.String("url.full", "http://monkeycode/internal/vm/activity"),
	})
	if len(attrs) != 1 || attrs[0].Key != "telemetry.noise" || !attrs[0].Value.AsBool() {
		t.Fatalf("attributes = %#v", attrs)
	}
}

func TestSanitizeEventsAndStatusRemoveErrorDetails(t *testing.T) {
	events := sanitizeEvents([]sdktrace.Event{{
		Name: "exception",
		Attributes: []attribute.KeyValue{
			attribute.String("exception.type", "timeout"),
			attribute.String("exception.message", "token=secret"),
			attribute.String("exception.stacktrace", "secret stack"),
		},
	}})
	if len(events) != 1 || len(events[0].Attributes) != 1 || events[0].Attributes[0].Key != "exception.type" {
		t.Fatalf("events = %#v", events)
	}
	status := sanitizeStatus(sdktrace.Status{Code: codes.Error, Description: "token=secret"})
	if status.Code != codes.Error || status.Description != "" {
		t.Fatalf("status = %#v", status)
	}
}

func TestBuildResourceUsesExplicitAllowlist(t *testing.T) {
	t.Setenv("OTEL_RESOURCE_ATTRIBUTES", "secret.value=do-not-export")
	res := buildResource(Config{
		ServiceName:    "monkeycode-backend",
		ServiceVersion: "v1",
		Environment:    "test",
	})
	attrs := make(map[string]string)
	for _, attr := range res.Attributes() {
		attrs[string(attr.Key)] = attr.Value.AsString()
	}
	if attrs["service.name"] != "monkeycode-backend" || attrs["service.version"] != "v1" || attrs["deployment.environment.name"] != "test" {
		t.Fatalf("resource attributes = %#v", attrs)
	}
	if _, ok := attrs["secret.value"]; ok {
		t.Fatalf("resource attributes contain secret: %#v", attrs)
	}
}
