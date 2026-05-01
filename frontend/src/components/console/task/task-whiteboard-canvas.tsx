import { getAssetUrls } from "@tldraw/assets/selfHosted"
import {
  ArrowDownToolbarItem,
  ArrowLeftToolbarItem,
  ArrowRightToolbarItem,
  ArrowToolbarItem,
  ArrowUpToolbarItem,
  AssetToolbarItem,
  CheckBoxToolbarItem,
  CloudToolbarItem,
  DefaultQuickActions,
  DefaultStylePanel,
  DefaultColorStyle,
  DefaultToolbar,
  DiamondToolbarItem,
  DrawToolbarItem,
  EllipseToolbarItem,
  EraserToolbarItem,
  FrameToolbarItem,
  HandToolbarItem,
  HeartToolbarItem,
  HexagonToolbarItem,
  HighlightToolbarItem,
  LaserToolbarItem,
  LineToolbarItem,
  NoteToolbarItem,
  OvalToolbarItem,
  RectangleToolbarItem,
  RhombusToolbarItem,
  SelectToolbarItem,
  StarToolbarItem,
  StylePanelArrowheadPicker,
  StylePanelArrowKindPicker,
  StylePanelButtonPicker,
  StylePanelDashPicker,
  StylePanelFillPicker,
  StylePanelGeoShapePicker,
  StylePanelLabelAlignPicker,
  StylePanelOpacityPicker,
  StylePanelSection,
  StylePanelSizePicker,
  StylePanelSplinePicker,
  StylePanelTextAlignPicker,
  TextToolbarItem,
  Tldraw,
  TldrawUiMenuActionItem,
  TldrawUiMenuToolItem,
  TriangleToolbarItem,
  TrapezoidToolbarItem,
  XBoxToolbarItem,
  type TLComponents,
  type TldrawProps,
  useCanRedo,
  useCanUndo,
  useStylePanelContext,
} from "tldraw"
import "tldraw/tldraw.css"

const whiteboardColorItems = [
  { value: "black", icon: "color" },
  { value: "grey", icon: "color" },
  { value: "white", icon: "color" },
  { value: "light-violet", icon: "color" },
  { value: "blue", icon: "color" },
  { value: "light-blue", icon: "color" },
  { value: "yellow", icon: "color" },
  { value: "orange", icon: "color" },
  { value: "green", icon: "color" },
  { value: "light-green", icon: "color" },
  { value: "light-red", icon: "color" },
  { value: "red", icon: "color" },
] as const

function WhiteboardColorPicker() {
  const { styles } = useStylePanelContext()
  const color = styles.get(DefaultColorStyle)
  if (color === undefined) return null

  return (
    <StylePanelButtonPicker
      title="颜色"
      uiType="color"
      style={DefaultColorStyle}
      items={whiteboardColorItems}
      value={color}
    />
  )
}

function WhiteboardToolbar() {
  return (
    <DefaultToolbar>
      <SelectToolbarItem />
      <HandToolbarItem />
      <TextToolbarItem />
      <LineToolbarItem />
      <RectangleToolbarItem />
      <ArrowToolbarItem />
      <AssetToolbarItem />
      <FrameToolbarItem />

      <EllipseToolbarItem />
      <TriangleToolbarItem />
      <DiamondToolbarItem />
      <TrapezoidToolbarItem />
      <TldrawUiMenuToolItem toolId="pentagon" />

      <HexagonToolbarItem />
      <OvalToolbarItem />
      <RhombusToolbarItem />
      <StarToolbarItem />

      <CloudToolbarItem />
      <HeartToolbarItem />
      <XBoxToolbarItem />
      <CheckBoxToolbarItem />

      <ArrowLeftToolbarItem />
      <ArrowUpToolbarItem />
      <ArrowDownToolbarItem />
      <ArrowRightToolbarItem />

      <HighlightToolbarItem />
      <LaserToolbarItem />
      <DrawToolbarItem />
      <EraserToolbarItem />
      <NoteToolbarItem />
    </DefaultToolbar>
  )
}

function WhiteboardQuickActions() {
  const canUndo = useCanUndo()
  const canRedo = useCanRedo()

  return (
    <DefaultQuickActions>
      <TldrawUiMenuActionItem actionId="undo" disabled={!canUndo} />
      <TldrawUiMenuActionItem actionId="redo" disabled={!canRedo} />
    </DefaultQuickActions>
  )
}

function WhiteboardStylePanel() {
  return (
    <DefaultStylePanel>
      <StylePanelSection>
        <WhiteboardColorPicker />
        <StylePanelOpacityPicker />
      </StylePanelSection>
      <StylePanelSection>
        <StylePanelFillPicker />
        <StylePanelDashPicker />
        <StylePanelSizePicker />
      </StylePanelSection>
      <StylePanelSection>
        <StylePanelTextAlignPicker />
        <StylePanelLabelAlignPicker />
      </StylePanelSection>
      <StylePanelSection>
        <StylePanelGeoShapePicker />
        <StylePanelArrowKindPicker />
        <StylePanelArrowheadPicker />
        <StylePanelSplinePicker />
      </StylePanelSection>
    </DefaultStylePanel>
  )
}

const whiteboardComponents: TLComponents = {
  MainMenu: null,
  PageMenu: null,
  QuickActions: WhiteboardQuickActions,
  StylePanel: WhiteboardStylePanel,
  Toolbar: WhiteboardToolbar,
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
