package videogen

import (
	"encoding/binary"
	"os"
	"testing"
)

func mp4Box(name string, payload []byte) []byte {
	box := make([]byte, 8+len(payload))
	binary.BigEndian.PutUint32(box[:4], uint32(len(box)))
	copy(box[4:8], name)
	copy(box[8:], payload)
	return box
}

func TestInspectMP4(t *testing.T) {
	mvhd := make([]byte, 32)
	binary.BigEndian.PutUint32(mvhd[12:16], 1000)
	binary.BigEndian.PutUint32(mvhd[16:20], 6000)
	tkhd := make([]byte, 84)
	binary.BigEndian.PutUint32(tkhd[76:80], 1280<<16)
	binary.BigEndian.PutUint32(tkhd[80:84], 720<<16)
	data := append(mp4Box("ftyp", []byte("isom")), mp4Box("moov", append(mp4Box("mvhd", mvhd), mp4Box("trak", mp4Box("tkhd", tkhd))...))...)
	file, err := os.CreateTemp(t.TempDir(), "valid.mp4")
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	if _, err := file.Write(data); err != nil {
		t.Fatal(err)
	}
	info, err := inspectMP4(file, int64(len(data)))
	if err != nil || info.Width != 1280 || info.Height != 720 || info.DurationMs != 6000 {
		t.Fatalf("解析结果: %+v, 错误: %v", info, err)
	}
	if _, err := inspectMP4(file, int64(len(data)+1)); err == nil {
		t.Fatal("损坏的容器大小应被拒绝")
	}
}
