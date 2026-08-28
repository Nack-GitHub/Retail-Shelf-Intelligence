"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { PageHeader } from "@/components/web/WebShell";
import { CropView } from "@/components/shelf/CropView";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Badge";
import { Segmented } from "@/components/ui/Controls";
import { ErrorBlock, LoadingBlock } from "@/components/ui/AsyncState";
import {
  fetchRelabelQueue,
  REJECT_REASON_LABELS,
  type RelabelItem,
} from "@/lib/api/model";
import { useResource } from "@/lib/api/useResource";
import { listItem, stagger, fadeUp, easeOut, springSnappy } from "@/lib/motion";
import { cn } from "@/lib/cn";

type Filter = "ALL" | "LOW_CONFIDENCE" | "REP_REJECTED";

export default function RelabelQueue() {
  const queue = useResource(() => fetchRelabelQueue(60), []);

  const [filter, setFilter] = useState<Filter>("ALL");
  const [selected, setSelected] = useState<string[]>([]);
  const [sent, setSent] = useState<string[]>([]);

  const pending = useMemo(
    () => (queue.data ?? []).filter((i) => !sent.includes(i.findingId)),
    [queue.data, sent],
  );
  const items = useMemo(
    () => pending.filter((i) => (filter === "ALL" ? true : i.reason === filter)),
    [pending, filter],
  );

  const rejectedCount = pending.filter((i) => i.reason === "REP_REJECTED").length;
  const lowConfCount = pending.filter((i) => i.reason === "LOW_CONFIDENCE").length;

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
        {queue.state === "LOADING" ? (
          <LoadingBlock label="กำลังโหลดคิวตรวจภาพ…" />
        ) : queue.state === "ERROR" ? (
          <ErrorBlock message={queue.error ?? ""} onRetry={queue.reload} />
        ) : (
        <>
        <motion.div
          variants={fadeUp}
          initial="hidden"
          animate="show"
          className="mb-5 grid gap-4 sm:grid-cols-3"
        >
          <Tile label="รอตรวจทั้งหมด" value={items.length} tone="neutral" />
          <Tile label="ถูกพนักงานตีกลับ" value={rejectedCount} tone="warn" />
          <Tile label="โมเดลไม่มั่นใจ" value={lowConfCount} tone="uncertain" />
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
            <h2 className="mt-4 text-[18px] font-semibold">ไม่มีภาพรอตรวจในคิว</h2>
            <p className="mt-1.5 max-w-[360px] text-[14px] leading-relaxed text-muted">
              ภาพจะเข้าคิวอัตโนมัติเมื่อพนักงานตีกลับผลการตรวจ
              หรือเมื่อโมเดลไม่มั่นใจในจุดที่ตรวจพบ
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
              {items.map((item) => (
                <RelabelCard
                  key={item.findingId}
                  item={item}
                  checked={selected.includes(item.findingId)}
                  onToggle={() => toggle(item.findingId)}
                />
              ))}
            </AnimatePresence>
          </motion.ul>
        )}
        </>
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
              {/* Marking for the next training round is a local selection in
                  this build — there is no endpoint behind it yet, and a button
                  that silently does nothing is worse than one that says so. */}
              <p className="text-[12px] leading-relaxed text-faint">
                การเลือกยังไม่ถูกส่งไปยังรอบเทรน — ใช้คัดภาพไว้ก่อนได้
              </p>
              <Button size="sm" onClick={sendToRetrain}>
                ทำเครื่องหมายว่าตรวจแล้ว
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
  checked,
  onToggle,
}: {
  item: RelabelItem;
  checked: boolean;
  onToggle: () => void;
}) {
  const capturedLabel = item.capturedAt
    ? new Date(item.capturedAt).toLocaleString("th-TH", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "ไม่ทราบเวลา";

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
          {/* The real crop, from the real capture. A reviewer relabelling a
              stand-in image would be labelling nothing. */}
          {item.bbox && item.imageUrl && item.imageWidth && item.imageHeight ? (
            <CropView
              bbox={item.bbox}
              detections={[
                {
                  detectionId: item.findingId,
                  classId: -1,
                  className: "",
                  semanticType: "GAP",
                  bbox: item.bbox,
                  confidence: item.confidence,
                  shelfRowIndex: 0,
                },
              ]}
              focusId={item.findingId}
              zoomTarget={0.42}
              imageUrl={item.imageUrl}
              imageWidth={item.imageWidth}
              imageHeight={item.imageHeight}
            />
          ) : (
            <div className="grid aspect-[16/10] place-items-center bg-surface-2 px-4 text-center text-[13px] text-muted">
              ไม่มีภาพสำหรับรายการนี้
            </div>
          )}
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
              <p className="truncate text-[14px] font-semibold">{item.storeName}</p>
              <p className="truncate text-[13px] text-muted">
                {item.category} · {capturedLabel}
              </p>
            </div>
            <Pill tone={item.reason === "REP_REJECTED" ? "warn" : "uncertain"} className="shrink-0 text-[12px]">
              {item.reason === "REP_REJECTED" ? "ถูกตีกลับ" : "ไม่มั่นใจ"}
            </Pill>
          </div>

          {item.rejectedReason && (
            /* ⛔ The reason, never the person who gave it. */
            <p className="mt-2 rounded-inset bg-surface px-2.5 py-1.5 text-[13px] text-muted">
              เหตุผล: {REJECT_REASON_LABELS[item.rejectedReason] ?? item.rejectedReason}
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
