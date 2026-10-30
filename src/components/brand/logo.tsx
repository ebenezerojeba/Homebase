import { cn } from "@/lib/cn";
import { APP_NAME } from "@/lib/brand";

/** Brand palette (from the Homebase identity sheet). */
export const BRAND = {
  navy: "#0B1F3A", // Harbour Navy
  teal: "#12A58B", // Keystone Teal
  tealBright: "#2DD4AF", // teal for dark backgrounds
  mist: "#F4F6F5", // Mist
} as const;

/**
 * The two "wall" halves of the mark, traced from the identity artwork on a 321 × 303 grid.
 * Corners are softened with a round stroke join in the same colour, matching the artwork's radius.
 */
export const MARK_LEFT = "M144 7 L6 119 L6 296 L57 262 L103 262 L103 199 L144 160 Z";
export const MARK_RIGHT = "M177 7 L315 119 L315 296 L264 262 L218 262 L218 199 L177 160 Z";
export const MARK_VIEWBOX = "-4 -4 329 311";
const STROKE = 10;

export type MarkTone = "color" | "onDark" | "mono" | "white";

const TONES: Record<MarkTone, [string, string]> = {
  color: [BRAND.navy, BRAND.teal],
  onDark: ["#FFFFFF", BRAND.tealBright],
  mono: ["#000000", "#000000"],
  white: ["#FFFFFF", "#FFFFFF"],
};

export function LogoMark({ tone = "color", className, title }: { tone?: MarkTone; className?: string; title?: string }) {
  const [left, right] = TONES[tone];
  return (
    <svg viewBox={MARK_VIEWBOX} className={cn("h-7 w-auto shrink-0", className)} role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <path d={MARK_LEFT} fill={left} stroke={left} strokeWidth={STROKE} strokeLinejoin="round" />
      <path d={MARK_RIGHT} fill={right} stroke={right} strokeWidth={STROKE} strokeLinejoin="round" />
    </svg>
  );
}

/** Rounded-square app icon: navy tile with the light mark (or teal tile, used on navy backgrounds). */
export function AppIcon({ variant = "navy", className }: { variant?: "navy" | "teal" | "light"; className?: string }) {
  const bg = variant === "navy" ? BRAND.navy : variant === "teal" ? BRAND.teal : BRAND.mist;
  const [left, right] = variant === "navy" ? ["#FFFFFF", BRAND.tealBright] : variant === "teal" ? [BRAND.navy, "#FFFFFF"] : [BRAND.navy, BRAND.teal];
  return (
    <svg viewBox="0 0 600 600" className={cn("size-9 shrink-0", className)} aria-hidden>
      <rect width="600" height="600" rx="150" fill={bg} />
      <g transform="translate(140 152) scale(1)">
        <path d={MARK_LEFT} fill={left} stroke={left} strokeWidth={STROKE} strokeLinejoin="round" />
        <path d={MARK_RIGHT} fill={right} stroke={right} strokeWidth={STROKE} strokeLinejoin="round" />
      </g>
    </svg>
  );
}

/**
 * Horizontal lockup. "regular" follows the navbar spec (mark ≈ 1.15× the wordmark cap height,
 * gap ≈ ⅓ of the mark); "compact" is the heavier 800-weight version for 24–32 px mobile headers.
 */
export function Logo({
  tone = "color",
  size = "md",
  compact = false,
  className,
}: {
  tone?: MarkTone;
  size?: "sm" | "md" | "lg" | "xl";
  compact?: boolean;
  className?: string;
}) {
  const sizes = {
    sm: { text: "text-lg", mark: "h-[1.15rem]", gap: "gap-1.5" },
    md: { text: "text-[1.375rem]", mark: "h-[1.4rem]", gap: "gap-2" },
    lg: { text: "text-3xl", mark: "h-[1.95rem]", gap: "gap-2.5" },
    xl: { text: "text-5xl", mark: "h-[3.1rem]", gap: "gap-4" },
  }[size];
  const textColor = tone === "color" ? "text-ink-900" : tone === "mono" ? "text-black" : "text-white";
  return (
    <span className={cn("inline-flex items-center", compact ? "gap-1.5" : sizes.gap, className)}>
      <LogoMark tone={tone} className={cn(sizes.mark, "relative -top-px")} />
      <span className={cn("leading-none tracking-[-0.035em] lowercase", sizes.text, compact ? "font-extrabold" : "font-bold", textColor)}>{APP_NAME.toLowerCase()}</span>
    </span>
  );
}

/** Stacked lockup (mark above wordmark) for hero and auth screens. */
export function LogoStacked({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex flex-col items-center gap-3", className)}>
      <LogoMark className="h-14" title={APP_NAME} />
      <span className="text-3xl font-bold lowercase leading-none tracking-[-0.035em] text-ink-900" aria-hidden>
        {APP_NAME.toLowerCase()}
      </span>
    </span>
  );
}
