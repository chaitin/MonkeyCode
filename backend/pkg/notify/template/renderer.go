package template

import (
	"fmt"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/notify/channel"
)

type Renderer interface {
	EventType() consts.NotifyEventType
	Render(event *domain.NotifyEvent) (channel.Message, error)
}

type Registry struct {
	renderers map[consts.NotifyEventType]Renderer
}

func NewDefaultRegistry() *Registry {
	r := &Registry{renderers: make(map[consts.NotifyEventType]Renderer)}
	for _, rr := range []Renderer{
		&TaskCreatedRenderer{},
		&TaskEndedRenderer{},
		&VMExpiringSoonRenderer{},
	} {
		r.renderers[rr.EventType()] = rr
	}
	return r
}

func (r *Registry) Render(event *domain.NotifyEvent) (channel.Message, error) {
	rr, ok := r.renderers[event.EventType]
	if !ok {
		return channel.Message{}, fmt.Errorf("no renderer for event type %s", event.EventType)
	}
	return rr.Render(event)
}
