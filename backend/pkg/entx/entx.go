package entx

import (
	"entgo.io/ent/entc"
	"entgo.io/ent/entc/gen"
)

type Page struct {
	entc.DefaultExtension
}

func (*Page) Templates() []*gen.Template {
	return []*gen.Template{
		gen.MustParse(gen.NewTemplate("page").
			ParseFiles("../templates/page.tmpl")),
	}
}

type Cursor struct {
	entc.DefaultExtension
}

func (*Cursor) Templates() []*gen.Template {
	return []*gen.Template{
		gen.MustParse(gen.NewTemplate("cursor").
			Funcs(gen.Funcs).
			ParseFiles("../templates/cursor.tmpl")),
	}
}
