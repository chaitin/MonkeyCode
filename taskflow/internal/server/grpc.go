package server

import (
	"net"

	"google.golang.org/grpc"
)

type GRPCServer struct {
	*grpc.Server
	listener net.Listener
}

func NewGRPCServer(addr string) (*GRPCServer, error) {
	lis, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, err
	}

	srv := grpc.NewServer()
	return &GRPCServer{
		Server:   srv,
		listener: lis,
	}, nil
}

func (s *GRPCServer) Serve() error {
	return s.Server.Serve(s.listener)
}
