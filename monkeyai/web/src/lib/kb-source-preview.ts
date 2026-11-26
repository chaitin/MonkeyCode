// Build a separate inert preview; the editor always retains the original source.
export function knowledgeSourcePreview(source: string, type: string): string {
  const template = document.createElement("template")
  template.innerHTML = source
  const html = new Set("div span p h1 h2 h3 h4 h5 h6 ul ol li table thead tbody tfoot tr td th caption pre code blockquote br hr b strong i em u s small sub sup section article header footer main figure figcaption dl dt dd".split(" "))
  const svg = new Set("svg g path rect circle ellipse line polyline polygon text tspan title desc".split(" "))
  const attributes = new Set("viewBox width height x y x1 x2 y1 y2 cx cy r rx ry d points fill stroke stroke-width transform opacity fill-opacity stroke-opacity text-anchor font-size xmlns".toLowerCase().split(" "))
  function clean(parent: ParentNode) {
    for (const node of [...parent.childNodes]) {
      if (node.nodeType === Node.TEXT_NODE) continue
      if (!(node instanceof Element)) { node.remove(); continue }
      const name = node.localName.toLowerCase()
      if (!(html.has(name) || svg.has(name))) { node.remove(); continue }
      for (const attr of [...node.attributes]) {
        const value = attr.value
        if (!svg.has(name) || !attributes.has(attr.name.toLowerCase()) || /url\s*\(|[<>]|javascript:|data:|https?:/i.test(value) && attr.name !== "xmlns") node.removeAttribute(attr.name)
      }
      clean(node)
    }
  }
  clean(template.content)
  if (type === "svg" && !template.content.querySelector("svg")) throw new Error("sourcePreviewUnavailable")
  return '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;none&#39;; img-src &#39;none&#39;; font-src &#39;none&#39;; base-uri &#39;none&#39;; form-action &#39;none&#39;"></head><body>' + template.innerHTML + '</body></html>'
}
