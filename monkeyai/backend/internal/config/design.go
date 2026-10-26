package config

import "os"

const designRespubURL = "https://hub.monkeycode-ai.com/api/design"

var defaultDesignPublisherID string
var defaultDesignRespubJWTSecret = "OUmqdLTRn2sT5Bm6"
var defaultDesignMediaJWTSecret string

type Design struct {
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
		DesignRespubURL:       designRespubURL,
		DesignPublisherID:     designEnv("MONKEYAI_DESIGN_PUBLISHER_ID", defaultDesignPublisherID),
		DesignRespubJWTSecret: designEnv("MONKEYAI_DESIGN_RESPUB_JWT_SECRET", defaultDesignRespubJWTSecret),
		DesignMediaJWTSecret:  designEnv("MONKEYAI_DESIGN_MEDIA_JWT_SECRET", defaultDesignMediaJWTSecret),
	}
}
