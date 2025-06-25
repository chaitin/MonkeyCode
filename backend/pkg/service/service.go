package service

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"
)

type Option func(sv *Service)

func WithPprof() Option {
	return func(sv *Service) {
		sv.Add(&pprofSvc{})
	}
}

type Servicer interface {
	Name() string
	// Start never returns
	Start() error
	Stop() error
}

type Service struct {
	svs      []Servicer
	logger   *slog.Logger
	stopDone chan struct{}
}

func NewService(opts ...Option) *Service {
	sv := &Service{
		svs:      make([]Servicer, 0),
		logger:   slog.Default(),
		stopDone: make(chan struct{}),
	}
	for _, opt := range opts {
		opt(sv)
	}
	return sv
}

func (s *Service) Run() error {
	ech := s.start()
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)

	select {
	case <-sig:
		s.logger.Info("Received signal to stop")
	case err := <-ech:
		s.logger.Error("Received error from service start", "error", err)
	}

	timeout, cancel2 := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel2()

	go func() {
		if err := s.stop(); err != nil {
			s.logger.Error("Service stop failed", "error", err)
		}
	}()

	select {
	case <-timeout.Done():
		s.logger.Info("Service stop timeout")
	case <-s.stopDone:
		s.logger.Info("Service stop done")
	}
	return nil
}

func (s *Service) Add(sv Servicer) {
	s.svs = append(s.svs, sv)
}

func (s *Service) start() chan error {
	ech := make(chan error, len(s.svs))
	for _, sv := range s.svs {
		go func(sv Servicer) {
			s.logger.Info("Starting service", "name", sv.Name())
			err := sv.Start()
			ech <- fmt.Errorf("[%s] Service shutdown: %w", sv.Name(), err)
		}(sv)
	}
	return ech
}

func (s *Service) stop() error {
	wg := sync.WaitGroup{}
	for i := len(s.svs) - 1; i >= 0; i-- {
		wg.Add(1)
		go func(sv Servicer) {
			defer wg.Done()
			s.logger.Info("Stopping service", "name", sv.Name())
			if err := sv.Stop(); err != nil {
				s.logger.Error("Service stop failed", "name", sv.Name(), "error", err)
			}
		}(s.svs[i])
	}
	wg.Wait()

	close(s.stopDone)
	return nil
}
