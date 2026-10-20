"use client";
// beUI (MIT); see public/licenses/beui.txt.

import { useEffect, useState } from "react";

// Touch devices can retain a synthetic hover after tapping.
export function useHoverCapable() {
  const [canHover, setCanHover] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const update = () => setCanHover(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return canHover;
}
