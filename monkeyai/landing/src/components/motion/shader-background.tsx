"use client";
// Water variant from https://beui.dev/components/motion/shader-background (MIT).
// Copyright (c) 2026 Saurabh Chauhan. See public/licenses/beui.txt.

import { Water, type WaterProps } from "@paper-design/shaders-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export type ShaderBackgroundProps = { variant: "water" } & WaterProps;

let webGLAvailable: boolean | undefined;
function supportsWebGL() {
  if (webGLAvailable === undefined) {
    try {
      const gl = document.createElement("canvas").getContext("webgl2");
      webGLAvailable = Boolean(gl);
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      webGLAvailable = false;
    }
  }
  return webGLAvailable;
}

export function ShaderBackground({ variant, className, ...rest }: ShaderBackgroundProps) {
  const [reduced, setReduced] = useState(true);
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    // Keep GPU animation in sync with OS preference changes without a reload.
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    setAvailable(supportsWebGL());
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return (
    <div aria-hidden="true" data-shader={variant} data-shader-supported={available}
      className={cn("h-full w-full", className)}>
      {/* Paper Shaders pauses its render loop offscreen and in hidden tabs. */}
      {available && <Water minPixelRatio={1} maxPixelCount={350_000} {...rest}
        speed={reduced ? 0 : (rest.speed ?? 0.2)} className="h-full w-full" />}
    </div>
  );
}
