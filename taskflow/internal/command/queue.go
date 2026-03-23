package command

import (
	"sync"
)

type CommandType string

const (
	CommandCreateVM   CommandType = "create_vm"
	CommandDeleteVM   CommandType = "delete_vm"
	CommandCreateTask CommandType = "create_task"
	CommandStopTask   CommandType = "stop_task"
)

type Command struct {
	ID      string
	Type    CommandType
	RunnerID string
	Payload map[string]interface{}
}

type Queue struct {
	mu       sync.RWMutex
	commands map[string][]*Command
}

func NewQueue() *Queue {
	return &Queue{
		commands: make(map[string][]*Command),
	}
}

func (q *Queue) Push(runnerID string, cmd *Command) {
	q.mu.Lock()
	defer q.mu.Unlock()

	q.commands[runnerID] = append(q.commands[runnerID], cmd)
}

func (q *Queue) Pop(runnerID string) *Command {
	q.mu.Lock()
	defer q.mu.Unlock()

	cmds, ok := q.commands[runnerID]
	if !ok || len(cmds) == 0 {
		return nil
	}

	cmd := cmds[0]
	q.commands[runnerID] = cmds[1:]
	return cmd
}

func (q *Queue) PopAll(runnerID string) []*Command {
	q.mu.Lock()
	defer q.mu.Unlock()

	cmds, ok := q.commands[runnerID]
	if !ok {
		return nil
	}

	q.commands[runnerID] = nil
	delete(q.commands, runnerID)
	return cmds
}

func (q *Queue) Count(runnerID string) int {
	q.mu.RLock()
	defer q.mu.RUnlock()

	return len(q.commands[runnerID])
}
