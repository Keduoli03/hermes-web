export function formatUsageCount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value < 0) return "—";
  for (const [scale, suffix] of [[1e9, "B"], [1e6, "M"], [1e3, "k"]] as const) {
    if (value >= scale || (scale > 1e3 && value >= scale * 0.99995)) {
      return `${Number((value / scale).toFixed(1))}${suffix}`;
    }
  }
  return String(Math.round(value));
}

export function formatUsageCost(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value < 0) return "—";
  if (value === 0) return "$0";
  if (value < 0.01) return "<$0.01";
  if (value >= 1000) return `$${formatUsageCount(value)}`;
  return `$${value.toFixed(2)}`;
}
