const STAT_TONES = {
  positive: "bg-emerald-50 text-emerald-600",
  negative: "bg-rose-50 text-rose-600",
  usd: "bg-amber-50 text-amber-600",
  neutral: "bg-accent text-primary",
} as const;

// Balance now lives in its own hero panel above this row, so every stat
// here is a secondary/flat tile — borderless, just icon + text, per the v3
// mockup (no card around secondary stats).
export function StatCard({ label, value, sub, icon: Icon, tone = "neutral" }: {
  label: string; value: string; sub?: string; icon: React.ElementType; tone?: keyof typeof STAT_TONES;
}) {
  return (
    // `flex-1` so a handful of tiles spreads across the row, `min-w` so they
    // stop shrinking and start scrolling instead of squashing once there are
    // too many — or on a phone, where three already don't fit.
    <div className="p-3 md:p-5 flex items-center gap-3 flex-1 shrink-0 min-w-[170px]">
      <div className={`p-2 md:p-3 rounded-xl shrink-0 ${STAT_TONES[tone]}`}>
        <Icon className="w-4 h-4 md:w-5 md:h-5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm md:text-base font-bold text-foreground break-words">{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}
