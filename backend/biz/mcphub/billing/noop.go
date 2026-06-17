package billing

import "context"

type Noop struct{}

func NewNoop() *Noop {
	return &Noop{}
}

func (n *Noop) CanConsume(context.Context, any) error {
	return nil
}

func (n *Noop) Consume(context.Context, any) error {
	return nil
}
