"use client";

import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import { MobileHeader, BottomBar, Scroll } from "@/components/mobile/Chrome";
import { Button } from "@/components/ui/Button";
import { Toggle } from "@/components/ui/Controls";
import { useDemo } from "@/lib/store";
import type { SyncItem } from "@/types";
import { listItem, stagger, easeOut } from "@/lib/motion";
import { cn } from "@/lib/cn";

const KIND_LABEL = {
  CAPTURE: "ภาพถ่าย",
  VERIFY: "ผลตรวจสอบ",
  TASK: "งานที่ปิด",
  CHECKOUT: "สรุปการเข้าร้าน",
} as const;

export default function SyncQueueScreen() {
  const items = useDemo((s) => s.sync);
  const syncAll = useDemo((s) => s.syncAll);
  const retry = useDemo((s) => s.retrySync);
  const online = useDemo((s) => s.online);
  const setOnline = useDemo((s) => s.setOnline);

  const pending = items.filter((i) => i.status === "PENDING").length;
  const failed = items.filter((i) => i.status === "FAILED").length;
  const uploading = items.filter((i) => i.status === "UPLOADING").length;
  const totalKb = items
    .filter((i) => i.status !== "DONE")
    .reduce((sum, i) => sum + i.sizeKb, 0);

  return (
    <>
      <MobileHeader
        title="คิวรอส่งข้อมูล"
        subtitle={
          pending + failed + uploading === 0
            ? "ส่งข้อมูลครบแล้ว"
            : `${pending + failed + uploading} รายการ · ${(totalKb / 1024).toFixed(1)} MB`
        }
      />

      <Scroll className="px-4 pt-4 pb-5">
        <div
          className={cn(
            "mb-4 flex items-start gap-2.5 rounded-card px-3.5 py-3",
            online ? "bg-primary-soft" : "bg-warn-soft",
          )}
        >
          <span className={cn("mt-0.5 size-2.5 shrink-0 rounded-full", online ? "bg-primary" : "bg-warn")} />
          <p className={cn("text-[13px] leading-relaxed", online ? "text-primary-ink" : "text-[#95500a]")}>
            {online
              ? "ออนไลน์อยู่ — ข้อมูลจะทยอยส่งอัตโนมัติเมื่อมีสัญญาณเสถียร"
              : "ออฟไลน์ — งานทั้งหมดถูกเก็บไว้ในเครื่องแล้ว จะส่งเองเมื่อกลับมาออนไลน์"}
          </p>
        </div>

        <motion.ul variants={stagger(0.05)} initial="hidden" animate="show" className="flex flex-col gap-2.5">
          <AnimatePresence initial={false}>
            {items.map((item) => (
              <SyncRow key={item.id} item={item} onRetry={() => retry(item.id)} />
            ))}
          </AnimatePresence>
        </motion.ul>

        <Link
          href="/m/captures"
          className="mt-5 flex items-center gap-3 rounded-card border border-line bg-bg px-4 py-3.5 transition-colors hover:border-line-strong"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-chip bg-surface-2 text-muted">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden>
              <rect x="3" y="6" width="18" height="14" rx="2.5" stroke="currentColor" strokeWidth="2" />
              <circle cx="12" cy="13" r="3.5" stroke="currentColor" strokeWidth="2" />
              <path d="M8.5 6l1.2-2h4.6L15.5 6" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold">บันทึกภาพในเครื่อง</span>
            <span className="block text-[13px] text-muted">
              ภาพที่ถ่ายและอัปโหลดในรอบนี้ · ยังไม่ได้ส่งออก
            </span>
          </span>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="shrink-0 text-faint" aria-hidden>
            <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>

        <div className="mt-3 flex items-center justify-between rounded-card border border-dashed border-line-strong px-4 py-3">
          <Toggle checked={online} onChange={setOnline} label="จำลองสถานะออนไลน์" />
        </div>
      </Scroll>

      <BottomBar>
        <Button size="lg" full disabled={!online || pending + failed === 0} onClick={syncAll}>
          {pending + failed === 0 ? "ส่งข้อมูลครบแล้ว" : `ส่งทั้งหมด (${pending + failed})`}
        </Button>
      </BottomBar>
    </>
  );
}

function SyncRow({ item, onRetry }: { item: SyncItem; onRetry: () => void }) {
  const meta = {
    PENDING: { label: "รอส่ง", tone: "text-muted", bg: "bg-surface-2" },
    UPLOADING: { label: "กำลังส่ง", tone: "text-primary-ink", bg: "bg-primary-soft" },
    FAILED: { label: "ส่งไม่สำเร็จ", tone: "text-[#a52218]", bg: "bg-danger-soft" },
    DONE: { label: "ส่งสำเร็จ", tone: "text-[#07794a]", bg: "bg-ok-soft" },
  }[item.status];

  return (
    <motion.li
      variants={listItem}
      layout
      className="overflow-hidden rounded-card border border-line bg-bg shadow-[var(--shadow-card)]"
    >
      <div className="flex items-center gap-3 p-3.5">
        <span className={cn("grid size-10 shrink-0 place-items-center rounded-chip", meta.bg, meta.tone)}>
          {item.status === "UPLOADING" ? (
            <motion.span
              className="size-4 rounded-full border-2 border-current/30 border-t-current"
              animate={{ rotate: 360 }}
              transition={{ duration: 0.7, repeat: Infinity, ease: "linear" }}
            />
          ) : item.status === "DONE" ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M5 12.5l5 5L19 7" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : item.status === "FAILED" ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M12 3l9.5 16.5h-19L12 3z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              <path d="M12 9.5v4M12 16.6h.01" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
              <path d="M12 7.5v5l3 1.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          )}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold leading-snug">{item.label}</p>
          <p className="truncate text-[13px] text-muted">{item.storeName}</p>
          <p className="mt-0.5 text-[12px] text-faint">
            {KIND_LABEL[item.kind]} · <span className="tnum">{item.queuedAt}</span> ·{" "}
            <span className="tnum">
              {item.sizeKb > 1024 ? `${(item.sizeKb / 1024).toFixed(1)} MB` : `${item.sizeKb} KB`}
            </span>
          </p>
        </div>

        <span className={cn("shrink-0 rounded-pill px-2.5 py-1 text-[12px] font-medium", meta.bg, meta.tone)}>
          {meta.label}
        </span>
      </div>

      <AnimatePresence>
        {item.status === "FAILED" && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: easeOut }}
            className="overflow-hidden border-t border-line bg-danger-soft/40"
          >
            <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
              <p className="text-[12px] text-[#a52218]">
                {item.errorCode} · ลองแล้ว <span className="tnum">{item.attempts}</span> ครั้ง
              </p>
              <Button size="sm" variant="secondary" onClick={onRetry}>
                ลองใหม่
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  );
}
