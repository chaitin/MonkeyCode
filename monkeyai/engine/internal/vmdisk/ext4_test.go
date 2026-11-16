package vmdisk

import (
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"
)

func TestSyncExt4(t *testing.T) {
	for _, tt := range []struct {
		name   string
		mutate func([]byte)
		valid  bool
	}{
		{name: "valid", valid: true},
		{name: "bad magic", mutate: func(b []byte) { b[56] = 0 }},
		{name: "bad block size", mutate: func(b []byte) { binary.LittleEndian.PutUint32(b[24:], 1) }},
		{name: "no extents", mutate: func(b []byte) { binary.LittleEndian.PutUint32(b[96:], 0) }},
		{name: "zero blocks", mutate: func(b []byte) { binary.LittleEndian.PutUint32(b[4:], 0) }},
		{name: "oversized filesystem", mutate: func(b []byte) { binary.LittleEndian.PutUint32(b[4:], 16385) }},
		{name: "oversized 64 bit filesystem", mutate: func(b []byte) { binary.LittleEndian.PutUint32(b[96:], 0xc0); binary.LittleEndian.PutUint32(b[336:], 1) }},
	} {
		t.Run(tt.name, func(t *testing.T) {
			f, err := os.OpenFile(filepath.Join(t.TempDir(), "root.ext4"), os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
			if err != nil {
				t.Fatal(err)
			}
			defer f.Close()
			if err := f.Truncate(64 << 20); err != nil {
				t.Fatal(err)
			}
			b := make([]byte, 1024)
			binary.LittleEndian.PutUint32(b[4:], 16384)
			binary.LittleEndian.PutUint32(b[24:], 2)
			binary.LittleEndian.PutUint16(b[56:], 0xef53)
			binary.LittleEndian.PutUint32(b[96:], 0x40)
			if tt.mutate != nil {
				tt.mutate(b)
			}
			if _, err := f.WriteAt(b, 1024); err != nil {
				t.Fatal(err)
			}
			err = syncExt4(f)
			if (err == nil) != tt.valid {
				t.Fatalf("syncExt4() = %v, valid = %v", err, tt.valid)
			}
		})
	}
}

func TestSyncExt4RejectsTruncatedSuperblock(t *testing.T) {
	f, err := os.CreateTemp(t.TempDir(), "root-*")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if err := syncExt4(f); err == nil {
		t.Fatal("接受了缺失 superblock 的文件")
	}
}
