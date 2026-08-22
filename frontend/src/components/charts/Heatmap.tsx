"use client";

import { motion } from "motion/react";
import { easeOut } from "@/lib/motion";

/** OOS frequency by SKU x day of week. Intensity is encoded by both
 *  fill AND the printed number, so it never relies on colour alone. */
export function Heatmap({
  rows,
  columns,
  max,
}: {
  rows: { sku: string; values: number[] }[];
  columns: string[];
  max?: number;
}) {
  const hi = max ?? Math.max(...rows.flatMap((r) => r.values), 1);

  return (
    <div className="overflow-x-auto scroll-y-thin">
      <table className="table-fixed border-separate border-spacing-[3px]">
        <thead>
          <tr>
            <th className="w-[250px] text-left text-[12px] font-medium text-muted" />
            {columns.map((c) => (
              <th key={c} className="w-[68px] pb-1 text-center text-[12px] font-medium text-muted">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={r.sku}>
              <th scope="row" className="truncate pr-3 text-left text-[13px] font-normal text-text">
                {r.sku}
              </th>
              {r.values.map((v, ci) => {
                const t = v / hi;
                return (
                  <td key={ci} className="w-[68px] p-0">
                    <motion.div
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: 0.05 + (ri * columns.length + ci) * 0.012, duration: 0.3, ease: easeOut }}
                      title={`${r.sku} · ${columns[ci]} · ขาด ${v} ครั้ง`}
                      className="tnum grid h-9 place-items-center rounded-[6px] text-[12px] font-semibold"
                      style={{
                        backgroundColor:
                          v === 0 ? "#f5f7fa" : `rgba(217, 45, 32, ${0.1 + t * 0.75})`,
                        color: t > 0.55 ? "#fff" : v === 0 ? "#98a2b3" : "#a52218",
                      }}
                    >
                      {v}
                    </motion.div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
