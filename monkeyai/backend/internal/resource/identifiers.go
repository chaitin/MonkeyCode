package resource

import "net/http"

func allocateIDs(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Count int `json:"count"`
	}
	if err := Decode(w, r, &in); err != nil {
		Fail(w, err)
		return
	}
	if in.Count < 1 || in.Count > 1000 {
		Fail(w, Invalid("标识数量必须在 1 到 1000 之间"))
		return
	}
	ids := make([]string, in.Count)
	for i := range ids {
		ids[i] = ID()
	}
	w.Header().Set("Cache-Control", "no-store")
	JSON(w, http.StatusOK, Object{"ids": ids})
}
