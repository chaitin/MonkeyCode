package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"os"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/vmimage"
)

func convertLaunchCommand(ctx context.Context, args []string, stderr io.Writer) int {
	flags := flag.NewFlagSet("convert-launch", flag.ContinueOnError)
	flags.SetOutput(stderr)
	uid := flags.Uint("uid", 0, "已租用的隔离转换UID")
	if flags.Parse(args) != nil || flags.NArg() != 0 || *uid < 61184 || *uid > 65519 {
		return 2
	}
	if err := vmimage.ConvertAs(ctx, uint32(*uid), stderr); err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	return 0
}

func convertCommand(ctx context.Context, args []string, stderr io.Writer) int {
	flags := flag.NewFlagSet("convert", flag.ContinueOnError)
	flags.SetOutput(stderr)
	path := flags.String("request", "", "隔离转换请求")
	if flags.Parse(args) != nil || flags.NArg() != 0 || *path != "/request.json" {
		return 2
	}
	if os.Geteuid() == 0 || os.Getenv("INVOCATION_ID") == "" {
		fmt.Fprintln(stderr, "镜像转换只允许由隔离服务调用")
		return 1
	}
	if err := vmimage.ConvertRequest(ctx, *path); err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	return 0
}
