package videogen

import (
	"encoding/binary"
	"errors"
	"math/big"
	"os"
)

type mediaInfo struct {
	Width, Height int
	DurationMs    int64
}

func inspectMP4(file *os.File, size int64) (mediaInfo, error) {
	if size < 32 || size > 256<<20 {
		return mediaInfo{}, errors.New("视频文件大小无效")
	}
	var info mediaInfo
	var foundFileType bool
	boxes := 0
	var scan func(int64, int64, int) error
	scan = func(start, end int64, depth int) error {
		for start < end {
			boxes++
			if boxes > 10_000 {
				return errors.New("视频容器盒数量超出限制")
			}
			if end-start < 8 {
				return errors.New("视频容器结构无效")
			}
			var header [16]byte
			if _, err := file.ReadAt(header[:8], start); err != nil {
				return err
			}
			length := int64(binary.BigEndian.Uint32(header[:4]))
			headerLength := int64(8)
			if length == 1 {
				if _, err := file.ReadAt(header[8:], start+8); err != nil {
					return err
				}
				length = int64(binary.BigEndian.Uint64(header[8:]))
				headerLength = 16
			} else if length == 0 {
				length = end - start
			}
			if length < headerLength || length > end-start {
				return errors.New("视频容器大小无效")
			}
			payload := start + headerLength
			switch string(header[4:8]) {
			case "ftyp":
				if depth == 0 && start == 0 {
					foundFileType = true
				}
			case "moov", "trak":
				if depth < 2 {
					if err := scan(payload, start+length, depth+1); err != nil {
						return err
					}
				}
			case "mvhd":
				var data [32]byte
				if depth == 1 && length-headerLength >= 32 {
					if _, err := file.ReadAt(data[:], payload); err != nil {
						return err
					}
					var scale, duration uint64
					if data[0] == 0 {
						scale = uint64(binary.BigEndian.Uint32(data[12:16]))
						duration = uint64(binary.BigEndian.Uint32(data[16:20]))
					} else if data[0] == 1 {
						scale = uint64(binary.BigEndian.Uint32(data[20:24]))
						if length-headerLength < 32 {
							return errors.New("视频时长数据不足")
						}
						duration = binary.BigEndian.Uint64(data[24:32])
					}
					if scale > 0 {
						ms := new(big.Int).Mul(new(big.Int).SetUint64(duration), big.NewInt(1000))
						ms.Div(ms, new(big.Int).SetUint64(scale))
						if ms.IsInt64() {
							info.DurationMs = ms.Int64()
						}
					}
				}
			case "tkhd":
				if depth == 2 && length-headerLength >= 84 {
					var version [1]byte
					if _, err := file.ReadAt(version[:], payload); err != nil {
						return err
					}
					offset := int64(76)
					if version[0] == 1 {
						offset = 88
					}
					if length-headerLength >= offset+8 {
						var dims [8]byte
						if _, err := file.ReadAt(dims[:], payload+offset); err != nil {
							return err
						}
						width, height := int(binary.BigEndian.Uint32(dims[:4])>>16), int(binary.BigEndian.Uint32(dims[4:])>>16)
						if width > 0 && height > 0 {
							info.Width, info.Height = width, height
						}
					}
				}
			}
			start += length
		}
		return nil
	}
	if err := scan(0, size, 0); err != nil {
		return mediaInfo{}, err
	}
	if !foundFileType || info.Width < 1 || info.Height < 1 || info.Width > 8192 || info.Height > 8192 ||
		int64(info.Width)*int64(info.Height) > 35_000_000 || info.DurationMs < 1 || info.DurationMs > 15_000 {
		return mediaInfo{}, errors.New("视频容器元数据无效")
	}
	return info, nil
}
