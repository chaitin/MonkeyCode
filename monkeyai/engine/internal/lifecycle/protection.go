package lifecycle

import (
	"regexp"
	"time"
)

var protectionID = regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$`)

type Protection struct {
	ID         string    `json:"id"`
	Generation int64     `json:"generation"`
	At         time.Time `json:"at"`
	Reason     string    `json:"reason"`
}

func (p Protection) Valid(generation int64) bool {
	return protectionID.MatchString(p.ID) && p.Generation > 0 && p.Generation <= generation && !p.At.IsZero() && p.Reason == "storage_pressure"
}
