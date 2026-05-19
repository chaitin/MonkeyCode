package steps

import (
	"strings"
)

type ServiceForm struct{}

func (s *ServiceForm) Name() string { return "收集安装参数" }

func (s *ServiceForm) Run(c *Context) error {
	c.Reporter.SetStep("收集安装参数...", "下一步: 服务端安装")

	values, err := c.Reporter.AskForm([]FormField{
		{Label: "安装目录", Default: "/data/monkeycode-ai", Help: "请输入绝对路径", Validate: validateAbsPath},
		{Label: "访问地址", Help: "请输入用户和宿主机能访问到的 IP 或域名，不含协议和端口", Validate: validateAccessHost},
		{Label: "访问端口", Default: "80", Validate: validatePort},
		{Label: "管理员邮箱", Validate: validateEmail},
		{Label: "团队名称", Default: "MonkeyCode"},
		{Label: "管理员密码", Password: true, Help: "留空时自动生成随机密码"},
	})
	if err != nil {
		return err
	}

	c.Input.InstallDir = strings.TrimSpace(values[0])
	c.Input.AccessHost = strings.TrimSpace(values[1])
	c.Input.NginxPort = strings.TrimSpace(values[2])
	c.Input.TeamEmail = strings.TrimSpace(values[3])
	c.Input.TeamName = strings.TrimSpace(values[4])
	c.Input.TeamPassword = strings.TrimSpace(values[5])

	c.Log("安装目录   %s", c.Input.InstallDir)
	c.Log("访问地址   %s", c.Input.AccessHost)
	c.Log("Nginx 端口 %s", c.Input.NginxPort)
	c.Log("管理员     %s", c.Input.TeamEmail)
	c.Log("团队名称   %s", c.Input.TeamName)
	if c.Input.TeamPassword == "" {
		c.Log("管理员密码 （未提供，安装时自动生成）")
	} else {
		c.LogScreen("管理员密码 %s", c.Input.TeamPassword)
		c.LogFile("管理员密码 ********")
	}
	return nil
}
