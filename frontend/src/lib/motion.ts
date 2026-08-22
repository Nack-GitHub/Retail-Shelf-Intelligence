import type { Transition, Variants } from "motion/react";

/* One motion vocabulary for the whole app.
   Entering = ease-out (arrive and settle). Leaving = ease-in (depart).
   Nothing animates except transform and opacity. */

export const easeOut = [0.22, 1, 0.36, 1] as const;
export const easeIn = [0.55, 0, 1, 0.45] as const;
export const easeInOut = [0.65, 0, 0.35, 1] as const;

export const springSoft: Transition = { type: "spring", stiffness: 380, damping: 34, mass: 0.9 };
export const springSnappy: Transition = { type: "spring", stiffness: 520, damping: 32, mass: 0.7 };

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.36, ease: easeOut } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.18, ease: easeIn } },
};

export const fade: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.28, ease: easeOut } },
  exit: { opacity: 0, transition: { duration: 0.16, ease: easeIn } },
};

/** Lists: each row arrives just after the one above it. */
export const stagger = (gap = 0.045, delay = 0.04): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: gap, delayChildren: delay } },
});

export const listItem: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: easeOut } },
};

/** Bottom sheets: slide from the thumb, not from nowhere. */
export const sheet: Variants = {
  hidden: { y: "100%" },
  show: { y: 0, transition: springSoft },
  exit: { y: "100%", transition: { duration: 0.22, ease: easeIn } },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  show: { opacity: 1, scale: 1, transition: { duration: 0.3, ease: easeOut } },
  exit: { opacity: 0, scale: 0.98, transition: { duration: 0.16, ease: easeIn } },
};

/** Forward = content slides in from the right; back = from the left. */
export const pageSlide = (dir: 1 | -1): Variants => ({
  hidden: { opacity: 0, x: 28 * dir },
  show: { opacity: 1, x: 0, transition: { duration: 0.34, ease: easeOut } },
  exit: { opacity: 0, x: -22 * dir, transition: { duration: 0.18, ease: easeIn } },
});
