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
