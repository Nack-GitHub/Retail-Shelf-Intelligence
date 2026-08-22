"use client";

import { useState } from "react";
import { motion, Reorder, AnimatePresence } from "motion/react";
import { PageHeader } from "@/components/web/WebShell";
import { Button } from "@/components/ui/Button";
import { RiskBadge, Pill } from "@/components/ui/Badge";
import { Bar } from "@/components/ui/Progress";
import { Segmented } from "@/components/ui/Controls";
import { NEXT_WEEK_PLAN, type PlannedStop } from "@/lib/mock/analytics";
import { fadeUp, easeOut, springSoft } from "@/lib/motion";
import { cn } from "@/lib/cn";

export default function RoutePlanning() {
  const [stops, setStops] = useState<PlannedStop[]>(NEXT_WEEK_PLAN);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [sort, setSort] = useState<"RISK" | "DISTANCE">("RISK");
  const [approved, setApproved] = useState(false);

  const active = stops.filter((s) => !excluded.includes(s.storeId));
  const totalKm = active.reduce((a, s) => a + s.distanceKm, 0);
  const totalMin = active.reduce((a, s) => a + s.estMinutes, 0);
  const highRisk = active.filter((s) => s.risk === "HIGH").length;
  const coverage = Math.round(
    (active.filter((s) => s.risk === "HIGH").length /
      Math.max(1, stops.filter((s) => s.risk === "HIGH").length)) *
      100,
  );

  function applySort(next: "RISK" | "DISTANCE") {
    setSort(next);
    setStops((prev) =>
      [...prev].sort((a, b) =>
        next === "RISK" ? b.riskScore - a.riskScore : a.distanceKm - b.distanceKm,
      ),
    );
  }

  function toggle(id: string) {
    setExcluded((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    setApproved(false);
  }

  return (
    <>
      <PageHeader
        title="วางแผนเส้นทางสัปดาห์หน้า"
        subtitle="25–29 สิงหาคม 2569 · จัดลำดับตามความเสี่ยงระดับร้าน"
        actions={
          <Segmented
            ariaLabel="เกณฑ์การจัดลำดับ"
            value={sort}
            onChange={applySort}
            options={[
              { value: "RISK", label: "ตามความเสี่ยง" },
              { value: "DISTANCE", label: "ตามระยะทาง" },
            ]}
          />
        }
      />

      <div className="grid gap-5 px-6 py-6 lg:px-8 xl:grid-cols-[1fr_320px]">
        {/* ---- reorderable plan ---- */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold">
              ลำดับการเข้าร้าน <span className="tnum text-muted">({active.length} ร้าน)</span>
            </h2>
            <p className="text-[13px] text-muted">ลากเพื่อจัดลำดับใหม่</p>
          </div>

          <Reorder.Group axis="y" values={stops} onReorder={setStops} className="flex flex-col gap-2.5">
            {stops.map((s, i) => {
              const off = excluded.includes(s.storeId);
              return (
                <Reorder.Item
                  key={s.storeId}
                  value={s}
                  whileDrag={{ scale: 1.015, boxShadow: "0 12px 28px rgba(16,24,40,0.16)" }}
                  transition={springSoft}
                  className={cn(
                    "cursor-grab rounded-card border bg-bg shadow-[var(--shadow-card)] active:cursor-grabbing",
                    off ? "border-line opacity-55" : "border-line",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2 p-4">
                    <span className="grid size-6 shrink-0 place-items-center text-faint" aria-hidden>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                        <path d="M8 6h.01M8 12h.01M8 18h.01M16 6h.01M16 12h.01M16 18h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                      </svg>
                    </span>
                    <span
                      className={cn(
                        "tnum grid size-8 shrink-0 place-items-center rounded-full text-[13px] font-semibold",
                        off ? "bg-surface-2 text-faint" : i === 0 ? "bg-primary text-white" : "bg-surface-2 text-muted",
                      )}
                    >
                      {off ? "—" : active.findIndex((a) => a.storeId === s.storeId) + 1}
                    </span>

                    <div className="min-w-[150px] flex-1">
                      <p className="text-[15px] font-semibold leading-snug">{s.name}</p>
                      <p className="text-[13px] text-muted">{s.chain}</p>
                    </div>

                    <div className="w-[104px]">
                      <p className="text-[12px] text-muted">OSA ล่าสุด</p>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="tnum text-[14px] font-semibold">{s.osa}%</span>
                        <Bar value={s.osa} tone={s.osa >= 90 ? "ok" : s.osa >= 75 ? "warn" : "danger"} className="flex-1" height={5} />
                      </div>
                    </div>

                    <div className="w-[76px]">
                      <p className="text-[12px] text-muted">ไม่ได้เข้า</p>
                      <p className="tnum text-[14px] font-semibold">{s.daysSince} วัน</p>
                    </div>

                    <div className="w-[96px]">
                      <p className="text-[12px] text-muted">ระยะ / เวลา</p>
                      <p className="tnum text-[14px] font-semibold">
                        {s.distanceKm} กม. · {s.estMinutes}′
                      </p>
                    </div>

                    <RiskBadge band={s.risk} />

                    <button
                      type="button"
                      onClick={() => toggle(s.storeId)}
                      className="ml-auto h-9 shrink-0 rounded-btn px-2.5 text-[13px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-text"
                    >
                      {off ? "ใส่กลับ" : "ตัดออก"}
                    </button>
                  </div>
                </Reorder.Item>
              );
            })}
          </Reorder.Group>
        </section>

        {/* ---- summary ---- */}
        <motion.aside variants={fadeUp} initial="hidden" animate="show" transition={{ delay: 0.15 }}>
          <div className="sticky top-6 rounded-card border border-line bg-bg p-5 shadow-[var(--shadow-card)]">
            <h2 className="text-[15px] font-semibold">สรุปเส้นทาง</h2>

            <dl className="mt-4 space-y-3">
              <Metric label="จำนวนร้าน" value={`${active.length}`} unit="ร้าน" />
              <Metric label="ระยะทางรวม" value={totalKm.toFixed(1)} unit="กม." />
              <Metric label="เวลาในร้านรวม" value={`${Math.floor(totalMin / 60)} ชม. ${totalMin % 60}`} unit="นาที" />
              <Metric label="ร้านเสี่ยงสูงในแผน" value={`${highRisk}`} unit="ร้าน" tone="danger" />
            </dl>

            <div className="mt-4 border-t border-line pt-4">
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-muted">ครอบคลุมร้านเสี่ยงสูง</span>
                <span className="tnum font-semibold">{coverage}%</span>
              </div>
              <Bar value={coverage} tone={coverage === 100 ? "ok" : "warn"} className="mt-2 w-full" height={7} />
              {coverage < 100 && (
                <p className="mt-2 text-[13px] leading-relaxed text-[#b45f04]">
                  ยังมีร้านเสี่ยงสูงที่ถูกตัดออกจากแผน ควรทบทวนก่อนอนุมัติ
                </p>
              )}
            </div>

            <div className="mt-5">
              <AnimatePresence mode="wait">
                {approved ? (
                  <motion.div
                    key="ok"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.28, ease: easeOut }}
                    className="flex h-12 items-center justify-center gap-2 rounded-btn bg-ok-soft text-[14px] font-semibold text-[#07794a]"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="M5 12.5l5 5L19 7" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    อนุมัติเส้นทางแล้ว
                  </motion.div>
                ) : (
                  <motion.div key="cta" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                    <Button full onClick={() => setApproved(true)}>
                      อนุมัติเส้นทางนี้
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>
              <p className="mt-3 text-[12px] leading-relaxed text-faint">
                การอนุมัติจะส่งแผนไปที่แอปของพนักงานในพื้นที่
                ระบบไม่ติดต่อร้านค้าและไม่กำหนดโควตาต่อคน
              </p>
            </div>

            <div className="mt-4 border-t border-line pt-4">
              <Pill tone="neutral" className="text-[12px]">
                จัดลำดับจากความเสี่ยงระดับร้านเท่านั้น
              </Pill>
            </div>
          </div>
        </motion.aside>
      </div>
    </>
  );
}

function Metric({
  label,
  value,
  unit,
  tone,
}: {
  label: string;
  value: string;
  unit: string;
  tone?: "danger";
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="flex items-baseline gap-1">
        <span className={cn("tnum text-[18px] font-bold", tone === "danger" && "text-danger")}>{value}</span>
        <span className="text-[12px] text-muted">{unit}</span>
      </dd>
    </div>
  );
}
