"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { MobileHeader, BottomBar, Scroll } from "@/components/mobile/Chrome";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Badge";
import { ErrorBlock, LoadingBlock } from "@/components/ui/AsyncState";
import { FlowGuardBlock } from "@/components/mobile/FlowGuardBlock";
import { fetchStore } from "@/lib/api/routes";
import { fetchCategories } from "@/lib/api/catalog";
import { useResource } from "@/lib/api/useResource";
import { useFlow } from "@/lib/flow/useFlow";
import { useDemo } from "@/lib/store";
import { listItem, stagger, springSnappy, easeOut } from "@/lib/motion";
import { cn } from "@/lib/cn";
import { osaTone } from "@/lib/osa";
import type { ShelfCategory, Store } from "@/types";

export default function CategoryScreen() {
  const { id } = useParams<{ id: string }>();
  const flow = useFlow("CATEGORY");
  const selectShelf = useDemo((s) => s.selectShelf);

  const storeResource = useResource<Store>(() => fetchStore(id), [id]);
  const catalog = useResource<ShelfCategory[]>(() => fetchCategories(id), [id]);
  const categories = useMemo(() => catalog.data ?? [], [catalog.data]);

  const [catId, setCatId] = useState<string | null>(null);
  const [bay, setBay] = useState<string | null>(null);

  // Preselect the first shelf once the catalogue arrives, so the rep taps
  // "open camera" rather than choosing before there is anything to choose.
  // The first SUPPORTED one: preselecting a shelf the model cannot read would
  // put the rep one tap from a disabled button with no explanation.
  useEffect(() => {
    if (catId || categories.length === 0) return;
    const first = categories.find((c) => c.supported);
    if (!first) return;
    setCatId(first.id);
    setBay(first.bays[0] ?? null);
  }, [categories, catId]);

  const cat = categories.find((c) => c.id === catId) ?? null;
  const ready = !!cat && !!bay;

  function next() {
    if (!cat || !bay) return;
    selectShelf(cat.id, bay);
    flow.go("CAPTURE");
  }

  if (flow.blocked) return <FlowGuardBlock flow={flow} />;

  if (catalog.state !== "READY") {
    return (
      <>
        <MobileHeader title="เลือกชั้นวางที่จะตรวจ" progress={0.24} onBack={flow.back} />
        {catalog.state === "ERROR" ? (
          <Scroll className="px-4 pt-4">
            <ErrorBlock message={catalog.error ?? ""} onRetry={catalog.reload} />
          </Scroll>
        ) : (
          <LoadingBlock label="กำลังโหลดหมวดสินค้า…" />
        )}
      </>
    );
  }

  return (
    <>
      <MobileHeader
        title="เลือกชั้นวางที่จะตรวจ"
        subtitle={storeResource.data?.name}
        progress={0.24}
        onBack={flow.back}
      />

      <Scroll className="px-4 pt-4 pb-6">
        <motion.ul variants={stagger(0.05)} initial="hidden" animate="show" className="flex flex-col gap-2.5">
          {categories.map((c) => {
            const active = c.id === catId;
            return (
              <motion.li key={c.id} variants={listItem}>
                <motion.button
                  type="button"
                  whileTap={c.supported ? { scale: 0.985 } : undefined}
                  disabled={!c.supported}
                  onClick={() => {
                    setCatId(c.id);
                    setBay(c.bays[0]);
                  }}
                  aria-pressed={active}
                  aria-describedby={c.supported ? undefined : `unsupported-${c.id}`}
                  className={cn(
                    "w-full rounded-card border p-4 text-left transition-colors",
                    !c.supported
                      ? "cursor-not-allowed border-line bg-surface-2 opacity-60"
                      : active
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
                    {!c.supported ? (
                      <Pill tone="neutral">รุ่นนี้ยังอ่านไม่ได้</Pill>
                    ) : c.lastOsa !== null ? (
                      <Pill tone={osaTone(c.lastOsa)}>
                        <span className="tnum">OSA {c.lastOsa}%</span>
                      </Pill>
                    ) : (
                      <Pill tone="neutral">ยังไม่เคยตรวจ</Pill>
                    )}
                  </div>

                  {!c.supported && (
                    <p
                      id={`unsupported-${c.id}`}
                      className="mt-2.5 text-[13px] leading-relaxed text-muted"
                    >
                      โมเดลที่ใช้อยู่เรียนรู้จากชั้นกาแฟเท่านั้น ถ่ายชั้นนี้แล้วผลจะออกมาเป็นสินค้ากาแฟ
                    </p>
                  )}

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
