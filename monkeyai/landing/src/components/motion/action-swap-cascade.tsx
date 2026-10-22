"use client";
// Adapted from https://beui.dev/components/motion/action-swap (MIT).
// Copyright (c) 2026 Saurabh Chauhan. See public/licenses/beui.txt.

import { AnimatePresence, motion, useReducedMotion, type Variants } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { EASE_OUT, SPRING_SWAP } from "@/lib/ease";
import { cn } from "@/lib/utils";

// The first client render must match SSR before switching to reduced-motion markup.
function useCascadeReducedMotion() {
  const reduced = useReducedMotion();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated && reduced;
}

const CASCADE_STAGGER = 0.025;
const ROLL_BLUR = "blur(3px)";
const LETTER_VARIANTS: Variants = {
  initial: { opacity: 0, y: "105%", filter: ROLL_BLUR },
  animate: (delay: number = 0) => ({
    opacity: 1, y: "0%", filter: "blur(0px)",
    transition: { ...SPRING_SWAP, delay },
  }),
  exit: (delay: number = 0) => ({
    opacity: 0, y: "-105%", filter: ROLL_BLUR,
    transition: { duration: 0.16, ease: EASE_OUT, delay: delay * 0.5 },
  }),
};
const ICON_VARIANTS: Variants = {
  initial: { opacity: 0, y: 12, filter: ROLL_BLUR },
  animate: { opacity: 1, y: 0, filter: "blur(0px)", transition: SPRING_SWAP },
  exit: { opacity: 0, y: -12, filter: ROLL_BLUR, transition: { duration: 0.14, ease: EASE_OUT } },
};

export function ActionSwapCascadeText({ value, children, className }: {
  value: string;
  children: string;
  className?: string;
}) {
  const reduce = useCascadeReducedMotion();
  const letters = Array.from(children);

  return (
    <span className={cn("relative -my-[0.08em] inline-block max-w-full whitespace-nowrap py-[0.08em] align-bottom", className)}
      style={{ clipPath: "inset(0 -999px)", WebkitClipPath: "inset(0 -999px)" }}>
      <span className="sr-only" aria-live="polite" aria-atomic="true">{children}</span>
      {reduce ? <span aria-hidden="true">{children}</span> : <>
        {/* Separate layers preserve proportional glyph widths as the labels overlap. */}
        <span aria-hidden="true" className="invisible inline-block whitespace-nowrap">
          {letters.map((char, index) => <span key={index} className="inline-block whitespace-pre">{char}</span>)}
        </span>
        <AnimatePresence initial={false}>
          <motion.span key={`cascade-${value}`} aria-hidden="true"
            initial="initial" animate="animate" exit="exit"
            className="absolute left-0 top-[0.08em] inline-block whitespace-pre">
            {letters.map((char, index) => (
              <motion.span key={index} custom={index * CASCADE_STAGGER} variants={LETTER_VARIANTS}
                className="inline-block whitespace-pre will-change-[opacity,filter,transform]">
                {char}
              </motion.span>
            ))}
          </motion.span>
        </AnimatePresence>
      </>}
    </span>
  );
}

export function ActionSwapCascadeIcon({ value, children, className }: {
  value: string;
  children: ReactNode;
  className?: string;
}) {
  const reduce = useCascadeReducedMotion();

  return (
    <span aria-hidden="true" className={cn("relative inline-grid shrink-0 place-items-center overflow-hidden", className)}>
      {reduce ? children : (
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={`cascade-${value}`} variants={ICON_VARIANTS}
            initial="initial" animate="animate" exit="exit"
            className="col-start-1 row-start-1 inline-flex items-center justify-center will-change-[opacity,filter,transform]">
            {children}
          </motion.span>
        </AnimatePresence>
      )}
    </span>
  );
}
