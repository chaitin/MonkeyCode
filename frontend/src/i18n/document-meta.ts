type Translate = (key: string) => string

const DEFAULT_META_KEY_PREFIX = "meta.default"
const PATCHED_META_NAMES = ["description", "keywords"] as const

export function patchDocumentMeta(
  translate: Translate,
  targetDocument = getDocument(),
) {
  if (!targetDocument) {
    return
  }

  targetDocument.title = translate(`${DEFAULT_META_KEY_PREFIX}.title`)

  for (const name of PATCHED_META_NAMES) {
    setNamedMetaContent(
      targetDocument,
      name,
      translate(`${DEFAULT_META_KEY_PREFIX}.${name}`),
    )
  }
}

function setNamedMetaContent(
  targetDocument: Document,
  name: string,
  content: string,
) {
  let element = targetDocument.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)

  if (!element) {
    element = targetDocument.createElement("meta")
    element.setAttribute("name", name)
    targetDocument.head.appendChild(element)
  }

  element.setAttribute("content", content)
}

function getDocument(): Document | undefined {
  if (typeof document === "undefined") {
    return undefined
  }

  return document
}
