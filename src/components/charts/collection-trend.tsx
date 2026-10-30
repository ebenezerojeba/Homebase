import { formatKobo } from "@/lib/money";

/**
 * Month-by-month confirmed rent collected. Real data only; bars are proportional to the largest month.
 * A visually-hidden table carries the same numbers for screen readers.
 */
export function CollectionTrend({ months }: { months: { month: string; collectedKobo: number }[] }) {
  const max = Math.max(...months.map((m) => m.collectedKobo), 1);
  const fmt = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-NG", { month: "short", timeZone: "UTC" });
  const hasData = months.some((m) => m.collectedKobo > 0);
  return (
    <figure>
      {hasData ? (
        <div className="flex h-40 items-end gap-1.5 sm:gap-2" aria-hidden="true">
          {months.map((m) => {
            const h = Math.round((m.collectedKobo / max) * 100);
            return (
              <div key={m.month} className="group flex h-full flex-1 flex-col items-center justify-end gap-1.5">
                <div className="relative w-full flex-1">
                  <div
                    className="absolute inset-x-0 bottom-0 rounded-t-md bg-emerald-600/85 transition-colors group-hover:bg-emerald-700"
                    style={{ height: `${Math.max(h, m.collectedKobo > 0 ? 3 : 0)}%` }}
                    title={`${fmt(m.month)}: ${formatKobo(m.collectedKobo)}`}
                  />
                  {m.collectedKobo === 0 ? <div className="absolute inset-x-0 bottom-0 h-px bg-cream-300" /> : null}
                </div>
                <span className="text-[10px] text-ink-500 sm:text-xs">{fmt(m.month)}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="py-10 text-center text-sm text-ink-500">No confirmed rent in the last 12 months yet.</p>
      )}
      <figcaption className="sr-only">Confirmed rent collected per month for the last 12 months</figcaption>
      <table className="sr-only">
        <thead><tr><th>Month</th><th>Confirmed rent collected</th></tr></thead>
        <tbody>
          {months.map((m) => (
            <tr key={m.month}><td>{m.month}</td><td>{formatKobo(m.collectedKobo)}</td></tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
