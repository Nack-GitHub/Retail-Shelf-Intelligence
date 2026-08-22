"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { pageSlide } from "@/lib/motion";

/* Step order drives the direction of the page transition: moving deeper in
   the flow slides in from the right, going back slides in from the left. */
const STEPS = [
  "/m/login",
  "/m",
  "/m/sync",
  "/checkin",
  "/category",
  "/capture",
  "/processing",
  "/result",
  "/verify",
  "/tasks",
  "/compare",
  "/checkout",
];

function stepIndex(path: string) {
  if (path === "/m") return 1;
  if (path === "/m/login") return 0;
  if (path === "/m/sync") return 2;
  const i = STEPS.findIndex((s) => s.startsWith("/") && !s.startsWith("/m") && path.endsWith(s));
  return i === -1 ? 1 : i;
}

function Clock() {
  const [now, setNow] = useState<string>("");
  useEffect(() => {
    const tick = () =>
      setNow(
        new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }),
      );
    tick();
    const id = window.setInterval(tick, 20_000);
    return () => window.clearInterval(id);
  }, []);
  return <span className="tnum">{now || "—:—"}</span>;
}

export function MobileShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const idx = stepIndex(pathname);

  // Adjusting state during render (React's documented pattern for deriving
  // from changing props) — the direction must be known on the very render
  // that mounts the new page, so an effect would always be one frame late.
  const [prevIdx, setPrevIdx] = useState(idx);
  const [dir, setDir] = useState<1 | -1>(1);
  if (prevIdx !== idx) {
    setDir(idx >= prevIdx ? 1 : -1);
    setPrevIdx(idx);
  }

  return (
    <div className="min-h-dvh bg-surface lg:grid lg:min-h-screen lg:place-items-center lg:bg-[#0d1117] lg:py-10">
      {/* desktop-only caption so the demo explains itself */}
      <div className="hidden lg:mb-6 lg:block lg:text-center">
        <p className="text-[13px] font-medium tracking-wide text-[#8b98a9]">
          ShelfEye · แอปพนักงานภาคสนาม (Mobile Web)
        </p>
        <Link
          href="/"
          className="mt-1 inline-block text-[13px] text-[#5b6a7d] underline-offset-4 hover:text-[#8b98a9] hover:underline"
        >
          กลับหน้าเลือกแพลตฟอร์ม
        </Link>
      </div>

      <div
        className={[
          "relative mx-auto flex w-full flex-col overflow-hidden bg-surface",
          // exactly one viewport tall so the page body never scrolls: the
          // content area scrolls inside, keeping header and thumb-zone
          // actions pinned the way a native app does
          "h-dvh",
          "lg:h-[844px] lg:min-h-0 lg:w-[390px] lg:rounded-[42px]",
          "lg:border-[10px] lg:border-[#1b222c] lg:shadow-[0_28px_70px_rgba(0,0,0,0.55)]",
        ].join(" ")}
      >
        {/* simulated status bar — desktop frame only */}
        <div className="hidden shrink-0 items-center justify-between px-7 pt-3 pb-1 text-[12px] font-semibold text-text lg:flex">
          <Clock />
          <div className="flex items-center gap-1.5" aria-hidden>
            <svg width="17" height="11" viewBox="0 0 17 11" fill="currentColor">
              <rect x="0" y="7" width="3" height="4" rx="1" />
              <rect x="4.5" y="5" width="3" height="6" rx="1" />
              <rect x="9" y="2.5" width="3" height="8.5" rx="1" />
              <rect x="13.5" y="0" width="3" height="11" rx="1" opacity="0.35" />
            </svg>
            <svg width="25" height="12" viewBox="0 0 25 12" fill="none">
              <rect x="0.5" y="0.5" width="21" height="11" rx="3.5" stroke="currentColor" opacity="0.4" />
              <rect x="2" y="2" width="14" height="8" rx="2" fill="currentColor" />
              <path d="M23 4v4a2 2 0 000-4z" fill="currentColor" opacity="0.4" />
            </svg>
          </div>
        </div>

        <motion.div
          key={pathname}
          variants={pageSlide(dir)}
          initial="hidden"
          animate="show"
          className="flex min-h-0 flex-1 flex-col"
        >
          {children}
        </motion.div>
      </div>
    </div>
  );
}
