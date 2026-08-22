"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { Logo } from "@/components/ui/Logo";
import { ShelfPhoto } from "@/components/shelf/ShelfPhoto";
import { listItem, stagger, fadeUp, springSoft } from "@/lib/motion";

const SURFACES = [
  {
    href: "/m/login" as const,
    eyebrow: "Mobile Web",
    title: "แอปพนักงานภาคสนาม",
    body: "ถ่ายภาพชั้นวาง รู้ผล OSA ภายใน 10 วินาที ยืนยันผลทีละจุด แล้วปิดงานหน้าชั้นวางได้ทันที",
    screens: "13 หน้าจอ · S1–S13",
    accent: "#1b6fe8",
  },
  {
    href: "/w" as const,
    eyebrow: "Desktop Web",
    title: "แดชบอร์ดผู้จัดการและทีมข้อมูล",
    body: "ดู OSA รายพื้นที่ ร้านที่ต้องเข้าดูแลก่อน หลักฐานภาพย้อนหลัง วางแผนเส้นทาง และสุขภาพของโมเดล",
    screens: "6 หน้าจอ · W1–W6",
    accent: "#12b76a",
  },
];

export default function PlatformLauncher() {
  return (
    <div className="min-h-dvh bg-[#0a0e14] px-6 py-14 text-[#f2f5f9]">
      <div className="mx-auto w-full max-w-[980px]">
        <motion.header variants={fadeUp} initial="hidden" animate="show">
          <div className="flex items-center gap-3">
            <Logo size={40} />
            <span className="text-[19px] font-bold tracking-tight">
              Shelf<span className="text-[#5b9bf5]">Eye</span>
            </span>
            <span className="ml-1 rounded-pill bg-white/10 px-2.5 py-1 text-[12px] font-medium text-[#93a0b3]">
              โหมดสาธิต · ยังไม่ต่อ API
            </span>
          </div>
          <h1 className="mt-8 max-w-[620px] text-[38px] font-bold leading-[1.2] tracking-tight sm:text-[46px]">
            ตรวจช่องว่างบนชั้นวางด้วยกล้องมือถือ
            <span className="block text-[#93a0b3]">แล้วแก้ให้เสร็จก่อนเดินออกจากร้าน</span>
          </h1>
          <p className="mt-4 max-w-[560px] text-[16px] leading-relaxed text-[#93a0b3]">
            เลือกแพลตฟอร์มที่ต้องการดู ทั้งสองฝั่งใช้ดีไซน์โทเคนชุดเดียวกัน
            และข้อความทั้งหมดเป็นภาษาไทย
          </p>
        </motion.header>

        <motion.ul
          variants={stagger(0.09, 0.18)}
          initial="hidden"
          animate="show"
          className="mt-12 grid gap-5 md:grid-cols-2"
        >
          {SURFACES.map((s) => (
            <motion.li key={s.href} variants={listItem}>
              <motion.div whileHover={{ y: -4 }} transition={springSoft} className="h-full">
                <Link
                  href={s.href}
                  className="group flex h-full flex-col overflow-hidden rounded-card border border-white/10 bg-[#131922] transition-colors hover:border-white/25"
                >
                  <div className="relative h-[168px] overflow-hidden border-b border-white/10 bg-[#0a0e14]">
                    {s.href === "/m/login" ? <MobilePreview /> : <WebPreview />}
                  </div>
                  <div className="flex flex-1 flex-col p-5">
                    <span
                      className="text-[12px] font-semibold uppercase tracking-[0.12em]"
                      style={{ color: s.accent }}
                    >
                      {s.eyebrow}
                    </span>
                    <h2 className="mt-2 text-[20px] font-semibold leading-snug">{s.title}</h2>
                    <p className="mt-2 flex-1 text-[14px] leading-relaxed text-[#93a0b3]">{s.body}</p>
                    <div className="mt-5 flex items-center justify-between border-t border-white/10 pt-4">
                      <span className="text-[13px] text-[#6b7a8d]">{s.screens}</span>
                      <span className="flex items-center gap-1.5 text-[14px] font-medium">
                        เปิดดู
                        <motion.svg
                          width="18" height="18" viewBox="0 0 24 24" fill="none"
                          className="transition-transform duration-200 group-hover:translate-x-1"
                        >
                          <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </motion.svg>
                      </span>
                    </div>
                  </div>
                </Link>
              </motion.div>
            </motion.li>
          ))}
        </motion.ul>

        <motion.div
          variants={fadeUp}
          initial="hidden"
          animate="show"
          transition={{ delay: 0.4 }}
          className="mt-12 rounded-card border border-white/10 bg-[#131922] p-5"
        >
          <h3 className="text-[14px] font-semibold">ข้อกำหนดที่บังคับผ่าน UI</h3>
          <ul className="mt-3 grid gap-2 text-[13px] leading-relaxed text-[#93a0b3] sm:grid-cols-2">
            {[
              "เปิดกล้องไม่ได้จนกว่าจะติ๊กว่าได้รับอนุญาตจากร้าน",
              "ยืนยันเบลอใบหน้าบนเครื่องก่อนอัปโหลดทุกครั้ง",
              "ปุ่ม “ไม่ใช่” มีน้ำหนักเท่ากับปุ่ม “ใช่” เสมอ",
              "ไม่มีคะแนนหรืออันดับรายบุคคลของพนักงานในทุกหน้าจอ",
              "ทุกตัวเลขกดเข้าไปดูภาพหลักฐานได้",
              "ไม่มีปุ่มที่ให้ระบบติดต่อร้านค้าโดยอัตโนมัติ",
            ].map((t) => (
              <li key={t} className="flex items-start gap-2">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" className="mt-1 shrink-0 text-[#12b76a]" aria-hidden>
                  <path d="M5 12.5l5 5L19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {t}
              </li>
            ))}
          </ul>
        </motion.div>
      </div>
    </div>
  );
}

function MobilePreview() {
  return (
    <div className="absolute inset-0 flex items-end justify-center">
      <div className="h-[150px] w-[112px] overflow-hidden rounded-t-[16px] border-[3px] border-b-0 border-[#2b3543] bg-[#0a0e14]">
        <div className="h-[62px] overflow-hidden">
          <ShelfPhoto showPeople={false} />
        </div>
        <div className="space-y-1.5 p-2">
          <div className="h-2 w-3/4 rounded-full bg-[#2b3543]" />
          <div className="h-6 rounded bg-[#1d2531]" />
          <div className="flex gap-1">
            <div className="h-5 flex-1 rounded bg-[#d92d20]/70" />
            <div className="h-5 flex-1 rounded bg-[#f79009]/60" />
          </div>
          <div className="h-6 rounded bg-[#1b6fe8]" />
        </div>
      </div>
    </div>
  );
}

function WebPreview() {
  const bars = [42, 58, 51, 66, 74, 62, 81, 88];
  return (
    <div className="absolute inset-0 flex items-end justify-center px-6 pb-0">
      <div className="w-full max-w-[280px] overflow-hidden rounded-t-[10px] border border-b-0 border-[#2b3543] bg-[#0f151d] p-3">
        <div className="flex gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-7 flex-1 rounded bg-[#1d2531]" />
          ))}
        </div>
        <div className="mt-2 flex h-[78px] items-end gap-1.5 rounded bg-[#131922] p-2">
          {bars.map((h, i) => (
            <motion.div
              key={i}
              className="flex-1 rounded-t-[2px] bg-[#12b76a]"
              initial={{ height: 0 }}
              animate={{ height: `${h}%` }}
              transition={{ delay: 0.3 + i * 0.05, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
