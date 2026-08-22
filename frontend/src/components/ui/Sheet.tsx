"use client";

import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { sheet, fade } from "@/lib/motion";
import { cn } from "@/lib/cn";

/** Bottom sheet with focus capture, Escape-to-close and a drag-down dismiss. */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement;
    const t = window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLElement>(
        "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
      )?.focus();
    }, 60);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key !== "Tab" || !panelRef.current) return;
      const nodes = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          "button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
        ),
      );
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      restoreRef.current?.focus?.();
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div className="absolute inset-0 z-50 flex flex-col justify-end">
          <motion.button
            type="button"
            aria-label="ปิด"
            variants={fade}
            initial="hidden"
            animate="show"
            exit="exit"
            onClick={onClose}
            className="absolute inset-0 bg-[#101828]/45 cursor-default"
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            variants={sheet}
            initial="hidden"
            animate="show"
            exit="exit"
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.5 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 90 || info.velocity.y > 700) onClose();
            }}
            className={cn(
              "relative bg-bg rounded-t-[20px] shadow-[var(--shadow-sheet)] pb-[max(20px,env(safe-area-inset-bottom))]",
              className,
            )}
          >
            <div className="flex justify-center pt-2.5 pb-1 cursor-grab active:cursor-grabbing">
              <span className="h-1 w-9 rounded-full bg-line-strong" aria-hidden />
            </div>
            <div className="px-5 pt-2 pb-3">
              <h2 className="text-[17px] font-semibold">{title}</h2>
              {description && (
                <p className="mt-1 text-[14px] text-muted leading-relaxed">{description}</p>
              )}
            </div>
            <div className="px-5">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
