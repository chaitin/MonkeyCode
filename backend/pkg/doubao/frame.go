package doubao

import (
	"bytes"
	"compress/gzip"
	"encoding/binary"
	"fmt"
	"io"
)

// gzipCompress / gzipDecompress 与豆包 demo 完全等价。
// 豆包要求 payload 在 wire 上是 gzip 压缩后的字节,长度字段是压缩后的长度。
func gzipCompress(in []byte) []byte {
	var buf bytes.Buffer
	w := gzip.NewWriter(&buf)
	_, _ = w.Write(in)
	_ = w.Close()
	return buf.Bytes()
}

func gzipDecompress(in []byte) ([]byte, error) {
	r, err := gzip.NewReader(bytes.NewReader(in))
	if err != nil {
		return nil, fmt.Errorf("gzip reader: %w", err)
	}
	defer r.Close()
	out, err := io.ReadAll(r)
	if err != nil {
		return nil, fmt.Errorf("gzip read: %w", err)
	}
	return out, nil
}

// buildHeader 拼装 4 字节固定头。
//   byte0: ProtocolVersion(4b) | HeaderSize(4b)
//   byte1: MessageType(4b) | MessageTypeSpecificFlags(4b)
//   byte2: Serialization(4b) | Compression(4b)
//   byte3: Reserved (0x00)
func buildHeader(msgType, flags byte) []byte {
	return []byte{
		(protocolVersion << 4) | headerSizeValue,
		(msgType << 4) | flags,
		(serJSON << 4) | cmpGzip,
		0x00,
	}
}

// encodeFullClientRequest 拼第一帧: header + payload_size(4B BE) + gzip(JSON payload)。
// 注意: demo 在 header 后还塞了一个 4B int32 "1" 作为 sequence — 实际抓包看那是
// flagPosSeq 模式下首帧 sequence=1 的语义,本实现保持一致。
func encodeFullClientRequest(payloadJSON []byte) []byte {
	compressed := gzipCompress(payloadJSON)

	buf := bytes.NewBuffer(make([]byte, 0, 4+4+4+len(compressed)))
	buf.Write(buildHeader(msgTypeFullClientReq, flagPosSeq))
	_ = binary.Write(buf, binary.BigEndian, int32(1)) // sequence=1
	_ = binary.Write(buf, binary.BigEndian, int32(len(compressed)))
	buf.Write(compressed)
	return buf.Bytes()
}

// encodeAudioRequest 拼音频帧: header + sequence(4B int32 BE) + payload_size(4B BE) + gzip(audio)。
// seq>0 普通帧,seq<0 表示最后一包(并把 flag 置为 NegWithSeq)。
func encodeAudioRequest(seq int32, audio []byte) []byte {
	flags := flagPosSeq
	if seq < 0 {
		flags = flagNegWithSeq
	}
	compressed := gzipCompress(audio)

	buf := bytes.NewBuffer(make([]byte, 0, 4+4+4+len(compressed)))
	buf.Write(buildHeader(msgTypeAudioOnlyReq, flags))
	_ = binary.Write(buf, binary.BigEndian, seq)
	_ = binary.Write(buf, binary.BigEndian, int32(len(compressed)))
	buf.Write(compressed)
	return buf.Bytes()
}

// parseFrame 解析服务端下发的 frame。
//
// 通用 frame 结构:
//   header(4) + [sequence(4)?] + payload_size_or_error_code(4) + [error_size(4)?] + payload
//
// flag 位决定后续字段:
//   bit0 set → 有 sequence (4B int32 BE)
//   bit1 set → 是最后一包
// messageType=msgTypeServerError 时 payload 之前先有 error_code(4) + error_size(4)。
func parseFrame(msg []byte) (*parsedFrame, error) {
	if len(msg) < 4 {
		return nil, fmt.Errorf("frame too short: %d", len(msg))
	}
	headerSize := int(msg[0]&0x0f) * 4
	if len(msg) < headerSize {
		return nil, fmt.Errorf("frame shorter than header: %d < %d", len(msg), headerSize)
	}
	messageType := msg[1] >> 4
	flags := msg[1] & 0x0f
	serialization := msg[2] >> 4
	compression := msg[2] & 0x0f

	f := &parsedFrame{messageType: messageType}
	rest := msg[headerSize:]

	if flags&0x01 != 0 { // 有 sequence
		if len(rest) < 4 {
			return nil, fmt.Errorf("missing sequence")
		}
		f.sequence = int32(binary.BigEndian.Uint32(rest[:4]))
		rest = rest[4:]
	}
	if flags&0x02 != 0 {
		f.isLastPkg = true
	}

	switch messageType {
	case msgTypeFullServerResp:
		if len(rest) < 4 {
			return nil, fmt.Errorf("missing payload size")
		}
		size := int(binary.BigEndian.Uint32(rest[:4]))
		rest = rest[4:]
		if len(rest) < size {
			return nil, fmt.Errorf("payload truncated: %d < %d", len(rest), size)
		}
		rest = rest[:size]

	case msgTypeServerError:
		if len(rest) < 8 {
			return nil, fmt.Errorf("error frame too short")
		}
		f.errorCode = binary.BigEndian.Uint32(rest[:4])
		size := int(binary.BigEndian.Uint32(rest[4:8]))
		rest = rest[8:]
		if len(rest) < size {
			return nil, fmt.Errorf("error payload truncated: %d < %d", len(rest), size)
		}
		rest = rest[:size]

	default:
		// 其它 message type 暂未见,把剩余原样塞 payload 让上层日志记录
	}

	if len(rest) == 0 {
		return f, nil
	}
	if compression == cmpGzip {
		decoded, err := gzipDecompress(rest)
		if err != nil {
			return nil, fmt.Errorf("decompress payload: %w", err)
		}
		rest = decoded
	}
	// 此处只解 gzip,JSON 反序列化交给上层(因为 server full response 和 error 用不同结构)
	if serialization != serJSON && serialization != serNoSer {
		return nil, fmt.Errorf("unsupported serialization: %d", serialization)
	}
	f.payload = rest
	return f, nil
}
