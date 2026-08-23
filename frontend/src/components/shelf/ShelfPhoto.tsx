import { IMAGE_H, IMAGE_W, ROWS, SLOTS, type Slot } from "@/lib/mock/shelf";
import { cn } from "@/lib/cn";

/* A stand-in for the camera frame, drawn in the same 1920x1080 space the
   inference contract uses. Because the shelf and the detection boxes come
   from one array, a box can never point at the wrong thing. */

function facingWidth(shape: Slot["shape"]) {
  switch (shape) {
    case "can": return 66;
    case "box": return 86;
    case "jar": return 92;
    case "pouch": return 120;
  }
}

function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `rgb(${r},${g},${b})`;
}

function Facing({ s, x, w, h, y }: { s: Slot; x: number; w: number; h: number; y: number }) {
  const bodyTop = shade(s.body, 26);
  const bodySide = shade(s.body, -30);
  const inset = Math.max(2, w * 0.05);
  const bw = w - inset * 2;
  const bx = x + inset;

  if (s.shape === "can" || s.shape === "jar") {
    const capH = s.shape === "jar" ? h * 0.13 : h * 0.07;
    return (
      <g>
        <rect x={bx} y={y + capH} width={bw} height={h - capH} rx={bw * 0.14} fill={s.body} />
        <rect x={bx} y={y + capH} width={bw * 0.26} height={h - capH} rx={bw * 0.12} fill={bodyTop} opacity={0.5} />
        <rect x={bx + bw * 0.82} y={y + capH} width={bw * 0.18} height={h - capH} rx={bw * 0.1} fill={bodySide} opacity={0.55} />
        <rect x={bx + bw * 0.06} y={y + h * 0.42} width={bw * 0.88} height={h * 0.2} rx={4} fill={s.band} opacity={0.9} />
        <rect x={bx + bw * 0.12} y={y} width={bw * 0.76} height={capH * 1.5} rx={capH * 0.5} fill={s.cap} />
      </g>
    );
  }

  if (s.shape === "pouch") {
    return (
      <g>
        <path
          d={`M${bx} ${y + h * 0.1} q0 ${-h * 0.1} ${bw * 0.12} ${-h * 0.1} h${bw * 0.76} q${bw * 0.12} 0 ${bw * 0.12} ${h * 0.1} v${h * 0.9} h${-bw} z`}
          fill={s.body}
        />
        <rect x={bx} y={y} width={bw * 0.22} height={h} fill={bodyTop} opacity={0.35} />
        <rect x={bx + bw * 0.1} y={y + h * 0.34} width={bw * 0.8} height={h * 0.26} rx={5} fill={s.band} opacity={0.88} />
        <rect x={bx + bw * 0.32} y={y - 4} width={bw * 0.36} height={10} rx={4} fill={s.cap} />
      </g>
    );
  }

  // box
  return (
    <g>
      <rect x={bx} y={y} width={bw} height={h} rx={5} fill={s.body} />
      <rect x={bx} y={y} width={bw} height={h * 0.09} fill={bodyTop} opacity={0.7} />
      <rect x={bx} y={y} width={bw * 0.2} height={h} fill={bodyTop} opacity={0.28} />
      <rect x={bx + bw * 0.78} y={y} width={bw * 0.22} height={h} fill={bodySide} opacity={0.4} />
      <rect x={bx + bw * 0.1} y={y + h * 0.3} width={bw * 0.8} height={h * 0.3} rx={4} fill={s.band} opacity={0.92} />
      <rect x={bx + bw * 0.2} y={y + h * 0.68} width={bw * 0.6} height={h * 0.08} rx={3} fill={s.band} opacity={0.5} />
    </g>
  );
}

function SlotGraphic({ s }: { s: Slot }) {
  const row = ROWS[s.row];
  const top = row.board - row.height;
  const fw = facingWidth(s.shape);
  const gap = 4;
  const count = Math.max(1, Math.round(s.w / fw));
  const each = (s.w - gap * (count - 1)) / count;

  if (s.kind === "GAP") {
    return (
      <g>
        {/* the empty back panel reads darker than the products in front of it */}
        <rect x={s.x} y={top} width={s.w} height={row.height} fill="#2b3038" opacity={0.55} />
        <rect x={s.x} y={row.board - 22} width={s.w} height={22} fill="#1c2026" opacity={0.5} />
      </g>
    );
  }

  return (
    <g>
      {Array.from({ length: count }).map((_, i) => {
        const h = row.height * (0.86 + ((i * 7) % 3) * 0.045);
        const x = s.x + i * (each + gap);
        return <Facing key={i} s={s} x={x} w={each} h={h} y={row.board - h} />;
      })}
    </g>
  );
}

export function ShelfPhoto({
  slots = SLOTS,
  className,
  showPeople = true,
  blurFaces = true,
  fit = "cover",
}: {
  slots?: Slot[];
  className?: string;
  showPeople?: boolean;
  blurFaces?: boolean;
  /** "cover" crops to fill (thumbnails); "contain" shows the whole frame
   *  so no detection can fall outside the visible area. */
  fit?: "cover" | "contain";
}) {
  return (
    <svg
      viewBox={`0 0 ${IMAGE_W} ${IMAGE_H}`}
      className={cn("block h-full w-full", className)}
      preserveAspectRatio={fit === "cover" ? "xMidYMid slice" : "xMidYMid meet"}
      role="img"
      aria-label="ภาพชั้นวางสินค้าหมวดกาแฟ ถ่ายจากกล้องมือถือ"
    >
      <defs>
        <linearGradient id="sp-back" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3d444f" />
          <stop offset="100%" stopColor="#272c34" />
        </linearGradient>
        <radialGradient id="sp-vig" cx="50%" cy="42%" r="72%">
          <stop offset="55%" stopColor="#000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.42" />
        </radialGradient>
        <filter id="sp-blur">
          <feGaussianBlur stdDeviation="16" />
        </filter>
        <filter id="sp-grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
      </defs>

      {/* gondola back panel */}
      <rect width={IMAGE_W} height={IMAGE_H} fill="url(#sp-back)" />
      {Array.from({ length: 26 }).map((_, i) => (
        <rect key={i} x={40 + i * 72} y={0} width={2} height={IMAGE_H} fill="#000" opacity={0.06} />
      ))}

      {/* category signage strip above the top shelf */}
      <rect x={0} y={54} width={IMAGE_W} height={78} fill="#1b6fe8" opacity={0.82} />
      <rect x={64} y={74} width={230} height={38} rx={6} fill="#fff" opacity={0.9} />
      <rect x={318} y={80} width={120} height={26} rx={5} fill="#fff" opacity={0.45} />

      {showPeople && (
        <g opacity={0.9}>
          {/* a shopper caught at the edge of frame — the reason face blur exists */}
          <ellipse cx={1836} cy={512} rx={96} ry={132} fill="#3a4250" />
          <circle cx={1840} cy={352} r={62} fill="#8a7466" filter={blurFaces ? "url(#sp-blur)" : undefined} />
        </g>
      )}

      {/* products */}
      {slots.map((s) => (
        <SlotGraphic key={s.id} s={s} />
      ))}

      {/* shelf boards + price rails */}
      {ROWS.map((row, i) => (
        <g key={i}>
          <rect x={0} y={row.board} width={IMAGE_W} height={16} fill="#cdd3da" />
          <rect x={0} y={row.board + 16} width={IMAGE_W} height={20} fill="#9aa3ae" />
          <rect x={0} y={row.board + 36} width={IMAGE_W} height={8} fill="#000" opacity={0.16} />
          {[180, 760, 1340].map((x) => (
            <g key={x}>
              <rect x={x} y={row.board + 4} width={132} height={26} rx={3} fill="#fdfdfd" />
              <rect x={x + 8} y={row.board + 10} width={72} height={7} rx={3} fill="#98a2b3" />
              <rect x={x + 8} y={row.board + 20} width={44} height={5} rx={2} fill="#c3cad3" />
            </g>
          ))}
        </g>
      ))}

      {/* floor */}
      <rect x={0} y={IMAGE_H - 84} width={IMAGE_W} height={84} fill="#6f7681" />
      <rect x={0} y={IMAGE_H - 84} width={IMAGE_W} height={10} fill="#000" opacity={0.2} />

      {/* photographic treatment: ceiling light falloff, vignette, film grain */}
      <rect x={0} y={0} width={IMAGE_W} height={260} fill="#fff" opacity={0.06} />
      <rect width={IMAGE_W} height={IMAGE_H} fill="url(#sp-vig)" />
      <rect width={IMAGE_W} height={IMAGE_H} filter="url(#sp-grain)" opacity={0.05} />
    </svg>
  );
}
