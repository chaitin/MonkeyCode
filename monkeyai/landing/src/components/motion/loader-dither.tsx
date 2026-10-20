"use client";
// Dither variant from https://beui.dev/components/motion/loader (MIT).
// Copyright (c) 2026 Saurabh Chauhan. See public/licenses/beui.txt.

import { motion, useReducedMotion } from "motion/react";
import { EASE_IN_OUT } from "@/lib/ease";

// Ordered Bayer 4x4 thresholds make the cells shimmer like a dissolving halftone.
const BAYER_4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export function DitherLoader({ size = 24, speed = 1 }: { size?: number; speed?: number }) {
  const reduce = useReducedMotion();
  const gap = Math.max(1, size * 0.05);
  const cell = (size - gap * 3) / 4;

  return (
    <span aria-hidden="true" data-loader="dither" className="grid"
      style={{ width: size, height: size, gap, gridTemplateColumns: `repeat(4, ${cell}px)` }}>
      {BAYER_4.map((order, index) => (
        <motion.span key={index} className="bg-current" style={{ width: cell, height: cell }}
          initial={{ opacity: 0.3 }}
          animate={{ opacity: reduce ? [0.3, 1, 0.3] : [0.1, 1, 0.1] }}
          transition={{ duration: speed, ease: EASE_IN_OUT, repeat: Infinity, delay: (order / BAYER_4.length) * speed }}
        />
      ))}
    </span>
  );
}
