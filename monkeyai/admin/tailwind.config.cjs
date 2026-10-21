const plugin = require("tailwindcss/plugin")

const semanticColors = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "secondary-hover",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "success",
  "warning",
  "border",
  "input",
  "ring",
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
  "sidebar",
  "sidebar-foreground",
  "sidebar-primary",
  "sidebar-primary-foreground",
  "sidebar-accent",
  "sidebar-accent-foreground",
  "sidebar-border",
  "sidebar-ring",
]
const font = [
  '"JetBrains Mono Variable"',
  '"Noto Sans SC Variable"',
  "sans-serif",
]

module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: ["variant", ".dark &"],
  theme: {
    extend: {
      colors: Object.fromEntries(
        semanticColors.map((name) => [
          name,
          `rgb(var(--${name}-rgb) / ${["input", "border", "sidebar-border"].includes(name) ? `calc(<alpha-value> * var(--${name}-alpha, 1))` : "<alpha-value>"})`,
        ])
      ),
      fontFamily: { sans: font, mono: font, heading: font },
      borderRadius: Object.fromEntries(
        ["sm", "md", "lg", "xl", "2xl", "3xl", "4xl"].map((name) => [
          name,
          `var(--radius-${name})`,
        ])
      ),
      boxShadow: {
        xs: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
        sm: "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)",
      },
      ringWidth: { DEFAULT: "1px", 3: "3px" },
      minWidth: { "4xl": "56rem" },
      aria: { invalid: 'invalid="true"' },
      ringColor: { DEFAULT: "currentColor" },
      spacing: {
        4.5: "1.125rem",
        5.5: "1.375rem",
        6.5: "1.625rem",
        7.5: "1.875rem",
        8.5: "2.125rem",
        9.5: "2.375rem",
        13: "3.25rem",
        15: "3.75rem",
        18: "4.5rem",
        22: "5.5rem",
        26: "6.5rem",
        30: "7.5rem",
        50: "12.5rem",
        90: "22.5rem",
      },
      opacity: { 6: "0.06", 15: "0.15", 35: "0.35" },
      blur: { xs: "4px" },
      backdropBlur: { xs: "4px" },
      transitionDuration: { 250: "250ms" },
      animation: {
        marquee: "marquee 30s linear infinite",
        "marquee-vertical": "marquee-vertical 30s linear infinite",
      },
      data: {
        open: "open",
        closed: "closed",
        checked: "checked",
        unchecked: "unchecked",
        disabled: "disabled",
        active: "active",
        selected: 'selected="true"',
        horizontal: 'orientation="horizontal"',
        vertical: 'orientation="vertical"',
        inset: "inset",
        placeholder: "placeholder",
        "popup-open": "popup-open",
        "starting-style": "starting-style",
        "ending-style": "ending-style",
      },
    },
  },
  plugins: [
    require("tailwindcss-animate"),
    plugin(({ addUtilities, addVariant }) => {
      // Preserve the v4 visual scale while using v3's transform/shadow machinery.
      addUtilities({
        ".outline-hidden": {
          outline: "2px solid transparent",
          "outline-offset": "2px",
        },
        ".no-scrollbar": {
          "-ms-overflow-style": "none",
          "scrollbar-width": "none",
          "&::-webkit-scrollbar": { display: "none" },
        },
        ".scrollbar-none": {
          "scrollbar-width": "none",
          "&::-webkit-scrollbar": { display: "none" },
        },
        ".field-sizing-content": { "field-sizing": "content" },
        ".text-balance": { "text-wrap": "balance" },
        ".text-pretty": { "text-wrap": "pretty" },
        ".underline-offset-3": { "text-underline-offset": "3px" },
      })
      for (const state of [
        "open",
        "closed",
        "checked",
        "unchecked",
        "disabled",
        "active",
      ]) {
        addVariant(
          `data-${state}`,
          `&[data-${state}]:not([data-${state}="false"])`
        )
      }
      addVariant(
        "supports-backdrop-filter",
        "@supports (backdrop-filter: blur(0))"
      )
    }),
  ],
}
