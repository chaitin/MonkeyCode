// Package memberscope binds an authenticated employee scope to an admin GET.
package memberscope

import "net/http"

type Scope struct {
	all    bool
	viewer string
	ids    []string
}

func All() Scope                                { return Scope{all: true} }
func Managed(viewer string, ids []string) Scope { return Scope{viewer: viewer, ids: ids} }

// IDs is consumed by PostgreSQL: NULL is explicitly unrestricted; an empty array matches nobody.
func (s Scope) IDs() []string {
	if s.all {
		return nil
	}
	if s.ids == nil {
		return []string{}
	}
	return s.ids
}
func (s Scope) Viewer() string { return s.viewer }

type Handler func(http.ResponseWriter, *http.Request, Scope)
type Get func(string, Handler)

// AdminOnly is for routers already restricted to global admins.
func AdminOnly(get func(string, http.HandlerFunc)) Get {
	return func(path string, h Handler) {
		get(path, func(w http.ResponseWriter, r *http.Request) { h(w, r, All()) })
	}
}
