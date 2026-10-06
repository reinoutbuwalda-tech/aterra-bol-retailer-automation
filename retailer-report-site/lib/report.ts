import { PRODUCT_NAMES } from "./config";

export type ReportPayload = {
  revision: Record<string, unknown>;
  summary: Record<string, unknown>;
  products: Array<Record<string, unknown>>;
  dataProducts: Array<Record<string, unknown>>;
  exceptions: Array<Record<string, unknown>>;
  ranks: Array<Record<string, unknown>>;
};

const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character);
const number = (value: unknown) => Number(value || 0);
const euro = (value: unknown) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(number(value));
const integer = (value: unknown) => new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 }).format(number(value));
const percent = (value: unknown) => value === null || value === undefined ? "Niet beschikbaar" : `${new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(number(value) * 100)}%`;

function statusLabel(status: unknown) {
  if (status === "ready") return "Gereed";
  if (status === "ready_with_limits") return "Gereed met beperkingen";
  if (status === "not_applicable") return "Niet van toepassing";
  return "Niet gereed";
}

export function renderReport(payload: ReportPayload) {
  const revision = payload.revision || {};
  const summary = payload.summary || {};
  const year = Number(revision.iso_year);
  const week = Number(revision.iso_week);
  const reportStatus = String(revision.status || "not_ready");
  const limitations = [...new Set(payload.products.flatMap(product => Array.isArray(product.limitations) ? product.limitations.map(String) : []))];
  const ranksByEan = new Map<string, Array<Record<string, unknown>>>();
  for (const rank of payload.ranks || []) {
    const ean = String(rank.ean || "");
    ranksByEan.set(ean, [...(ranksByEan.get(ean) || []), rank]);
  }
  const productRows = payload.products.map(product => {
    const ean = String(product.ean || "");
    const ranks = ranksByEan.get(ean) || [];
    const sponsored = ranks.filter(rank => rank.was_sponsored === true).sort((a, b) => number(b.impressions) - number(a.impressions))[0];
    const organic = ranks.filter(rank => rank.was_sponsored !== true).sort((a, b) => number(b.impressions) - number(a.impressions))[0];
    return `<tr><td><strong>${esc(PRODUCT_NAMES[ean] || product.product_id || ean)}</strong><span class="sub">${esc(ean)}</span></td><td>${euro(product.provisional_net_gms)}</td><td>${integer(product.gross_shipped_units)}</td><td>${product.gross_shipped_asp === null ? "-" : euro(product.gross_shipped_asp)}</td><td>${percent(product.trading_units_per_visit)}</td><td>${product.product_visits === null ? "-" : integer(product.product_visits)}</td><td>${euro(product.provisional_revenue_after_commission)}</td><td>${integer(product.registered_return_units)}</td><td>${sponsored ? `${number(sponsored.weekly_rank).toFixed(1)}<span class="sub">${esc(sponsored.search_term)}</span>` : "Niet waargenomen"}</td><td>${organic ? `${number(organic.weekly_rank).toFixed(1)}<span class="sub">${esc(organic.search_term)}</span>` : "Niet waargenomen"}</td></tr>`;
  }).join("");
  const rankRows = payload.ranks.map(rank => `<tr><td>${esc(PRODUCT_NAMES[String(rank.ean)] || rank.ean)}</td><td>${esc(rank.search_term)}</td><td>${esc(rank.locale)}</td><td>${rank.was_sponsored ? "Gesponsord" : "Organisch"}</td><td>${number(rank.weekly_rank).toFixed(1)}</td><td>${integer(rank.best_rank)}</td><td>${integer(rank.worst_rank)}</td><td>${integer(rank.impressions)}</td><td>${integer(rank.days_observed)}/7</td></tr>`).join("");
  const qualityRows = payload.dataProducts.map(item => `<tr><td>${esc(item.data_product)}</td><td><span class="status ${esc(item.data_product_status)}">${esc(statusLabel(item.data_product_status))}</span></td><td>${esc((item.limitations as string[] || []).join(" ") || "Geen")}</td></tr>`).join("");
  const exceptionRows = payload.exceptions.length ? payload.exceptions.map(item => `<li><strong>${esc(item.title || item.exception_code)}</strong> ${esc(item.detail || "")}</li>`).join("") : "<li>Geen open uitzonderingen voor deze rapportrevisie.</li>";
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Aterra Bol Retailer ${year}-W${String(week).padStart(2, "0")}</title><style>
:root{--ink:#17211c;--muted:#607069;--line:#d9e2dc;--paper:#f5f7f5;--white:#fff;--green:#176b4d;--lime:#dff2e8;--amber:#8a5a00;--amber-bg:#fff3ce;--red:#9d2d2d;--red-bg:#fde8e8}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Inter,Arial,sans-serif;letter-spacing:0}.shell{max-width:1440px;margin:auto;padding:28px}.head{background:var(--ink);color:white;padding:30px;border-radius:8px}.eyebrow{font-size:12px;text-transform:uppercase;color:#a8c9b9;font-weight:700}.head h1{font-size:34px;margin:7px 0}.meta{color:#cfddd6}.notice{margin:18px 0;padding:14px 16px;background:${reportStatus === "ready" ? "var(--lime)" : "var(--amber-bg)"};border-left:4px solid ${reportStatus === "ready" ? "var(--green)" : "var(--amber)"};border-radius:4px}.metrics{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin:18px 0}.metric{background:white;border:1px solid var(--line);border-radius:7px;padding:16px}.metric span{display:block;color:var(--muted);font-size:12px;margin-bottom:8px}.metric strong{font-size:24px}.section{background:white;border:1px solid var(--line);border-radius:7px;margin:18px 0;padding:20px;overflow:auto}.section h2{font-size:20px;margin:0 0 14px}.section p{color:var(--muted)}table{width:100%;border-collapse:collapse;font-size:13px}th{text-align:left;background:#eef3ef;padding:10px;border-bottom:1px solid var(--line);white-space:nowrap}td{padding:11px 10px;border-bottom:1px solid #edf1ee;vertical-align:top}.sub{display:block;color:var(--muted);font-size:11px;margin-top:3px}.status{display:inline-block;padding:4px 7px;border-radius:4px;background:var(--lime);color:var(--green);font-weight:700}.status.ready_with_limits{background:var(--amber-bg);color:var(--amber)}.status.not_ready{background:var(--red-bg);color:var(--red)}.foot{font-size:12px;color:var(--muted);padding:8px 2px 30px}@media(max-width:900px){.shell{padding:12px}.metrics{grid-template-columns:repeat(2,1fr)}.head h1{font-size:26px}}@media(max-width:520px){.metrics{grid-template-columns:1fr}}
</style></head><body><main class="shell"><header class="head"><div class="eyebrow">Aterra marketplace intelligence</div><h1>Bol Retailer ${year}-W${String(week).padStart(2, "0")}</h1><div class="meta">Rapportrevisie ${esc(revision.revision_number)} · ${esc(statusLabel(reportStatus))} · Boekhoudstatus: ${esc(revision.accounting_status)}</div></header><div class="notice"><strong>Interpretatie:</strong> dit is een operationeel handelsrapport. Omzet na commissie en retourcorrecties blijft voorlopig totdat settlement en boekhouding zijn afgestemd.${limitations.length ? `<br>${esc(limitations.join(" "))}` : ""}</div><section class="metrics"><div class="metric"><span>Netto verzonden GMS</span><strong>${euro(summary.provisional_net_gms)}</strong></div><div class="metric"><span>Verkochte eenheden</span><strong>${integer(summary.gross_shipped_units)}</strong></div><div class="metric"><span>Productbezoeken</span><strong>${summary.product_visits === null ? "-" : integer(summary.product_visits)}</strong></div><div class="metric"><span>Omzet na commissie</span><strong>${euro(summary.provisional_revenue_after_commission)}</strong></div><div class="metric"><span>Retouren</span><strong>${integer(summary.registered_return_units)}</strong></div></section><section class="section"><h2>Productprestaties</h2><p>Conversie is verkochte eenheden gedeeld door Product visits. Dit is geen perfect cohort-gematchte bestelconversie.</p><table><thead><tr><th>Product</th><th>Netto GMS</th><th>Units</th><th>ASP</th><th>Conversie</th><th>Bezoeken</th><th>Na commissie</th><th>Retouren</th><th>Sponsored rank</th><th>Organic rank</th></tr></thead><tbody>${productRows}</tbody></table></section><section class="section"><h2>Keywordposities</h2><p>Iedere rij is één combinatie van product, zoekwoord, land en plaatsing. De weekpositie is op impressies gewogen; x/7 toont op hoeveel dagen de positie daadwerkelijk is waargenomen.</p><table><thead><tr><th>Product</th><th>Zoekwoord</th><th>Locale</th><th>Plaatsing</th><th>Weekpositie</th><th>Beste</th><th>Slechtste</th><th>Impressies</th><th>Waargenomen</th></tr></thead><tbody>${rankRows || '<tr><td colspan="9">Geen rankwaarnemingen beschikbaar.</td></tr>'}</tbody></table></section><section class="section"><h2>Datakwaliteit</h2><table><thead><tr><th>Dataproduct</th><th>Status</th><th>Beperking</th></tr></thead><tbody>${qualityRows}</tbody></table></section><section class="section"><h2>Open uitzonderingen</h2><ul>${exceptionRows}</ul></section><footer class="foot">Gegenereerd uit Supabase rapportrevisie ${esc(revision.id)} op ${esc(new Date().toISOString())}. Alleen toegankelijk voor geautoriseerde Aterra-gebruikers.</footer></main></body></html>`;
}
