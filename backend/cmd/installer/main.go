package main

import (
	"fmt"
	"os"

	"github.com/chaitin/MonkeyCode/backend/pkg/installer/app"
	"github.com/chaitin/MonkeyCode/backend/pkg/installer/logging"
	"github.com/chaitin/MonkeyCode/backend/pkg/installer/steps"
)

type mode string

const (
	modeHost   mode = "host"
	modeCenter mode = "center"
)

func parseMode(args []string) (mode, error) {
	if len(args) <= 1 {
		return modeHost, nil
	}
	switch mode(args[1]) {
	case modeHost:
		return modeHost, nil
	case modeCenter:
		return modeCenter, nil
	default:
		return "", fmt.Errorf("未知模式 %q（支持 host / center）", args[1])
	}
}

func main() {
	m, err := parseMode(os.Args)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	logger, err := logging.New()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	defer logger.Close()

	a := buildApp(m, logger)
	os.Exit(a.Run())
}

const centerBanner = `
                      █                                      █                             
 █▒  ▒█               █                     ░███▒            █                  ██   █████ 
 ██  ██               █                    ░█▒ ░█            █                  ██     █   
 ██░░██  ███   █▒██▒  █  ▒█   ███   █░  █  █▒      ███    ██▓█   ███           ▒██▒    █   
 █▒▓▓▒█ █▓ ▓█  █▓ ▒█  █ ▒█   ▓▓ ▒█  ▓▒ ▒▓  █      █▓ ▓█  █▓ ▓█  ▓▓ ▒█          ▓▒▒▓    █   
 █ ██ █ █   █  █   █  █▒█    █   █  ▒█ █▒  █      █   █  █   █  █   █          █░░█    █   
 █ █▓ █ █   █  █   █  ██▓    █████   █ █   █      █   █  █   █  █████   ███    █  █    █   
 █    █ █   █  █   █  █░█░   █       █▓▓   █▒     █   █  █   █  █             ▒████▒   █   
 █    █ █▓ ▓█  █   █  █ ░█   ▓▓  █   ▓█▒   ░█▒ ░▓ █▓ ▓█  █▓ ▓█  ▓▓  █         ▓▒  ▒▓   █   
 █    █  ███   █   █  █  ▒█   ███▒   ▒█     ▒███▒  ███    ██▓█   ███▒         █░  ░█ █████ 
                                     ▒█                                                    
                                     █▒                                                    
                                    ██                                                     
`

const hostBanner = `
                      █                                      █                                                         
 █▒  ▒█               █                     ░███▒            █                █████                                    
 ██  ██               █                    ░█▒ ░█            █                █   ▓█                                   
 ██░░██  ███   █▒██▒  █  ▒█   ███   █░  █  █▒      ███    ██▓█   ███          █    █ █   █  █▒██▒  █▒██▒   ███    █▒██▒
 █▒▓▓▒█ █▓ ▓█  █▓ ▒█  █ ▒█   ▓▓ ▒█  ▓▒ ▒▓  █      █▓ ▓█  █▓ ▓█  ▓▓ ▒█         █   ▒█ █   █  █▓ ▒█  █▓ ▒█  ▓▓ ▒█   ██  █
 █ ██ █ █   █  █   █  █▒█    █   █  ▒█ █▒  █      █   █  █   █  █   █         █████  █   █  █   █  █   █  █   █   █    
 █ █▓ █ █   █  █   █  ██▓    █████   █ █   █      █   █  █   █  █████         █  ░█▒ █   █  █   █  █   █  █████   █    
 █    █ █   █  █   █  █░█░   █       █▓▓   █▒     █   █  █   █  █             █   ░█ █   █  █   █  █   █  █       █    
 █    █ █▓ ▓█  █   █  █ ░█   ▓▓  █   ▓█▒   ░█▒ ░▓ █▓ ▓█  █▓ ▓█  ▓▓  █         █    █ █▒ ▓█  █   █  █   █  ▓▓  █   █    
 █    █  ███   █   █  █  ▒█   ███▒   ▒█     ▒███▒  ███    ██▓█   ███▒         █    ▒ ▒██▒█  █   █  █   █   ███▒   █    
                                     ▒█                                                                                
                                     █▒                                                                                
                                    ██                                                                                 
`

func buildApp(m mode, logger *logging.Logger) *app.App {
	switch m {
	case modeCenter:
		return &app.App{
			Title:  "MonkeyCode AI Installer",
			Banner: centerBanner,
			Logger: logger,
			Actions: []app.Action{
				{Label: "安装", Value: "install", Steps: []steps.Step{
					&steps.CheckDocker{},
					&steps.InstallDocker{},
					&steps.ServiceForm{},
					&steps.InstallService{},
				}},
			},
		}
	default:
		return &app.App{
			Title:  "MonkeyCode Runner Installer",
			Banner: hostBanner,
			Logger: logger,
			Actions: []app.Action{
				{Label: "安装", Value: "install", Steps: []steps.Step{
					&steps.CheckDocker{},
					&steps.HostInstall{},
				}},
				{Label: "卸载", Value: "uninstall", Steps: []steps.Step{
					&steps.HostUninstall{},
				}},
			},
		}
	}
}
