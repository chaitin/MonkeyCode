import { getAssetUrls } from "@tldraw/assets/selfHosted"
import { Tldraw, type TLComponents, type TldrawProps } from "tldraw"
import "tldraw/tldraw.css"

const whiteboardComponents: TLComponents = {
  MainMenu: null,
  PageMenu: null,
}

const whiteboardOptions: TldrawProps["options"] = {
  maxPages: 1,
}

const TLDRAW_LICENSE_KEY = "tldraw-2026-08-08/WyJCYnVSQWlYTSIsWyIqIl0sMTYsIjIwMjYtMDgtMDgiXQ.JBexbWbLhgcyqZptkI3d/OgtUbOZS0fcOTFtQlotMojqut13MT/B0LuvXTe9nlTFBHCS1nH3xDiD+dS34QYbgQ"
const TLDRAW_ASSET_URLS = getAssetUrls({
  baseUrl: `${import.meta.env.BASE_URL.replace(/\/$/, "")}/tldraw`,
})

interface TaskWhiteboardCanvasProps {
  persistenceKey: string
  onMount?: TldrawProps["onMount"]
}

export default function TaskWhiteboardCanvas({ persistenceKey, onMount }: TaskWhiteboardCanvasProps) {
  return (
    <Tldraw
      assetUrls={TLDRAW_ASSET_URLS}
      components={whiteboardComponents}
      licenseKey={TLDRAW_LICENSE_KEY}
      onMount={onMount}
      options={whiteboardOptions}
      persistenceKey={persistenceKey}
    />
  )
}
