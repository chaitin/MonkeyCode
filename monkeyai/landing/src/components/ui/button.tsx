"use client";
// Adapted from https://beui.dev/components/motion/button (MIT).
// Copyright (c) 2026 Saurabh Chauhan. See public/licenses/beui.txt.

import { AnimatePresence, type HTMLMotionProps, motion, useReducedMotion } from "motion/react";
import { forwardRef, type PointerEvent, type ReactNode, useCallback, useRef, useState } from "react";
import { EASE_OUT, SPRING_PRESS } from "@/lib/ease";
import { useHoverCapable } from "@/lib/hooks/use-hover-capable";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "outline";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

export interface ButtonProps extends Omit<HTMLMotionProps<"button">, "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  pressScale?: number;
  ripple?: boolean;
  children?: ReactNode;
}

export interface ButtonLinkProps extends Omit<HTMLMotionProps<"a">, "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  pressScale?: number;
  children?: ReactNode;
}

type Ripple = { id: number; x: number; y: number; size: number };

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/90",
  secondary: "border border-border bg-card text-foreground hover:border-border",
  ghost: "text-muted-foreground hover:text-foreground hover:bg-primary/5",
  outline: "border border-border bg-transparent text-foreground hover:bg-primary/5",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs gap-1.5 rounded-full",
  md: "h-10 px-5 text-sm gap-2 rounded-full",
  lg: "h-12 px-6 text-base gap-2 rounded-full",
  icon: "h-8 w-8 rounded-lg",
};

export function buttonClasses(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string) {
  return cn(
    "inline-flex shrink-0 items-center justify-center font-medium select-none whitespace-nowrap transition-colors",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
    VARIANT_CLASS[variant],
    SIZE_CLASS[size],
    className,
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", pressScale = 0.93, ripple = false, className, children, onPointerDown, disabled, ...rest },
  ref,
) {
  const reduce = useReducedMotion();
  const canHover = useHoverCapable();
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const nextId = useRef(0);

  const handlePointerDown = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (ripple && !reduce) {
      const rect = event.currentTarget.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height) * 2;
      const id = nextId.current++;
      setRipples(prev => [...prev, { id, x: event.clientX - rect.left, y: event.clientY - rect.top, size }]);
    }
    onPointerDown?.(event);
  }, [ripple, reduce, onPointerDown, disabled]);

  return (
    <motion.button
      ref={ref}
      type="button"
      disabled={disabled}
      data-slot="button"
      data-variant={variant}
      data-size={size}
      whileTap={reduce || disabled ? undefined : { scale: pressScale }}
      whileHover={reduce || disabled || !canHover ? undefined : { scale: 1.02 }}
      transition={SPRING_PRESS}
      onPointerDown={handlePointerDown}
      className={buttonClasses(variant, size, cn(ripple && "relative overflow-hidden", className))}
      {...rest}
    >
      {ripple && !reduce ? (
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
          <AnimatePresence>
            {ripples.map(r => (
              <motion.span
                key={r.id}
                className="absolute rounded-full bg-current"
                style={{ left: r.x, top: r.y, width: r.size, height: r.size, x: "-50%", y: "-50%" }}
                initial={{ scale: 0.05, opacity: 0.3 }}
                animate={{ scale: 1, opacity: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1.6, ease: EASE_OUT }}
                onAnimationComplete={() => setRipples(prev => prev.filter(x => x.id !== r.id))}
              />
            ))}
          </AnimatePresence>
        </span>
      ) : null}
      {children}
    </motion.button>
  );
});

export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(function ButtonLink(
  { variant = "primary", size = "md", pressScale = 0.93, className, children, ...rest },
  ref,
) {
  const reduce = useReducedMotion();
  const canHover = useHoverCapable();

  return (
    <motion.a
      ref={ref}
      data-slot="button"
      data-variant={variant}
      data-size={size}
      whileTap={reduce ? undefined : { scale: pressScale }}
      whileHover={reduce || !canHover ? undefined : { scale: 1.02 }}
      transition={SPRING_PRESS}
      className={buttonClasses(variant, size, className)}
      {...rest}
    >
      {children}
    </motion.a>
  );
});
