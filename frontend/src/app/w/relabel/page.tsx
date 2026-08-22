"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { PageHeader } from "@/components/web/WebShell";
import { CropView } from "@/components/shelf/CropView";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Badge";
import { Segmented } from "@/components/ui/Controls";
import { buildAnalysis } from "@/lib/mock/shelf";
import { RELABEL_QUEUE, type RelabelItem } from "@/lib/mock/analytics";
import { listItem, stagger, fadeUp, easeOut, springSnappy } from "@/lib/motion";
import { cn } from "@/lib/cn";

const analysis = buildAnalysis();
const GAP_DETECTIONS = analysis.detections.filter((d) => d.semanticType === "GAP");

type Filter = "ALL" | "LOW_CONFIDENCE" | "REP_REJECTED";

export default function RelabelQueue() {
  const [filter, setFilter] = useState<Filter>("ALL");
  const [selected, setSelected] = useState<string[]>([]);
  const [sent, setSent] = useState<string[]>([]);

  const items = useMemo(
    () =>
      RELABEL_QUEUE.filter((i) => !sent.includes(i.id)).filter((i) =>
        filter === "ALL" ? true : i.reason === filter,
      ),
    [filter, sent],
  );

  const rejectedCount = RELABEL_QUEUE.filter((i) => !sent.includes(i.id) && i.reason === "REP_REJECTED").length;
  const lowConfCount = RELABEL_QUEUE.filter((i) => !sent.includes(i.id) && i.reason === "LOW_CONFIDENCE").length;

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function sendToRetrain() {
    setSent((prev) => [...prev, ...selected]);
    setSelected([]);
  }

  return (
    <>
      <PageHeader
        title="คิวตรวจภาพเพื่อปรับปรุงโมเดล"
        subtitle="ภาพที่โมเดลไม่มั่นใจ และภาพที่พนักงานตีกลับ — ตรวจแล้วส่งเข้ารอบเทรนถัดไป"
        actions={
          <Segmented
            ariaLabel="ตัวกรองที่มาของภาพ"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "ALL", label: "ทั้งหมด" },
              { value: "REP_REJECTED", label: "ถูกตีกลับ" },
              { value: "LOW_CONFIDENCE", label: "ความมั่นใจต่ำ" },
            ]}
          />
        }
      />

      <div className="px-6 py-6 lg:px-8">
        <motion.div
          variants={fadeUp}
          initial="hidden"
          animate="show"
          className="mb-5 grid gap-4 sm:grid-cols-3"
        >
          <Tile label="รอตรวจทั้งหมด" value={items.length} tone="neutral" />
          <Tile label="ถูกพนักงานตีกลับ" value={rejectedCount} tone="warn" />
          <Tile label="โมเดลไม่มั่นใจ (< 60%)" value={lowConfCount} tone="uncertain" />
        </motion.div>

        {items.length === 0 ? (
          <motion.div
            variants={fadeUp}
            initial="hidden"
            animate="show"
            role="status"
            className="flex flex-col items-center rounded-card border border-line bg-bg px-6 py-16 text-center"
          >
            <div className="grid size-16 place-items-center rounded-full bg-ok-soft">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" className="text-ok" aria-hidden>
                <path d="M5 12.5l5 5L19 7" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h2 className="mt-4 text-[18px] font-semibold">ตรวจครบทุกภาพแล้ว</h2>
            <p className="mt-1.5 max-w-[340px] text-[14px] leading-relaxed text-muted">
              ภาพที่เลือกไว้ถูกส่งเข้ารอบเทรนถัดไปเรียบร้อย
              ระบบจะแจ้งเมื่อมีภาพใหม่เข้าคิว
            </p>
          </motion.div>
        ) : (
          <motion.ul
            variants={stagger(0.04)}
            initial="hidden"
            animate="show"
            className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
          >
            <AnimatePresence mode="popLayout">
              {items.map((item, i) => (
                <RelabelCard
                  key={item.id}
                  item={item}
                  index={i}
                  checked={selected.includes(item.id)}
                  onToggle={() => toggle(item.id)}
                />
              ))}
            </AnimatePresence>
          </motion.ul>
        )}
      </div>

      {/* selection bar */}
      <AnimatePresence>
        {selected.length > 0 && (
          <motion.div
            initial={{ y: 90, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 90, opacity: 0 }}
            transition={springSnappy}
            className="sticky bottom-0 z-40 border-t border-line bg-bg/95 px-6 py-3.5 backdrop-blur-sm lg:px-8"
          >
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-[14px] font-medium">
                เลือกไว้ <span className="tnum font-semibold">{selected.length}</span> ภาพ
              </p>
              <button
                type="button"
                onClick={() => setSelected([])}
                className="h-9 rounded-btn px-3 text-[13px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-text"
              >
                ล้างที่เลือก
              </button>
              <div className="flex-1" />
              <Button variant="secondary" size="sm">
                มอบหมายให้ผู้ตรวจฉลาก
              </Button>
              <Button size="sm" onClick={sendToRetrain}>
                ส่งเข้ารอบเทรนถัดไป
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function RelabelCard({
  item,
  index,
  checked,
  onToggle,
}: {
  item: RelabelItem;
  index: number;
  checked: boolean;
  onToggle: () => void;
}) {
  const det = GAP_DETECTIONS[index % GAP_DETECTIONS.length];
  return (
    <motion.li
      variants={listItem}
      layout
      exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.2, ease: easeOut } }}
    >
      <div
        className={cn(
          "overflow-hidden rounded-card border bg-bg shadow-[var(--shadow-card)] transition-colors",
          checked ? "border-primary" : "border-line",
        )}
      >
        <div className="relative">
          <CropView bbox={det.bbox} detections={analysis.detections} focusId={det.detectionId} zoomTarget={0.42} />
          <label
            className="absolute left-3 top-3 flex cursor-pointer items-center gap-2 rounded-pill bg-ink/70 px-2.5 py-1.5 backdrop-blur-sm"
          >
            <input type="checkbox" checked={checked} onChange={onToggle} className="sr-only peer" />
            <span
              aria-hidden
              className={cn(
                "grid size-5 place-items-center rounded-[6px] border-2 transition-colors",
                "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-white",
                checked ? "border-primary bg-primary" : "border-white/70 bg-transparent",
              )}
            >
              {checked && (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                  <path d="M5 12.5l5 5L19 7" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
            <span className="text-[12px] font-medium text-ink-text">เลือก</span>
          </label>
        </div>

        <div className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-[14px] font-semibold">{item.store}</p>
              <p className="truncate text-[13px] text-muted">
                {item.category} · {item.capturedAt}
              </p>
            </div>
            <Pill tone={item.reason === "REP_REJECTED" ? "warn" : "uncertain"} className="shrink-0 text-[12px]">
              {item.reason === "REP_REJECTED" ? "ถูกตีกลับ" : "ไม่มั่นใจ"}
            </Pill>
          </div>

          {item.rejectedReason && (
            <p className="mt-2 rounded-inset bg-surface px-2.5 py-1.5 text-[13px] text-muted">
              เหตุผล: {item.rejectedReason}
            </p>
          )}

          <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
            <span className="text-[12px] text-muted">ความมั่นใจของโมเดล</span>
            <span className="tnum text-[13px] font-semibold">{Math.round(item.confidence * 100)}%</span>
          </div>
        </div>
      </div>
    </motion.li>
  );
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "neutral" | "warn" | "uncertain";
}) {
  const tones = {
    neutral: "bg-surface-2 text-muted",
    warn: "bg-warn-soft text-[#b45f04]",
    uncertain: "bg-uncertain-soft text-muted",
  } as const;
  return (
    <div className="rounded-card border border-line bg-bg p-5 shadow-[var(--shadow-card)]">
      <span className={cn("inline-block rounded-pill px-2.5 py-1 text-[12px] font-medium", tones[tone])}>
        {label}
      </span>
      <p className="tnum mt-2.5 text-[30px] font-bold leading-none">{value}</p>
    </div>
  );
}
