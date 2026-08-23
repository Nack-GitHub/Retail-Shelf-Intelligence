"use client";

import { useMemo } from "react";
import { motion } from "motion/react";
import Link from "next/link";
import { PageHeader } from "@/components/web/WebShell";
import { LineChart } from "@/components/charts/LineChart";
import { Bar, CountUp } from "@/components/ui/Progress";
import { Pill } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ErrorBlock, LoadingBlock } from "@/components/ui/AsyncState";
import { fetchModelHealth, type ModelVersion } from "@/lib/api/model";
import { useResource } from "@/lib/api/useResource";
import { fadeUp, listItem, stagger, easeOut } from "@/lib/motion";
import { cn } from "@/lib/cn";

/* W5 — Model health.
 *
 * There is no drift chart here. Drift needs a reference distribution to
 * measure against and this system stores none; a number with nothing behind
 * it is decoration. What replaced it is the rate at which reps overrule the
 * model, counted from real verifications — it moves for the same reasons
 * drift would, and every point is traceable to rows in gap_findings. */

/* Thai labels and rationales for the gate keys the ML pipeline writes into
   metrics.json. The pipeline's own rationale strings are English — they are
   written for the ML team — and every other word on this screen is Thai, so
   they are translated here rather than shown raw. An unknown gate falls back
   to whatever the pipeline wrote, which is better than showing nothing. */
const GATE_LABELS: Record<string, string> = {
  recall_empty_shelf: "Recall — คลาสช่องว่าง",
  precision_empty_shelf: "Precision — คลาสช่องว่าง",
  map50_overall: "mAP@0.5 ทุกคลาส",
};

const GATE_RATIONALES: Record<string, string> = {
  recall_empty_shelf:
    "ช่องว่างที่ตรวจไม่เจอคือยอดขายที่เสียไปโดยกู้คืนไม่ได้ เพราะพนักงานเดินออกจากร้านไปแล้ว",
  precision_empty_shelf:
    "ถ้าต่ำกว่านี้ พนักงานจะเลิกเชื่อการแจ้งเตือน แล้วการใช้งานทั้งระบบจะล่มไปเอง",
  map50_overall: "คุณภาพการตรวจจับโดยรวมของโมเดล",
};

export default function ModelHealth() {
  const health = useResource(() => fetchModelHealth(12), []);

  const versions = useMemo(() => health.data?.versions ?? [], [health.data]);
  const scored = versions.find((v) => v.metrics);
  const gates = scored?.metrics?.gates ?? {};
  const failing = Object.values(gates).filter((g) => !g.passed).length;

  const override = useMemo(
    () =>
      (health.data?.overrideRate ?? []).map((p) => ({
        label: new Date(p.bucket).toLocaleDateString("th-TH", { day: "numeric", month: "short" }),
        value: Number((p.rate * 100).toFixed(1)),
      })),
    [health.data],
  );
  const latestOverride = override.at(-1)?.value ?? null;

  if (health.state === "LOADING") return <LoadingBlock label="กำลังโหลดสุขภาพของโมเดล…" />;
  if (health.state === "ERROR") {
    return (
      <div className="p-8">
        <ErrorBlock message={health.error ?? ""} onRetry={health.reload} />
      </div>
    );
  }

  const active = versions.find((v) => v.isActive);

  return (
    <>
      <PageHeader
        title="สุขภาพของโมเดล"
        subtitle={
          active
            ? `ใช้งานอยู่: ${active.version} · โหมดอนุมาน ${health.data?.mlClient ?? "—"}`
            : "ยังไม่มีโมเดลที่ถูกอนุมัติให้ใช้งาน"
        }
      />

      <div className="px-6 py-6 lg:px-8">
        {/* ---- gate failures ---- */}
        {scored && failing > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: easeOut }}
            role="alert"
            className="mb-5 flex flex-wrap items-start gap-3 rounded-card border border-danger/25 bg-danger-soft px-4 py-3.5"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="mt-0.5 shrink-0 text-danger" aria-hidden>
              <path d="M12 3l9.5 16.5h-19L12 3z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              <path d="M12 9.5v4.2M12 16.8h.01" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" />
            </svg>
            <div className="min-w-[240px] flex-1">
              <p className="text-[15px] font-semibold text-[#a52218]">
                <span className="tnum">{failing}</span> เกณฑ์ยังไม่ผ่าน — {scored.version} จึงยังไม่ถูกนำขึ้นใช้งานจริง
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-[#a52218]/85">
                ระบบยังอนุมานด้วยโหมด <span className="font-semibold">{health.data?.mlClient}</span>{" "}
                จนกว่าโมเดลจะผ่านเกณฑ์ทั้งหมด
              </p>
            </div>
            <Link href="/w/relabel">
              <Button size="sm">ไปที่คิวตรวจภาพ</Button>
            </Link>
          </motion.div>
        )}

        {/* ---- gate cards ---- */}
        {scored ? (
          <motion.ul
            variants={stagger(0.06)}
            initial="hidden"
            animate="show"
            className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
          >
            {Object.entries(gates).map(([key, gate]) => {
              // detail reads "0.4113 vs >= 0.9" — the measured value first
              const [measured, threshold] = gate.detail.split(" vs ");
              const value = Number(measured);
              return (
                <motion.li
                  key={key}
                  variants={listItem}
                  className="rounded-card border border-line bg-bg p-5 shadow-[var(--shadow-card)]"
                >
                  <p className="min-h-[38px] text-[13px] leading-snug text-muted">
                    {GATE_LABELS[key] ?? key}
                  </p>
                  <p className="mt-2 flex items-baseline gap-1">
                    <CountUp
                      to={Number.isFinite(value) ? value : 0}
                      decimals={3}
                      className="text-[30px] font-bold leading-none tracking-tight"
                    />
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "rounded-pill px-2 py-0.5 text-[12px] font-semibold",
                        gate.passed ? "bg-ok-soft text-[#07794a]" : "bg-danger-soft text-[#a52218]",
                      )}
                    >
                      {gate.passed ? "ผ่านเกณฑ์" : "ต่ำกว่าเกณฑ์"}
                    </span>
                    <span className="tnum text-[12px] text-faint">เกณฑ์ {threshold}</span>
                  </div>
                  <Bar
                    value={Math.min(100, (Number.isFinite(value) ? value : 0) * 100)}
                    tone={gate.passed ? "ok" : "danger"}
                    className="mt-3 w-full"
                    height={5}
                  />
                  {/* The rationale ships with the metrics: a gate nobody can
                      explain is a gate someone will quietly lower. */}
                  <p className="mt-3 border-t border-line pt-3 text-[12px] leading-relaxed text-muted">
                    {GATE_RATIONALES[key] ?? gate.rationale}
                  </p>
                </motion.li>
              );
            })}
          </motion.ul>
        ) : (
          <p className="rounded-card border border-line bg-bg px-5 py-10 text-center text-[14px] leading-relaxed text-muted">
            ยังไม่มีโมเดลที่ผ่านการประเมินบนเครื่องนี้
            <br />
            เมื่อรัน <span className="font-mono text-[13px]">make evaluate</span> แล้วผลจะปรากฏที่นี่
          </p>
        )}

        {/* ---- override rate ---- */}
        <motion.section
          variants={fadeUp}
          initial="hidden"
          animate="show"
          transition={{ delay: 0.25 }}
          className="mt-5 rounded-card border border-line bg-bg shadow-[var(--shadow-card)]"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <h2 className="text-[16px] font-semibold">อัตราการตีกลับจากหน้างาน</h2>
              <p className="mt-0.5 text-[13px] text-muted">
                สัดส่วนของจุดที่โมเดลบอกว่าเป็นช่องว่าง แต่พนักงานยืนยันว่าไม่ใช่ · นับรายสัปดาห์จากการตรวจสอบจริง
              </p>
            </div>
            {latestOverride !== null && (
              <Pill tone={latestOverride <= 10 ? "ok" : "danger"}>
                <span className="tnum">ล่าสุด {latestOverride}%</span>
              </Pill>
            )}
          </div>
          <div className="px-3 py-4 sm:px-5">
            {override.length === 0 ? (
              <p className="px-2 py-12 text-center text-[14px] leading-relaxed text-muted">
                ยังไม่มีการตรวจสอบผลจากหน้างาน
                <br />
                ตัวเลขนี้จะเริ่มนับเมื่อพนักงานยืนยันหรือตีกลับผลการตรวจ
              </p>
            ) : override.length < 2 ? (
              <p className="px-2 py-12 text-center text-[14px] leading-relaxed text-muted">
                มีข้อมูลเพียงสัปดาห์เดียว ({override[0].value}%)
                <br />
                ต้องมีอย่างน้อย 2 สัปดาห์จึงจะเห็นแนวโน้มได้
              </p>
            ) : (
              <LineChart
                data={override}
                target={10}
                targetLabel="เกณฑ์ที่ยอมรับได้ 10%"
                color="#d92d20"
                height={250}
                unit="%"
                decimals={1}
              />
            )}
          </div>
          <p className="border-t border-line px-5 py-3.5 text-[12px] leading-relaxed text-faint">
            ตัวเลขนี้วัดคุณภาพของโมเดล ไม่ใช่คุณภาพของพนักงาน
            การตีกลับมากแปลว่าโมเดลต้องปรับ ไม่ใช่ว่าคนทำงานผิด
            และระบบไม่บันทึกว่าใครเป็นผู้ตีกลับ
          </p>
        </motion.section>

        {/* ---- versions ---- */}
        <motion.section
          variants={fadeUp}
          initial="hidden"
          animate="show"
          transition={{ delay: 0.35 }}
          className="mt-5 overflow-hidden rounded-card border border-line bg-bg shadow-[var(--shadow-card)]"
        >
          <div className="border-b border-line px-5 py-4">
            <h2 className="text-[16px] font-semibold">ประวัติเวอร์ชันของโมเดล</h2>
            <p className="mt-0.5 text-[13px] text-muted">
              ผลตรวจเดิมยังอ้างอิงเวอร์ชันที่ใช้ตอนนั้นเสมอ ไม่ถูกเขียนทับเมื่อมีโมเดลใหม่
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse text-left">
              <thead>
                <tr className="border-b border-line bg-surface/60">
                  {["เวอร์ชัน", "SHA", "ชุดข้อมูล", "ขึ้นใช้งาน", "สถานะ"].map((h) => (
                    <th key={h} scope="col" className="px-4 py-2.5 text-[12px] font-semibold uppercase tracking-wide text-muted">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {versions.map((v: ModelVersion) => (
                  <tr key={v.version} className="border-b border-line last:border-0">
                    <td className="px-4 py-3 text-[14px] font-medium">{v.version}</td>
                    <td className="tnum px-4 py-3 font-mono text-[13px] text-muted">{v.sha}</td>
                    <td className="px-4 py-3 text-[13px] text-muted">
                      {v.sourceDataset}
                      {v.datasetVersion && v.datasetVersion !== "—" ? ` · ${v.datasetVersion}` : ""}
                    </td>
                    <td className="px-4 py-3 text-[13px]">
                      {v.promotedAt
                        ? new Date(v.promotedAt).toLocaleDateString("th-TH", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {v.isActive ? (
                        <Pill tone="ok">ใช้งานอยู่</Pill>
                      ) : v.metrics && !v.metrics.all_gates_passed ? (
                        <Pill tone="danger">ไม่ผ่านเกณฑ์</Pill>
                      ) : (
                        <Pill tone="neutral">เก็บไว้อ้างอิง</Pill>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.section>
      </div>
    </>
  );
}
