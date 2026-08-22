"use client";

import { motion, type HTMLMotionProps } from "motion/react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "onDark" | "outlineDark";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-primary text-white hover:bg-primary-ink disabled:bg-line-strong disabled:text-faint",
  secondary:
    "bg-bg text-text border border-line-strong hover:bg-surface disabled:text-faint",
  ghost: "bg-transparent text-muted hover:bg-surface-2 hover:text-text",
  danger: "bg-danger text-white hover:brightness-95",
  onDark: "bg-ink-text text-ink hover:bg-white",
  outlineDark:
    "bg-ink-3/70 text-ink-text border border-ink-line hover:bg-ink-3",
};

const SIZES: Record<Size, string> = {
  sm: "h-9 px-3 text-[14px] rounded-inset gap-1.5",
  md: "h-12 px-4 text-[15px] rounded-btn gap-2",
  lg: "h-14 px-5 text-[16px] rounded-btn gap-2",
};

export interface ButtonProps extends Omit<HTMLMotionProps<"button">, "children"> {
  variant?: Variant;
  size?: Size;
  full?: boolean;
  children: React.ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  full,
  className,
  disabled,
  children,
  ...rest
}: ButtonProps) {
  return (
    <motion.button
      whileTap={disabled ? undefined : { scale: 0.975 }}
      transition={{ duration: 0.09 }}
      disabled={disabled}
      className={cn(
        "inline-flex items-center justify-center font-medium select-none",
        "transition-colors duration-150",
        "disabled:cursor-not-allowed",
        VARIANTS[variant],
        SIZES[size],
        full && "w-full",
        className,
      )}
      {...rest}
    >
      {children}
    </motion.button>
  );
}
