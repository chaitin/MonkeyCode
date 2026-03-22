package main

import (
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/chaitin/MonkeyCode/taskflow/internal/config"
)

func main() {
	cfg, err := config.Load("config.yaml")
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	log.Printf("Starting TaskFlow server...")
	log.Printf("HTTP Address: %s", cfg.Server.HTTPAddr)
	log.Printf("gRPC Address: %s", cfg.Server.GRPCAddr)

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh

	log.Println("Shutting down TaskFlow server...")
}
