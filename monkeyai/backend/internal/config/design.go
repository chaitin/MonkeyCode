package config

import (
	"errors"
	"net/url"
	"os"
	"path"
	"strings"
)

var defaultInstanceID string
var defaultDesignRespubURL string
var defaultDesignPublisherID string
var defaultDesignRespubJWTSecret = "OUmqdLTRn2sT5Bm6"
var defaultDesignMediaJWTSecret string

type Design struct {
	InstanceID            string
	DesignRespubURL       string
	DesignPublisherID     string
	DesignRespubJWTSecret string
	DesignMediaJWTSecret  string
}

func designEnv(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}
func loadDesign() Design {
	return Design{
		InstanceID:            designEnv("MONKEYAI_INSTANCE_ID", defaultInstanceID),
		DesignRespubURL:       designEnv("MONKEYAI_DESIGN_RESPUB_URL", defaultDesignRespubURL),
		DesignPublisherID:     designEnv("MONKEYAI_DESIGN_PUBLISHER_ID", defaultDesignPublisherID),
		DesignRespubJWTSecret: designEnv("MONKEYAI_DESIGN_RESPUB_JWT_SECRET", defaultDesignRespubJWTSecret),
		DesignMediaJWTSecret:  designEnv("MONKEYAI_DESIGN_MEDIA_JWT_SECRET", defaultDesignMediaJWTSecret),
	}
}
func validateDesign(cfg *Design) error {
	cfg.DesignRespubURL = strings.TrimRight(strings.TrimSpace(cfg.DesignRespubURL), "/")
	if cfg.DesignRespubURL == "" {
		return nil
	}
	u, err := url.Parse(cfg.DesignRespubURL)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.Path == "" || u.Path == "/" || path.Clean(u.Path) != u.Path {
		return errors.New("MONKEYAI_DESIGN_RESPUB_URL 必须是包含完整路径且无凭据、查询或片段的 HTTP(S) base")
	}
	return nil
}
