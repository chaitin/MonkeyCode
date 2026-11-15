package preflight

import (
	"strconv"
	"strings"
	"time"
)

type Network struct {
	ReceiveBytesPerSecond  float64 `json:"receive_bytes_per_second"`
	TransmitBytesPerSecond float64 `json:"transmit_bytes_per_second"`
}

type DiskIO struct {
	ReadBytesPerSecond  float64 `json:"read_bytes_per_second"`
	WriteBytesPerSecond float64 `json:"write_bytes_per_second"`
}

type counters struct{ first, second uint64 }

type throughput struct {
	at      time.Time
	network map[string]counters
	device  string
	disk    *counters
}

func delta(previous, current counters, seconds float64) (float64, float64, bool) {
	if seconds <= 0 || current.first < previous.first || current.second < previous.second {
		return 0, 0, false
	}
	return float64(current.first-previous.first) / seconds, float64(current.second-previous.second) / seconds, true
}

func rates(previous, current throughput) (*Network, *DiskIO) {
	if previous.at.IsZero() {
		return nil, nil
	}
	seconds := current.at.Sub(previous.at).Seconds()
	var network *Network
	if len(previous.network) > 0 && len(previous.network) == len(current.network) {
		total := &Network{}
		valid := true
		for name, value := range current.network {
			old, found := previous.network[name]
			rx, tx, ok := delta(old, value, seconds)
			if !found || !ok {
				valid = false
				break
			}
			total.ReceiveBytesPerSecond += rx
			total.TransmitBytesPerSecond += tx
		}
		if valid {
			network = total
		}
	}
	var disk *DiskIO
	if previous.disk != nil && current.disk != nil && previous.device == current.device {
		read, write, ok := delta(*previous.disk, *current.disk, seconds)
		if ok {
			disk = &DiskIO{read, write}
		}
	}
	return network, disk
}

func diskCounters(raw string) *counters {
	fields := strings.Fields(raw)
	if len(fields) < 7 {
		return nil
	}
	read, e1 := strconv.ParseUint(fields[2], 10, 64)
	write, e2 := strconv.ParseUint(fields[6], 10, 64)
	if e1 != nil || e2 != nil || read > ^uint64(0)/512 || write > ^uint64(0)/512 {
		return nil
	}
	return &counters{read * 512, write * 512}
}
