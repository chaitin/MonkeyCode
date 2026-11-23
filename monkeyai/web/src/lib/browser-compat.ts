import "core-js/actual/array/at"
import "core-js/actual/object/has-own"
import cssHasPseudo from "css-has-pseudo/browser"

import "./platform-compat"

cssHasPseudo(document, {
  observedAttributes: [
    "class",
    "disabled",
    "aria-expanded",
    "data-slot",
    "data-icon",
    "data-checked",
    "data-disabled",
    "data-size",
    "data-variant",
    "data-sidebar",
    "data-orientation",
  ],
})
