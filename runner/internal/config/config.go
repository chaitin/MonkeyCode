package config

import (
	"os"
	"strconv"
)

type Config struct {
	Token    string
	GRPCAddr string
}

func Load() *Config {
	return &Config{
		Token:    getEnv("TOKEN", ""),
		GRPCAddr: getEnv("GRPC_URL", "localhost:50051"),
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if i, err := strconv.Atoi(value); err == nil {
			return i
		}
	}
	return defaultValue
}
