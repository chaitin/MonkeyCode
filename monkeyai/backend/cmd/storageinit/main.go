package main

import (
	"context"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"log"
	"time"
)

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	s, err := resource.NewS3(ctx)
	if err != nil {
		log.Fatal(err)
	}
	if err = s.Init(ctx); err != nil {
		log.Fatal(err)
	}
}
