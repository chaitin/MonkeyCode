"use client"
// beui.dev/components/motion/shader-background

import {
  ColorPanels,
  type ColorPanelsProps,
  Dithering,
  type DitheringProps,
  DotGrid,
  type DotGridProps,
  DotOrbit,
  type DotOrbitProps,
  GodRays,
  type GodRaysProps,
  GrainGradient,
  type GrainGradientProps,
  Metaballs,
  type MetaballsProps,
  MeshGradient,
  type MeshGradientProps,
  NeuroNoise,
  type NeuroNoiseProps,
  PerlinNoise,
  type PerlinNoiseProps,
  PulsingBorder,
  type PulsingBorderProps,
  SimplexNoise,
  type SimplexNoiseProps,
  SmokeRing,
  type SmokeRingProps,
  Spiral,
  type SpiralProps,
  StaticMeshGradient,
  type StaticMeshGradientProps,
  StaticRadialGradient,
  type StaticRadialGradientProps,
  Swirl,
  type SwirlProps,
  Voronoi,
  type VoronoiProps,
  Warp,
  type WarpProps,
  Water,
  type WaterProps,
  Waves,
  type WavesProps,
} from "@paper-design/shaders-react"
import { useReducedMotion } from "motion/react"
import type { ComponentType } from "react"
import { cn } from "@/lib/utils"

type ShaderVariantProps = {
  "mesh-gradient": MeshGradientProps
  "grain-gradient": GrainGradientProps
  "dot-grid": DotGridProps
  "dot-orbit": DotOrbitProps
  warp: WarpProps
  waves: WavesProps
  water: WaterProps
  voronoi: VoronoiProps
  swirl: SwirlProps
  "smoke-ring": SmokeRingProps
  "static-radial-gradient": StaticRadialGradientProps
  "neuro-noise": NeuroNoiseProps
  metaballs: MetaballsProps
  "god-rays": GodRaysProps
  spiral: SpiralProps
  dithering: DitheringProps
  "pulsing-border": PulsingBorderProps
  "color-panels": ColorPanelsProps
  "static-mesh-gradient": StaticMeshGradientProps
  "simplex-noise": SimplexNoiseProps
  "perlin-noise": PerlinNoiseProps
}

export type ShaderBackgroundVariant = keyof ShaderVariantProps

export type ShaderBackgroundProps = {
  [K in ShaderBackgroundVariant]: { variant: K } & ShaderVariantProps[K]
}[ShaderBackgroundVariant]

const VARIANT_COMPONENTS: {
  [K in ShaderBackgroundVariant]: ComponentType<ShaderVariantProps[K]>
} = {
  "mesh-gradient": MeshGradient,
  "grain-gradient": GrainGradient,
  "dot-grid": DotGrid,
  "dot-orbit": DotOrbit,
  warp: Warp,
  waves: Waves,
  water: Water,
  voronoi: Voronoi,
  swirl: Swirl,
  "smoke-ring": SmokeRing,
  "static-radial-gradient": StaticRadialGradient,
  "neuro-noise": NeuroNoise,
  metaballs: Metaballs,
  "god-rays": GodRays,
  spiral: Spiral,
  dithering: Dithering,
  "pulsing-border": PulsingBorder,
  "color-panels": ColorPanels,
  "static-mesh-gradient": StaticMeshGradient,
  "simplex-noise": SimplexNoise,
  "perlin-noise": PerlinNoise,
}

/**
 * Not every variant animates (e.g. dot-grid is a static pattern), so `speed`
 * is only frozen for reduced motion when the variant actually exposes it.
 */
export function ShaderBackground({
  variant,
  className,
  ...rest
}: ShaderBackgroundProps) {
  const reducedMotion = useReducedMotion()
  const Shader = VARIANT_COMPONENTS[variant] as ComponentType<
    Record<string, unknown>
  >
  const props = rest as Record<string, unknown>
  const speedProps = reducedMotion && "speed" in props ? { speed: 0 } : {}

  return (
    <Shader
      {...props}
      {...speedProps}
      className={cn("h-full w-full", className)}
    />
  )
}
