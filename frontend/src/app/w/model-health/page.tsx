"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { PageHeader } from "@/components/web/WebShell";
import { LineChart } from "@/components/charts/LineChart";
import { Bar, CountUp } from "@/components/ui/Progress";
import { Pill } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  DRIFT_SERIES,
  DRIFT_THRESHOLD,
  MODEL_METRICS,
  MODEL_VERSIONS,
} from "@/lib/mock/analytics";
import { fadeUp, listItem, stagger, easeOut } from "@/lib/motion";
import { cn } from "@/lib/cn";

export default function ModelHealth() {
  const latestDrift = DRIFT_SERIES[DRIFT_SERIES.length - 1].value;
  const breaching = latestDrift > DRIFT_THRESHOLD;
  const overrideMetric = MODEL_METRICS.find((m) => m.id === "override")!;

  return (
    <>
      <PageHeader
        title="สุขภาพของโมเดล"
        subtitle="shelf-product-v3 · ใช้งานตั้งแต่ 2 ส.ค. 2569 · ประเมินจากชุดทดสอบและผลตอบกลับจากหน้างาน"
        actions={
          <Button variant="secondary" size="sm">
            ดู Model Card
          </Button>
        }
      />

      <div className="px-6 py-6 lg:px-8">
        {/* ---- drift alert ---- */}
        {breaching && (
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
                ค่า drift เกินเกณฑ์ที่ตั้งไว้
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-[#a52218]/85">
                สัปดาห์นี้อยู่ที่ <span className="tnum font-semibold">{(latestDrift * 100).toFixed(1)}%</span>{" "}
                สูงกว่าเกณฑ์ <span className="tnum font-semibold">{(DRIFT_THRESHOLD * 100).toFixed(0)}%</span>{" "}
                และอัตราการตีกลับจากหน้างานเพิ่มขึ้น — ควรตรวจสอบว่ามีแพ็กเกจจิ้งหรือเลย์เอาต์ชั้นวางแบบใหม่เข้ามาหรือไม่
              </p>
            </div>
            <Link href="/w/relabel">
              <Button size="sm">ไปที่คิวตรวจภาพ</Button>
            </Link>
          </motion.div>
        )}

        {/* ---- metric cards ---- */}
        <motion.ul
          variants={stagger(0.06)}
          initial="hidden"
          animate="show"
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        >
          {MODEL_METRICS.map((m) => {
            const isOverride = m.id === "override";
            const good = isOverride ? m.value <= m.target : m.value >= m.target;
            const shown = m.format === "pct" ? m.value * 100 : m.value;
            return (
              <motion.li
                key={m.id}
                variants={listItem}
                className="rounded-card border border-line bg-bg p-5 shadow-[var(--shadow-card)]"
              >
                <p className="min-h-[38px] text-[13px] leading-snug text-muted">{m.label}</p>
                <p className="mt-2 flex items-baseline gap-1">
                  <CountUp
                    to={shown}
                    decimals={m.format === "pct" ? 1 : 3}
                    className="text-[30px] font-bold leading-none tracking-tight"
                  />
                  {m.format === "pct" && <span className="text-[16px] font-semibold text-muted">%</span>}
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <span
                    className={cn(
                      "rounded-pill px-2 py-0.5 text-[12px] font-semibold",
                      good ? "bg-ok-soft text-[#07794a]" : "bg-danger-soft text-[#a52218]",
                    )}
                  >
                    {good ? "ผ่านเกณฑ์" : "ต่ำกว่าเกณฑ์"}
                  </span>
                  <span className="tnum text-[12px] text-faint">
                    เกณฑ์ {m.format === "pct" ? `${(m.target * 100).toFixed(0)}%` : m.target.toFixed(2)}
                  </span>
                </div>
                <div className="mt-3.5 border-t border-line pt-3">
                  <div className="flex items-center justify-between text-[12px] text-muted">
                    <span>เทียบสัปดาห์ก่อน</span>
                    <span className={cn("tnum font-semibold", (isOverride ? m.trend < 0 : m.trend > 0) ? "text-ok" : "text-danger")}>
                      {m.trend > 0 ? "+" : ""}
                      {(m.format === "pct" ? m.trend * 100 : m.trend).toFixed(m.format === "pct" ? 1 : 3)}
                    </span>
                  </div>
                  <Bar
                    value={Math.min(100, (m.value / (isOverride ? 0.25 : 1)) * 100)}
                    tone={good ? "ok" : "danger"}
                    className="mt-2 w-full"
                    height={5}
                  />
                </div>
              </motion.li>
            );
          })}
        </motion.ul>

        <div className="mt-5 grid gap-5 xl:grid-cols-[1.6fr_1fr]">
          {/* ---- drift chart ---- */}
          <motion.section
            variants={fadeUp}
            initial="hidden"
            animate="show"
            transition={{ delay: 0.25 }}
            className="rounded-card border border-line bg-bg shadow-[var(--shadow-card)]"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
              <div>
                <h2 className="text-[16px] font-semibold">Drift ของการกระจายข้อมูลเข้า</h2>
                <p className="mt-0.5 text-[13px] text-muted">
                  ระยะห่างระหว่างภาพที่เข้ามาจริงกับชุดข้อมูลที่ใช้เทรน (ยิ่งต่ำยิ่งดี)
                </p>
              </div>
              <Pill tone={breaching ? "danger" : "ok"}>
                {breaching ? "เกินเกณฑ์" : "อยู่ในเกณฑ์"}
              </Pill>
            </div>
            <div className="px-3 py-4 sm:px-5">
              <LineChart
                data={DRIFT_SERIES.map((d) => ({ label: d.week, value: d.value * 100 }))}
                target={DRIFT_THRESHOLD * 100}
                targetLabel={`เกณฑ์ ${(DRIFT_THRESHOLD * 100).toFixed(0)}%`}
                color={breaching ? "#d92d20" : "#1b6fe8"}
                height={250}
                unit="%"
              />
            </div>
          </motion.section>

          {/* ---- override rate ---- */}
          <motion.section
            variants={fadeUp}
            initial="hidden"
            animate="show"
            transition={{ delay: 0.3 }}
            className="rounded-card border border-line bg-bg p-5 shadow-[var(--shadow-card)]"
          >
            <h2 className="text-[16px] font-semibold">อัตราการตีกลับจากหน้างาน</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              สัดส่วนของจุดที่ AI บอกว่าเป็นช่องว่าง แต่พนักงานยืนยันว่าไม่ใช่
            </p>

            <div className="mt-5 flex items-baseline gap-2">
              <CountUp to={overrideMetric.value * 100} decimals={1} className="text-[38px] font-bold leading-none tracking-tight text-danger" />
              <span className="text-[18px] font-semibold text-muted">%</span>
            </div>
            <Bar value={overrideMetric.value * 400} tone="danger" className="mt-3 w-full" height={8} />
            <p className="mt-2 text-[13px] text-muted">
              เกณฑ์ที่ยอมรับได้ <span className="tnum font-semibold text-text">10%</span> ·
              เพิ่มขึ้น <span className="tnum font-semibold text-danger">+2.1</span> จุดจากเดือนก่อน
            </p>

            <div className="mt-5 rounded-card bg-surface px-3.5 py-3">
              <p className="text-[13px] font-semibold">เหตุผลที่ถูกตีกลับมากที่สุด</p>
              <ul className="mt-2.5 space-y-2">
                {[
                  { label: "มีของแต่ถูกบัง", pct: 48 },
                  { label: "ไม่ใช่สินค้าของเรา", pct: 29 },
                  { label: "เป็นพื้นที่ว่างปกติ", pct: 18 },
                  { label: "อื่น ๆ", pct: 5 },
                ].map((r) => (
                  <li key={r.label} className="flex items-center gap-3">
                    <span className="w-[128px] shrink-0 text-[13px] text-muted">{r.label}</span>
                    <Bar value={r.pct} tone="muted" className="flex-1" height={6} />
                    <span className="tnum w-9 text-right text-[13px] font-semibold">{r.pct}%</span>
                  </li>
                ))}
              </ul>
            </div>

            <p className="mt-4 text-[12px] leading-relaxed text-faint">
              ตัวเลขนี้วัดคุณภาพของโมเดล ไม่ใช่คุณภาพของพนักงาน
              การตีกลับมากแปลว่าโมเดลต้องปรับ ไม่ใช่ว่าคนทำงานผิด
            </p>
          </motion.section>
        </div>

        {/* ---- versions ---- */}
        <motion.section
          variants={fadeUp}
          initial="hidden"
          animate="show"
          transition={{ delay: 0.4 }}
          className="mt-5 overflow-hidden rounded-card border border-line bg-bg shadow-[var(--shadow-card)]"
        >
          <div className="border-b border-line px-5 py-4">
            <h2 className="text-[16px] font-semibold">ประวัติเวอร์ชันของโมเดล</h2>
            <p className="mt-0.5 text-[13px] text-muted">
              ผลตรวจเดิมยังอ้างอิงเวอร์ชันที่ใช้ตอนนั้นเสมอ ไม่ถูกเขียนทับเมื่อมีโมเดลใหม่
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left">
              <thead>
                <tr className="border-b border-line bg-surface/60">
                  {["เวอร์ชัน", "SHA", "ชุดข้อมูล", "จำนวนภาพ", "ขึ้นใช้งาน", "สถานะ"].map((h) => (
                    <th key={h} scope="col" className="px-4 py-2.5 text-[12px] font-semibold uppercase tracking-wide text-muted">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MODEL_VERSIONS.map((v) => (
                  <tr key={v.version} className="border-b border-line last:border-0">
                    <td className="px-4 py-3 text-[14px] font-medium">{v.version}</td>
                    <td className="tnum px-4 py-3 font-mono text-[13px] text-muted">{v.sha}</td>
                    <td className="px-4 py-3 text-[13px] text-muted">{v.dataset}</td>
                    <td className="tnum px-4 py-3 text-[13px]">{v.images.toLocaleString("th-TH")}</td>
                    <td className="px-4 py-3 text-[13px]">{v.promotedAt}</td>
                    <td className="px-4 py-3">
                      {v.active ? <Pill tone="ok">ใช้งานอยู่</Pill> : <Pill tone="neutral">เก็บไว้อ้างอิง</Pill>}
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
