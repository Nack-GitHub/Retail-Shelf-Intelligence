"use client";

import { useState } from "react";
import { motion, Reorder, AnimatePresence } from "motion/react";
import { PageHeader } from "@/components/web/WebShell";
import { Button } from "@/components/ui/Button";
import { RiskBadge, Pill } from "@/components/ui/Badge";
import { Bar } from "@/components/ui/Progress";
import { Segmented } from "@/components/ui/Controls";
import { fetchRoutePlan, type PlannedStop } from "@/lib/api/analytics";
import { useResource } from "@/lib/api/useResource";
import { useArea } from "@/components/web/WebShell";
import { ErrorBlock, LoadingBlock } from "@/components/ui/AsyncState";
import { fadeUp, easeOut, springSoft } from "@/lib/motion";
import { cn } from "@/lib/cn";
import { osaTone } from "@/lib/osa";
import { OsaSource } from "@/components/ui/OsaSource";

/* Sorting by distance is deliberately not offered: a weekly plan has no
   "current position" to measure from, and the only honest second axis is how
   long a store has gone unvisited. */
type Sort = "RISK" | "STALENESS";

/** One ordering rule, used both when the data arrives and when the reader
 *  switches the control. Two copies meant a reload re-sorted by risk while the
 *  control still read "ตามวันที่ไม่ได้เข้า". */
function sortStops(stops: PlannedStop[], by: Sort): PlannedStop[] {
  return [...stops].sort((a, b) =>
    by === "RISK"
      ? b.riskScore - a.riskScore
      : (b.daysSinceLastVisit ?? Infinity) - (a.daysSinceLastVisit ?? Infinity),
  );
}

export default function RoutePlanning() {
  const { areaId, areaName, ready } = useArea();
  const plan = useResource(async () => (ready ? fetchRoutePlan(areaId) : null), [areaId, ready]);

  const [stops, setStops] = useState<PlannedStop[]>([]);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [sort, setSort] = useState<Sort>("RISK");
  const [approved, setApproved] = useState(false);

  /* The list is reorderable, so it becomes local state once it arrives — in
     whichever order the control is currently showing. Deriving it from one
     place is what keeps the two in step: a reload used to re-sort by risk
     while the control still read "ตามวันที่ไม่ได้เข้า".

     A manual reorder is discarded when the data reloads or the criterion
     changes, which is the same thing the notice under the button already says
     happens on refresh. Done during render rather than in an effect so the
     list never paints in the previous order first. */
  const [sortedFrom, setSortedFrom] = useState<{ data: PlannedStop[]; sort: Sort } | null>(null);
  if (plan.data && (plan.data !== sortedFrom?.data || sort !== sortedFrom.sort)) {
    setSortedFrom({ data: plan.data, sort });
    setStops(sortStops(plan.data, sort));
  }

  const active = stops.filter((s) => !excluded.includes(s.storeId));
  // Only stores with a measured average contribute; a null is skipped rather
  // than counted as zero, and the label says how many are still unmeasured.
  const measured = active.filter((s) => s.avgVisitMinutes !== null);
  const totalMin = measured.reduce((a, s) => a + (s.avgVisitMinutes ?? 0), 0);
  const highRisk = active.filter((s) => s.riskBand === "HIGH").length;
  const highRiskTotal = stops.filter((s) => s.riskBand === "HIGH").length;
  // No high-risk stores means nothing can be missed. Dividing by a clamped 1
  // reported 0% coverage and warned about excluded stores that did not exist.
  const coverage = highRiskTotal === 0 ? 100 : Math.round((highRisk / highRiskTotal) * 100);

  function toggle(id: string) {
    setExcluded((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    setApproved(false);
  }

  return (
    <>
      <PageHeader
        title="วางแผนเส้นทางสัปดาห์หน้า"
        subtitle={`${areaName} · จัดลำดับตามความเสี่ยงระดับร้าน`}
        actions={
          <Segmented
            ariaLabel="เกณฑ์การจัดลำดับ"
            value={sort}
            onChange={setSort}
            options={[
              { value: "RISK", label: "ตามความเสี่ยง" },
              { value: "STALENESS", label: "ตามวันที่ไม่ได้เข้า" },
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

          {plan.state === "LOADING" || !ready ? (
            <LoadingBlock label="กำลังจัดลำดับร้าน…" />
          ) : plan.state === "ERROR" ? (
            <ErrorBlock message={plan.error ?? ""} onRetry={plan.reload} />
          ) : stops.length === 0 ? (
            <p className="rounded-card border border-line bg-bg px-6 py-14 text-center text-[14px] text-muted">
              ยังไม่มีร้านในพื้นที่นี้ให้วางแผน
            </p>
          ) : (
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
                      <p className="text-[15px] font-semibold leading-snug">{s.storeName}</p>
                      <p className="text-[13px] text-muted">{s.chain}</p>
                    </div>

                    <div className="w-[104px]">
                      <p className="text-[12px] text-muted">OSA ล่าสุด</p>
                      {s.lastOsa === null ? (
                        <p className="mt-1 text-[13px] text-muted">ยังไม่เคยตรวจ</p>
                      ) : (
                        <>
                          <div className="mt-1 flex items-center gap-2">
                            <span className="tnum text-[14px] font-semibold">{s.lastOsa}%</span>
                            <Bar
                              value={s.lastOsa}
                              tone={osaTone(s.lastOsa)}
                              className="flex-1"
                              height={5}
                            />
                          </div>
                          <OsaSource store={s} className="mt-0.5" />
                        </>
                      )}
                    </div>

                    <div className="w-[76px]">
                      <p className="text-[12px] text-muted">ไม่ได้เข้า</p>
                      <p className="tnum text-[14px] font-semibold">
                        {s.daysSinceLastVisit === null ? "—" : `${s.daysSinceLastVisit} วัน`}
                      </p>
                    </div>

                    <div className="w-[96px]">
                      <p className="text-[12px] text-muted">เวลาในร้านเฉลี่ย</p>
                      {/* Measured from this store's own closed visits. A store
                          with none shows a dash, never a default. */}
                      <p className="tnum text-[14px] font-semibold">
                        {s.avgVisitMinutes === null
                          ? "—"
                          : s.avgVisitMinutes < 1
                            ? "<1′"
                            : `${s.avgVisitMinutes}′`}
                      </p>
                    </div>

                    <RiskBadge band={s.riskBand} />

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
          )}
        </section>

        {/* ---- summary ---- */}
        <motion.aside variants={fadeUp} initial="hidden" animate="show" transition={{ delay: 0.15 }}>
          <div className="sticky top-6 rounded-card border border-line bg-bg p-5 shadow-[var(--shadow-card)]">
            <h2 className="text-[15px] font-semibold">สรุปเส้นทาง</h2>

            <dl className="mt-4 space-y-3">
              <Metric label="จำนวนร้าน" value={`${active.length}`} unit="ร้าน" />
              <Metric
                label={
                  measured.length === active.length
                    ? "เวลาในร้านรวม"
                    : `เวลาในร้านรวม (จาก ${measured.length}/${active.length} ร้านที่มีข้อมูล)`
                }
                value={`${Math.floor(totalMin / 60)} ชม. ${Math.round(totalMin % 60)}`}
                unit="นาที"
              />
              <Metric label="ร้านเสี่ยงสูงในแผน" value={`${highRisk}`} unit="ร้าน" tone="danger" />
            </dl>

            <div className="mt-4 border-t border-line pt-4">
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-muted">ครอบคลุมร้านเสี่ยงสูง</span>
                <span className="tnum font-semibold">{coverage}%</span>
              </div>
              <Bar value={coverage} tone={coverage === 100 ? "ok" : "warn"} className="mt-2 w-full" height={7} />
              {highRiskTotal === 0 ? (
                <p className="mt-2 text-[13px] leading-relaxed text-muted">
                  ไม่มีร้านเสี่ยงสูงในพื้นที่นี้ตอนนี้
                </p>
              ) : coverage < 100 ? (
                <p className="mt-2 text-[13px] leading-relaxed text-[#b45f04]">
                  ยังมีร้านเสี่ยงสูงที่ถูกตัดออกจากแผน ควรทบทวนก่อน
                </p>
              ) : null}
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
                    ทำเครื่องหมายว่าตรวจแล้ว
                  </motion.div>
                ) : (
                  <motion.div key="cta" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                    <Button full onClick={() => setApproved(true)}>
                      ทำเครื่องหมายว่าตรวจแล้ว
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>
              {/* This used to read "การอนุมัติจะส่งแผนไปที่แอปของพนักงานในพื้นที่".
                  Nothing is sent: the ordering and the approval both live in
                  this component's state and are gone on reload. The sentence
                  about not contacting stores is a standing guardrail
                  (docs/ui.md §1.5 ข้อ 6) and stays. */}
              <p className="mt-3 text-[12px] leading-relaxed text-faint">
                ลำดับที่จัดไว้และการทำเครื่องหมายนี้ยังไม่ถูกบันทึก —
                เป็นการดูตัวอย่างในหน้านี้เท่านั้น รีเฟรชแล้วจะกลับไปเป็นลำดับตามความเสี่ยง
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
