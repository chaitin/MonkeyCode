package service

import (
	"net/http"
	_ "net/http/pprof"
)

type pprofSvc struct {
}

func (p *pprofSvc) Name() string {
	return "Pprof Server"
}

func (p *pprofSvc) Start() error {
	return http.ListenAndServe(":6060", nil)
}

func (p *pprofSvc) Stop() error {
	return nil
}
