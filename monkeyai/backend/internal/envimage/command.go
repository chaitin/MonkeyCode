package envimage

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"io"
	"os"
	"strings"
	"time"
)

// Command 仅处理本地Registry资源，不连接数据库或启动业务HTTP服务。
func Command(ctx context.Context, args []string, out io.Writer) error {
	flags := flag.NewFlagSet("environment-images", flag.ContinueOnError)
	flags.SetOutput(out)
	directory := flags.String("directory", "", "可选的一次性OCI导入目录")
	selected := flags.String("image", "", "固定摘要的原始镜像")
	check := flags.Bool("check", false, "只验证本地完整资源，不修改默认选择")
	root := flags.String("state-dir", os.Getenv("MONKEYAI_ENVIRONMENT_IMAGE_STATE_DIR"), "Registry持久目录")
	public := flags.String("public-url", os.Getenv("MONKEYAI_PUBLIC_URL"), "服务公开根地址")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 || *root == "" || *public == "" || *selected == "" || *check && *directory != "" {
		return errors.New("请指定Registry目录、公开地址和固定镜像；check不接受导入目录")
	}
	if _, err := source(*selected); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Minute)
	defer cancel()
	service, err := New(ctx, *root, strings.TrimRight(*public, "/"))
	if err != nil {
		return err
	}
	defer service.Close()
	var result ImportStatus
	if *check {
		result, err = service.Check(ctx, *selected)
	} else {
		result, err = service.Prepare(ctx, *selected, *directory)
	}
	if err != nil {
		return err
	}
	return json.NewEncoder(out).Encode(result)
}
