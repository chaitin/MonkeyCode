package telemetry

import (
	"net/url"

	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

var allowedSpanAttributes = map[attribute.Key]struct{}{
	"monkeycode.task.id":           {},
	"monkeycode.agent.session.id":  {},
	"monkeycode.request.id":        {},
	"monkeycode.project.id":        {},
	"taskflow.vm.id":               {},
	"taskflow.terminal.session.id": {},
	"taskflow.operation":           {},
	"taskflow.stage":               {},
	"telemetry.priority":           {},
	"telemetry.noise":              {},
	"task.outcome":                 {},
	"error.type":                   {},
	"exception.type":               {},
	"http.request.method":          {},
	"http.response.status_code":    {},
	"http.route":                   {},
	"http.method":                  {},
	"http.status_code":             {},
	"http.flavor":                  {},
	"http.scheme":                  {},
	"server.address":               {},
	"server.port":                  {},
	"network.protocol.name":        {},
	"network.protocol.version":     {},
	"network.transport":            {},
	"network.type":                 {},
	"net.host.name":                {},
	"net.host.port":                {},
	"net.protocol.name":            {},
	"net.protocol.version":         {},
	"net.transport":                {},
	"rpc.system":                   {},
	"rpc.service":                  {},
	"rpc.method":                   {},
	"rpc.grpc.status_code":         {},
	"db.system.name":               {},
	"db.namespace":                 {},
	"db.operation.name":            {},
	"db.collection.name":           {},
	"db.system":                    {},
	"db.name":                      {},
	"db.operation":                 {},
	"db.sql.table":                 {},
}

func sanitizeAttributes(attrs []attribute.KeyValue) []attribute.KeyValue {
	filtered := make([]attribute.KeyValue, 0, len(attrs))
	noise := false
	hasNoise := false
	for _, attr := range attrs {
		if _, ok := allowedSpanAttributes[attr.Key]; ok {
			filtered = append(filtered, attr)
			if attr.Key == "telemetry.noise" {
				hasNoise = true
				if attr.Value.Type() == attribute.BOOL && attr.Value.AsBool() {
					noise = true
				}
			}
			continue
		}
		if isNoiseURL(attr) {
			noise = true
		}
	}
	if noise && !hasNoise {
		filtered = append(filtered, attribute.Bool("telemetry.noise", true))
	}
	return filtered
}

func isNoiseURL(attr attribute.KeyValue) bool {
	switch attr.Key {
	case "url.full", "url.path", "http.url", "http.target":
	default:
		return false
	}
	if attr.Value.Type() != attribute.STRING {
		return false
	}
	parsed, err := url.Parse(attr.Value.AsString())
	if err != nil {
		return false
	}
	switch parsed.Path {
	case "/health", "/metrics", "/internal/vm/activity", "/internal/stats", "/internal/host/is-online", "/internal/vm/is-online":
		return true
	default:
		return false
	}
}

func sanitizeEvents(events []sdktrace.Event) []sdktrace.Event {
	filtered := make([]sdktrace.Event, 0, len(events))
	for _, event := range events {
		if event.Name != "exception" {
			continue
		}
		event.Attributes = sanitizeAttributes(event.Attributes)
		event.DroppedAttributeCount = 0
		filtered = append(filtered, event)
	}
	return filtered
}

func sanitizeLinks(links []sdktrace.Link) []sdktrace.Link {
	filtered := make([]sdktrace.Link, len(links))
	for i, link := range links {
		link.Attributes = sanitizeAttributes(link.Attributes)
		link.DroppedAttributeCount = 0
		filtered[i] = link
	}
	return filtered
}

func sanitizeStatus(status sdktrace.Status) sdktrace.Status {
	status.Description = ""
	return status
}
