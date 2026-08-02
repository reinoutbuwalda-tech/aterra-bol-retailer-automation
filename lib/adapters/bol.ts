export type BolDailyRow = { date: string; ean: string; revenue: number; sales: number; visits: number; orders: number; source: string };

export function parseCsvLine(line: string): string[] {
  const fields: string[] = []; let value = ""; let quoted = false;
  for (let i = 0; i < line.length; i++) { const c = line[i]; if (c === '"') { if (quoted && line[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted; } else if (c === "," && !quoted) { fields.push(value); value = ""; } else value += c; }
  fields.push(value); return fields;
}

export function parseBolDaily(csv: string, source: string): BolDailyRow[] {
  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const header = parseCsvLine(lines[0]);
  const col = (name: string) => { const i = header.indexOf(name); if (i < 0) throw new Error(`Missing Bol column: ${name}`); return i; };
  const ix = { date: col("Datum"), ean: col("EAN"), revenue: col("Omzet"), sales: col("Verkopen"), visits: col("Bezoeken"), orders: col("Bestellingen") };
  return lines.slice(1).map(line => { const v = parseCsvLine(line); return { date: v[ix.date], ean: v[ix.ean], revenue: Number(v[ix.revenue]), sales: Number(v[ix.sales]), visits: Number(v[ix.visits]), orders: Number(v[ix.orders]), source }; });
}

export function deduplicateBolDaily(rows: BolDailyRow[]) {
  const records = new Map<string, BolDailyRow>(); const conflicts: { key: string; first: BolDailyRow; next: BolDailyRow }[] = []; let duplicates = 0;
  for (const row of rows) { const key = `${row.date}|${row.ean}`; const prior = records.get(key); if (!prior) records.set(key, row); else if (prior.revenue === row.revenue && prior.sales === row.sales && prior.visits === row.visits && prior.orders === row.orders) duplicates++; else conflicts.push({ key, first: prior, next: row }); }
  return { records: [...records.values()], duplicates, conflicts };
}

export function summarizeMay(rows: BolDailyRow[], month = "2026-05") {
  return rows.filter(r => r.date.startsWith(month)).reduce((a, r) => ({ revenue: a.revenue + r.revenue, sales: a.sales + r.sales, visits: a.visits + r.visits, orders: a.orders + r.orders, dates: a.dates.add(r.date), eans: a.eans.add(r.ean) }), { revenue: 0, sales: 0, visits: 0, orders: 0, dates: new Set<string>(), eans: new Set<string>() });
}
