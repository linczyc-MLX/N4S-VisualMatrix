export function formatMoney(amount: number, currency: string) {
  const safe = Number.isFinite(amount) ? amount : 0;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(safe);
}

export function formatPct(p: number) {
  const safe = Number.isFinite(p) ? p : 0;
  return `${(safe * 100).toFixed(1)}%`;
}
