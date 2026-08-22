"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { MobileHeader, BottomBar, Scroll } from "@/components/mobile/Chrome";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Badge";
import { CATEGORIES, getStore } from "@/lib/mock/data";
import { useDemo } from "@/lib/store";
import { listItem, stagger, springSnappy, easeOut } from "@/lib/motion";
import { cn } from "@/lib/cn";

export default function CategoryScreen() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const store = getStore(id);
  const selectShelf = useDemo((s) => s.selectShelf);

  const [catId, setCatId] = useState<string | null>("cat-coffee");
  const [bay, setBay] = useState<string | null>("A2");

  const cat = CATEGORIES.find((c) => c.id === catId) ?? null;
  const ready = !!cat && !!bay;

  function next() {
    if (!cat || !bay) return;
    selectShelf(cat.id, bay);
    router.push(`/m/store/${id}/capture`);
  }

  return (
    <>
      <MobileHeader title="เลือกชั้นวางที่จะตรวจ" subtitle={store.name} progress={0.24} />

      <Scroll className="px-4 pt-4 pb-6">
        <motion.ul variants={stagger(0.05)} initial="hidden" animate="show" className="flex flex-col gap-2.5">
          {CATEGORIES.map((c) => {
            const active = c.id === catId;
            return (
              <motion.li key={c.id} variants={listItem}>
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.985 }}
                  onClick={() => {
                    setCatId(c.id);
                    setBay(c.bays[0]);
                  }}
                  aria-pressed={active}
                  className={cn(
                    "w-full rounded-card border p-4 text-left transition-colors",
                    active
                      ? "border-primary bg-primary-soft"
                      : "border-line bg-bg shadow-[var(--shadow-card)] hover:border-line-strong",
                  )}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={cn(
                        "grid size-10 shrink-0 place-items-center rounded-chip",
                        active ? "bg-primary text-white" : "bg-surface-2 text-muted",
                      )}
                    >
                      <ShelfIcon />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[16px] font-semibold leading-snug">{c.name}</p>
                      <p className="mt-0.5 text-[13px] text-muted">
                        <span className="tnum">{c.skuCount}</span> SKU ·{" "}
                        <span className="tnum">{c.bays.length}</span> ชั้นวาง
                      </p>
                    </div>
                    {c.lastOsa !== null ? (
                      <Pill tone={c.lastOsa >= 90 ? "ok" : c.lastOsa >= 75 ? "warn" : "danger"}>
                        <span className="tnum">OSA {c.lastOsa}%</span>
                      </Pill>
                    ) : (
                      <Pill tone="neutral">ยังไม่เคยตรวจ</Pill>
                    )}
                  </div>

                  <AnimatePresence initial={false}>
                    {active && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.28, ease: easeOut }}
                        className="overflow-hidden"
                      >
                        <div className="mt-3.5 border-t border-primary/20 pt-3">
                          <p className="mb-2 text-[13px] font-medium text-primary-ink">
                            เลือกชั้นวาง (bay)
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {c.bays.map((b) => (
                              <span
                                key={b}
                                role="button"
                                tabIndex={0}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setBay(b);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setBay(b);
                                  }
                                }}
                                aria-pressed={bay === b}
                                className={cn(
                                  "relative grid h-11 min-w-11 cursor-pointer place-items-center rounded-chip px-4 text-[14px] font-semibold transition-colors",
                                  bay === b ? "text-white" : "bg-bg text-muted hover:text-text",
                                )}
                              >
                                {bay === b && (
                                  <motion.span
                                    layoutId={`bay-${c.id}`}
                                    className="absolute inset-0 rounded-chip bg-primary"
                                    transition={springSnappy}
                                  />
                                )}
                                <span className="relative">{b}</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.button>
              </motion.li>
            );
          })}
        </motion.ul>

        <p className="mt-4 px-1 text-[13px] leading-relaxed text-muted">
          ถ่ายทีละชั้นวางเพื่อให้ผลแม่นที่สุด หากชั้นวางกว้างเกิน 2 เมตร ให้แบ่งถ่ายเป็นสองภาพ
        </p>
      </Scroll>

      <BottomBar>
        <Button size="lg" full disabled={!ready} onClick={next}>
          {ready ? `เปิดกล้อง · ${cat!.name} ${bay}` : "เลือกหมวดและชั้นวาง"}
        </Button>
      </BottomBar>
    </>
  );
}

function ShelfIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M3 10h18M3 15h18" stroke="currentColor" strokeWidth="2" />
      <path d="M7.5 4v6M13 15v5" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
