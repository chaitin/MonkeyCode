package preflight

import (
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"golang.org/x/sys/unix"
)

func throughputInfo(dataDir string) throughput {
	read := func(path string) string {
		file, err := os.Open(path)
		if err != nil {
			return ""
		}
		defer file.Close()
		raw, err := io.ReadAll(io.LimitReader(file, 4096))
		if err != nil {
			return ""
		}
		return strings.TrimSpace(string(raw))
	}
	result := throughput{at: time.Now(), network: make(map[string]counters)}
	interfaces, err := net.Interfaces()
	if err == nil {
		for _, iface := range interfaces {
			if !hostInterface(iface) {
				continue
			}
			// 跳过 bridge、bond 的从接口，避免重复累计。
			if _, err := os.Stat(filepath.Join("/sys/class/net", iface.Name, "master")); err == nil {
				continue
			}
			dir := filepath.Join("/sys/class/net", iface.Name, "statistics")
			rx, e1 := strconv.ParseUint(read(filepath.Join(dir, "rx_bytes")), 10, 64)
			tx, e2 := strconv.ParseUint(read(filepath.Join(dir, "tx_bytes")), 10, 64)
			if e1 != nil || e2 != nil {
				result.network = nil
				break
			}
			result.network[fmt.Sprintf("%d:%s", iface.Index, iface.Name)] = counters{rx, tx}
		}
	}
	var stat unix.Stat_t
	if unix.Stat(dataDir, &stat) == nil {
		result.device = fmt.Sprintf("%d:%d", unix.Major(uint64(stat.Dev)), unix.Minor(uint64(stat.Dev)))
		result.disk = diskCounters(read(filepath.Join("/sys/dev/block", result.device, "stat")))
	}
	return result
}
