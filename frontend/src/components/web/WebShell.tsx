"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Logo } from "@/components/ui/Logo";
import { useSession } from "@/components/auth/AuthGate";
import { fetchAreas, type Area } from "@/lib/api/analytics";
import { useResource } from "@/lib/api/useResource";
import { springSoft } from "@/lib/motion";
import { cn } from "@/lib/cn";

/* The area picker lives in the shell, and every screen under it reports on
   whichever area is selected. Passing it through context rather than a query
   param keeps the pages from each inventing their own default. */

interface AreaSelection {
  /** undefined means "all areas" — the API treats a missing areaId that way */
  areaId: string | undefined;
  areaName: string;
  areas: Area[];
  setAreaId: (id: string | undefined) => void;
}

const AreaContext = createContext<AreaSelection>({
  areaId: undefined,
  areaName: "ทุกพื้นที่",
  areas: [],
  setAreaId: () => {},
});

export function useArea(): AreaSelection {
  return useContext(AreaContext);
}

const NAV = [
  { href: "/w", label: "ภาพรวมพื้นที่", code: "W1", icon: GridIcon },
  { href: "/w/routes", label: "วางแผนเส้นทาง", code: "W4", icon: RouteIcon },
  { href: "/w/model-health", label: "สุขภาพของโมเดล", code: "W5", icon: PulseIcon },
  { href: "/w/relabel", label: "คิวตรวจภาพ", code: "W6", icon: LayersIcon },
] as const;

export function WebShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user } = useSession();
  const areasResource = useResource(() => fetchAreas(), []);
  const areas = useMemo(() => areasResource.data ?? [], [areasResource.data]);
  const [areaId, setAreaId] = useState<string | undefined>(undefined);

  // Default to the manager's own area once it is known, rather than to
  // whichever area happens to sort first.
  useEffect(() => {
    if (areaId || areas.length === 0) return;
    const own = user?.areaId && areas.some((a) => a.id === user.areaId) ? user.areaId : areas[0].id;
    setAreaId(own);
  }, [areas, areaId, user?.areaId]);

  const selection: AreaSelection = {
    areaId,
    areaName: areas.find((a) => a.id === areaId)?.name ?? "ทุกพื้นที่",
    areas,
    setAreaId,
  };

  return (
    <AreaContext.Provider value={selection}>
    <div className="min-h-dvh bg-surface lg:grid lg:grid-cols-[248px_1fr]">
      {/* ---------- sidebar ---------- */}
      <aside className="sticky top-0 z-40 border-b border-line bg-bg lg:h-dvh lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-2.5 px-5 py-4">
          <Logo size={32} />
          <span className="text-[16px] font-bold tracking-tight">
            Shelf<span className="text-primary">Eye</span>
          </span>
          <span className="ml-auto rounded-pill bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted lg:ml-0">
            demo
          </span>
        </div>

        <nav className="scroll-x flex gap-1 px-3 pb-3 lg:flex-col lg:pb-0">
          {NAV.map((item) => {
            const active =
              item.href === "/w" ? pathname === "/w" || pathname.startsWith("/w/stores") : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-11 shrink-0 items-center gap-2.5 rounded-btn px-3 text-[14px] font-medium transition-colors",
                  active ? "text-primary-ink" : "text-muted hover:bg-surface hover:text-text",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="nav-active"
                    className="absolute inset-0 rounded-btn bg-primary-soft"
                    transition={springSoft}
                  />
                )}
                <span className="relative"><Icon /></span>
                <span className="relative whitespace-nowrap">{item.label}</span>
                <span className="relative ml-auto hidden text-[11px] font-semibold text-faint lg:block">
                  {item.code}
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="hidden lg:mt-auto lg:block lg:px-3 lg:pb-4">
          <div className="mt-6 rounded-card border border-line bg-surface p-3.5">
            <p className="text-[12px] font-medium text-muted">พื้นที่รับผิดชอบ</p>
            <label className="sr-only" htmlFor="area">เลือกพื้นที่</label>
            <select
              id="area"
              value={areaId ?? ""}
              onChange={(e) => setAreaId(e.target.value || undefined)}
              className="mt-1.5 h-9 w-full rounded-inset border border-line-strong bg-bg px-2 text-[13px] outline-none focus:border-primary"
            >
              <option value="">ทุกพื้นที่</option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.storeCount})
                </option>
              ))}
            </select>
            <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary-soft text-[12px] font-semibold text-primary-ink">
                {user?.fullName.slice(0, 1) ?? "?"}
              </span>
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium">{user?.fullName ?? "—"}</p>
                <p className="truncate text-[12px] text-muted">{ROLE_LABELS[user?.role ?? ""] ?? ""}</p>
              </div>
            </div>
          </div>
          <Link
            href="/"
            className="mt-3 block px-1 text-[12px] text-faint underline-offset-4 hover:text-muted hover:underline"
          >
            กลับหน้าเลือกแพลตฟอร์ม
          </Link>
        </div>
      </aside>

      <div className="min-w-0">{children}</div>
      </div>
    </AreaContext.Provider>
  );
}

const ROLE_LABELS: Record<string, string> = {
  REP: "พนักงานภาคสนาม",
  MANAGER: "ผู้จัดการพื้นที่",
  ADMIN: "ผู้ดูแลระบบ",
  DATA: "ทีมข้อมูล",
};

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <header className="border-b border-line bg-bg px-6 py-5 lg:px-8">
      {back && (
        <Link
          href={back.href}
          className="mb-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted transition-colors hover:text-text"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M15 19l-7-7 7-7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-bold leading-tight tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-[14px] text-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

function GridIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.6" stroke="currentColor" strokeWidth="2" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6" stroke="currentColor" strokeWidth="2" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6" stroke="currentColor" strokeWidth="2" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
function RouteIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="6" cy="5.5" r="2.5" stroke="currentColor" strokeWidth="2" />
      <circle cx="18" cy="18.5" r="2.5" stroke="currentColor" strokeWidth="2" />
      <path d="M6 8v4a4 4 0 004 4h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function PulseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M3 12h3.5l2.5-6 4 12 2.5-6H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function LayersIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 3l9 5-9 5-9-5 9-5z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M3 13l9 5 9-5" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}
