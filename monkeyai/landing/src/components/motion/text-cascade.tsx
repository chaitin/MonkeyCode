"use client";
// Adapted from https://beui.dev/components/motion/text-animation (MIT).
// Copyright (c) 2026 Saurabh Chauhan. See public/licenses/beui.txt.

import { useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";
import { ActionSwapCascadeText } from "./action-swap-cascade";

export interface TextCascadeProps {
  text: string;
  className?: string;
}

export function TextCascade({ text, className }: TextCascadeProps) {
  const [replay, setReplay] = useState(0);
  const reduced = useReducedMotion();

  // Keep SSR visible; start replays only after hydration and clean up on unmount.
  useEffect(() => {
    if (reduced) return;
    setReplay(value => value + 1);
    const timer = window.setInterval(() => setReplay(value => value + 1), 5000);
    return () => window.clearInterval(timer);
  }, [reduced]);

  return (
    <ActionSwapCascadeText value={`${text}-${replay}`} className={className}>
      {text}
    </ActionSwapCascadeText>
  );
}
