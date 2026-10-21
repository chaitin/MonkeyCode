const legacySelectors = {
  postcssPlugin: "admin-chrome86-selectors",
  Once(root) {
    root.walkRules((rule) => {
      // Chrome 86 predates :where(). The following preset expands :is() into
      // ordinary selectors. Restrict this to generated selectors, not class names.
      rule.selector = rule.selector.replace(/:where\(/g, ":is(")
    })
  },
}

module.exports = {
  plugins: [
    require("tailwindcss"),
    legacySelectors,
    require("postcss-preset-env")({
      browsers: ["Chrome >= 86"],
      stage: false,
      features: {
        "nesting-rules": true,
        "is-pseudo-class": true,
        "has-pseudo-class": { preserve: true },
        "logical-properties-and-values": true,
        "media-query-ranges": true,
      },
    }),
    require("autoprefixer")({ overrideBrowserslist: ["Chrome >= 86"] }),
  ],
}
