"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { MobileHeader, BottomBar, Scroll } from "@/components/mobile/Chrome";
import { MapSnippet } from "@/components/mobile/MapSnippet";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Controls";
import { Pill } from "@/components/ui/Badge";
import { StateSwitcher } from "@/components/mobile/StateSwitcher";
import { getStore } from "@/lib/mock/data";
import { useDemo } from "@/lib/store";
import { fadeUp, listItem, stagger, springSnappy } from "@/lib/motion";

type View = "BEFORE" | "GPS_OFF" | "DONE";

export default function CheckInScreen() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const store = getStore(id);

  const consent = useDemo((s) => s.consent);
  const setConsent = useDemo((s) => s.setConsent);
  const checkIn = useDemo((s) => s.checkIn);
  const beginVisit = useDemo((s) => s.beginVisit);
  const storeId = useDemo((s) => s.storeId);

  const [view, setView] = useState<View>("BEFORE");
  const gpsMatch = view !== "GPS_OFF";

  useEffect(() => {
    if (storeId !== id) beginVisit(id);
  }, [id, storeId, beginVisit]);

  function start() {
    checkIn();
    setView("DONE");
    window.setTimeout(() => router.push(`/m/store/${id}/category`), 700);
  }

  return (
    <>
      <MobileHeader title="เช็คอินที่ร้าน" subtitle={store.externalCode} progress={0.12} />

      <Scroll className="px-4 pt-4 pb-6">
        <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="flex flex-col gap-4">
          <motion.div variants={listItem}>
            <h2 className="text-[20px] font-bold leading-snug">{store.name}</h2>
            <p className="mt-1 text-[14px] text-muted">{store.address}</p>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <Pill tone="neutral">{store.chain}</Pill>
              <Pill tone="neutral">ช่วงเวลา {store.visitWindow}</Pill>
              {store.photoPolicy === "RESTRICTED" && (
                <Pill tone="warn">ถ่ายภาพแบบมีเงื่อนไข</Pill>
              )}
            </div>
          </motion.div>

          <motion.div variants={listItem}>
            <MapSnippet match={gpsMatch} className="h-[160px]" />
            <motion.div
              layout
              className={[
                "mt-2.5 flex items-start gap-2.5 rounded-card px-3.5 py-3",
                gpsMatch ? "bg-ok-soft" : "bg-warn-soft",
              ].join(" ")}
            >
              <span className="mt-0.5 shrink-0">
                {gpsMatch ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-ok" aria-hidden>
                    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
                    <path d="M8 12.4l2.6 2.6L16 9.6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-warn" aria-hidden>
                    <path d="M12 3l9.5 16.5h-19L12 3z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                    <path d="M12 9.5v4M12 16.6h.01" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                  </svg>
                )}
              </span>
              <div className="min-w-0">
                <p className={`text-[14px] font-medium ${gpsMatch ? "text-[#07794a]" : "text-[#b45f04]"}`}>
                  {gpsMatch ? "อยู่ในพื้นที่ร้าน" : "อยู่ห่างจากร้าน 340 ม."}
                </p>
                <p className={`mt-0.5 text-[13px] leading-relaxed ${gpsMatch ? "text-[#0a6b45]" : "text-[#95500a]"}`}>
                  {gpsMatch
                    ? "ระยะห่างจากพิกัดร้าน 18 ม. · ความแม่นยำ ±12 ม."
                    : "ยังเช็คอินได้ตามปกติ ระบบจะบันทึกไว้ในหลักฐานว่าพิกัดไม่ตรงเท่านั้น"}
                </p>
              </div>
            </motion.div>
          </motion.div>

          {store.photoPolicy === "RESTRICTED" && (
            <motion.div variants={listItem} className="rounded-card border border-warn/30 bg-warn-soft/50 px-3.5 py-3">
              <p className="text-[13px] leading-relaxed text-[#95500a]">
                <strong className="font-semibold">ข้อกำหนดของร้านนี้:</strong>{" "}
                ถ่ายได้เฉพาะชั้นวางสินค้าของเรา ห้ามถ่ายบริเวณเคาน์เตอร์แคชเชียร์และพื้นที่หลังร้าน
              </p>
            </motion.div>
          )}

          <motion.div variants={listItem}>
            <Checkbox
              id="consent"
              checked={consent}
              onChange={setConsent}
              label="ได้รับอนุญาตจากร้านให้ถ่ายภาพแล้ว"
              hint="ต้องขออนุญาตผู้ดูแลร้านทุกครั้งก่อนเปิดกล้อง — ระบบจะบันทึกการยืนยันนี้ไว้เป็นหลักฐาน"
            />
            <AnimatePresence>
              {!consent && (
                <motion.p
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden pt-2 text-[13px] text-muted"
                >
                  กล้องจะเปิดไม่ได้จนกว่าจะติ๊กช่องนี้
                </motion.p>
              )}
            </AnimatePresence>
          </motion.div>

          <motion.div variants={listItem}>
            <StateSwitcher
              value={view}
              onChange={(v) => setView(v)}
              options={[
                { value: "BEFORE", label: "ก่อนเช็คอิน" },
                { value: "GPS_OFF", label: "GPS ไม่ตรง" },
                { value: "DONE", label: "เช็คอินแล้ว" },
              ]}
            />
          </motion.div>
        </motion.div>
      </Scroll>

      <BottomBar>
        <AnimatePresence mode="wait">
          {view === "DONE" ? (
            <motion.div
              key="done"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={springSnappy}
              className="flex h-14 items-center justify-center gap-2 rounded-btn bg-ok-soft text-[15px] font-semibold text-[#07794a]"
            >
              <motion.svg
                width="20" height="20" viewBox="0 0 24 24" fill="none"
                initial={{ scale: 0.5 }} animate={{ scale: 1 }} transition={springSnappy}
              >
                <circle cx="12" cy="12" r="10" fill="#12b76a" />
                <path d="M7.5 12.4l3 3 6-6.4" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              </motion.svg>
              เช็คอินเรียบร้อย · 09:04 น.
            </motion.div>
          ) : (
            <motion.div key="cta" variants={fadeUp} initial="hidden" animate="show">
              <Button size="lg" full disabled={!consent} onClick={start}>
                เริ่มตรวจชั้นวาง
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </BottomBar>
    </>
  );
}
