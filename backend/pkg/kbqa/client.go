// Package kbqa 封装 baizhi 知识库的 OpenAI 兼容问答接口（/share/v1/chat/completions），
// 供微信公众号文本消息自动问答使用。单轮问答，stream=false 直接取完整答案。
package kbqa

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

// Client 知识库问答客户端
type Client struct {
	http    *http.Client
	baseURL string
	apiKey  string
	model   string
}

// defaultModel 未配置 model 时的兜底模型
const defaultModel = "deepseek-v3.2"

// NewClient 创建客户端。baseURL 形如 https://monkeycode.docs.baizhi.cloud
func NewClient(baseURL, apiKey, model string) *Client {
	if model == "" {
		model = defaultModel
	}
	return &Client{
		http:    &http.Client{Timeout: 30 * time.Second},
		baseURL: strings.TrimRight(baseURL, "/"),
		apiKey:  apiKey,
		model:   model,
	}
}

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatReq struct {
	Model    string        `json:"model"`
	Stream   bool          `json:"stream"`
	Messages []chatMessage `json:"messages"`
}

type chatResp struct {
	Choices []struct {
		Message chatMessage `json:"message"`
	} `json:"choices"`
}

// 微信公众号文本消息是纯文本、不渲染 markdown，但会把裸 http(s) URL 自动变成可点链接。
// 故清洗策略：图片/链接一律转成裸 URL，去掉引用角标和加粗/标题等渲染不出来的标记。
var (
	citationRe   = regexp.MustCompile(`\[\[\d+\]\([^)]*\)\]`)    // [[1](url)] 引用角标
	codeFenceRe  = regexp.MustCompile("(?m)^[ \\t]*```.*\\n?")  // ```lang 代码块围栏行（连同换行）
	inlineCodeRe = regexp.MustCompile("`([^`]+)`")              // `行内代码`
	imageRe      = regexp.MustCompile(`!\[[^\]]*\]\(([^)]+)\)`)  // ![alt](url) 图片 → 裸 URL
	linkRe       = regexp.MustCompile(`\[([^\]]+)\]\(([^)]+)\)`) // [text](url) 链接 → 文字：URL
	boldRe       = regexp.MustCompile(`\*\*([^*]+)\*\*`)         // **加粗**
	italicRe     = regexp.MustCompile(`\*([^*]+)\*`)            // *斜体*
	headingRe    = regexp.MustCompile(`(?m)^\s*#{1,6}\s*`)       // # 标题
	blankLinesRe = regexp.MustCompile(`\n{3,}`)                 // 多余空行
)

// cleanForWeChat 把 markdown 答案转成微信纯文本友好的形式。
// 顺序有依赖：代码围栏先于行内代码；图片先于链接（![..](..) 内含 [..](..)）；
// 加粗(**)先于斜体(*)。注意这是 best-effort 正则清洗，非完整 markdown 解析，
// 代码块内若恰好含 markdown 标记可能被一并处理。
func cleanForWeChat(s string) string {
	s = citationRe.ReplaceAllString(s, "")       // 去引用角标
	s = codeFenceRe.ReplaceAllString(s, "")      // 去代码块围栏行，保留代码内容
	s = inlineCodeRe.ReplaceAllString(s, "$1")   // 去行内代码反引号
	s = imageRe.ReplaceAllString(s, "\n$1\n")    // 图片 → 独占一行的裸 URL（可点）
	s = linkRe.ReplaceAllString(s, "$1：$2")      // 链接 → 文字：URL
	s = boldRe.ReplaceAllString(s, "$1")         // 去 **加粗**
	s = italicRe.ReplaceAllString(s, "$1")       // 去 *斜体*
	s = headingRe.ReplaceAllString(s, "")        // 去 # 标题
	s = blankLinesRe.ReplaceAllString(s, "\n\n") // 收敛连续空行
	return strings.TrimSpace(s)
}

// Ask 单轮问答，返回清洗后的完整答案。
func (c *Client) Ask(ctx context.Context, question string) (string, error) {
	payload, err := json.Marshal(&chatReq{
		Model:    c.model,
		Stream:   false,
		Messages: []chatMessage{{Role: "user", Content: question}},
	})
	if err != nil {
		return "", fmt.Errorf("kbqa: marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		c.baseURL+"/share/v1/chat/completions", bytes.NewReader(payload))
	if err != nil {
		return "", fmt.Errorf("kbqa: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("kbqa: do request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("kbqa: read body: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("kbqa: status %d: %s", resp.StatusCode, string(body))
	}

	var r chatResp
	if err := json.Unmarshal(body, &r); err != nil {
		return "", fmt.Errorf("kbqa: unmarshal body: %w", err)
	}
	if len(r.Choices) == 0 {
		return "", fmt.Errorf("kbqa: empty choices")
	}

	answer := cleanForWeChat(r.Choices[0].Message.Content)
	if answer == "" {
		return "", fmt.Errorf("kbqa: empty answer")
	}
	return answer, nil
}
