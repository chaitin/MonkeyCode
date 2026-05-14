package steps

import "bytes"

type reporterWriter struct {
	r      Reporter
	prefix string
	buf    bytes.Buffer
}

func (w *reporterWriter) Write(p []byte) (int, error) {
	w.buf.Write(p)
	for {
		raw := w.buf.Bytes()
		idx := bytes.IndexByte(raw, '\n')
		if idx < 0 {
			break
		}
		line := string(raw[:idx])
		w.buf.Next(idx + 1)
		w.r.Log("%s%s", w.prefix, line)
	}
	return len(p), nil
}
