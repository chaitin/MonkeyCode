package resource

import "testing"

func TestStableByName(t *testing.T) {
	items := []Object{
		{"id": "2", "name": "Beta"},
		{"id": "3", "name": "ALPHA"},
		{"id": "1", "name": "alpha"},
		{"id": "0", "name": ""},
	}
	StableByName(items)
	got := []string{}
	for _, item := range items {
		got = append(got, item.String("id"))
	}
	want := []string{"0", "1", "3", "2"}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("order = %v, want %v", got, want)
		}
	}
}

func TestStableByID(t *testing.T) {
	items := []Object{
		{"id": "2", "name": "Alpha"},
		{"id": "1", "name": "Zulu"},
		{"id": "3", "name": "Beta"},
	}
	Stable(items)
	got := []string{}
	for _, item := range items {
		got = append(got, item.String("id"))
	}
	want := []string{"1", "2", "3"}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("order = %v, want %v", got, want)
		}
	}
}
