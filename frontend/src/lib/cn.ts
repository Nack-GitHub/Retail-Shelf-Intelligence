export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export const thb = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 1 });

export function pct(n: number, digits = 0) {
  return `${n.toFixed(digits)}%`;
}

export function minutes(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
