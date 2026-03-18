package channel

import (
	"context"
	"github.com/chaitin/MonkeyCode/backend/consts"
)

type Message struct {
	Title string
	Body  string
}

type ChannelConfig struct {
	WebhookURL string
	Secret     string
	Headers    map[string]string
}

type Sender interface {
	Kind() consts.NotifyChannelKind
	Send(ctx context.Context, cfg *ChannelConfig, msg Message) error
}

type Registry struct {
	senders map[consts.NotifyChannelKind]Sender
}

func NewRegistry(senders ...Sender) *Registry {
	r := &Registry{senders: make(map[consts.NotifyChannelKind]Sender, len(senders))}
	for _, s := range senders {
		r.senders[s.Kind()] = s
	}
	return r
}

func (r *Registry) Get(kind consts.NotifyChannelKind) (Sender, bool) {
	s, ok := r.senders[kind]
	return s, ok
}
