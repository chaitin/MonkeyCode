package setting

import "sync"

type Event struct {
	Key     string `json:"key"`
	Version int64  `json:"version"`
}

type Broker struct {
	mu          sync.Mutex
	subscribers map[chan Event]struct{}
}

func NewBroker() *Broker {
	return &Broker{subscribers: make(map[chan Event]struct{})}
}

func (b *Broker) Subscribe() (<-chan Event, func()) {
	channel := make(chan Event, 1)
	b.mu.Lock()
	b.subscribers[channel] = struct{}{}
	b.mu.Unlock()

	return channel, func() {
		b.mu.Lock()
		delete(b.subscribers, channel)
		b.mu.Unlock()
	}
}

func (b *Broker) Publish(event Event) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for channel := range b.subscribers {
		select {
		case channel <- event:
		default:
		}
	}
}
