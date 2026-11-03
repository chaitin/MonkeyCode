package i18n

import (
	"context"
	"net/http"

	"golang.org/x/text/language"
)

type localeKey struct{}

var matcher = language.NewMatcher([]language.Tag{language.SimplifiedChinese, language.AmericanEnglish})

func Locale(ctx context.Context) string {
	if ctx != nil {
		if locale, ok := ctx.Value(localeKey{}).(string); ok {
			return locale
		}
	}
	return "zh-CN"
}

func Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, index := language.MatchStrings(matcher, r.Header.Get("Accept-Language"))
		locale := []string{"zh-CN", "en-US"}[index]
		w.Header().Set("Content-Language", locale)
		w.Header().Add("Vary", "Accept-Language")
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), localeKey{}, locale)))
	})
}

func Text(ctx context.Context, code, fallback string) string {
	return localized(Locale(ctx), code, fallback, 0)
}
