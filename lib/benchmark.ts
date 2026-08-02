export type Status = "confirmed" | "provisional" | "blocked" | "open" | "resolved";
export type EvidenceSource = { id: string; name: string; provider: string; kind: string; period: string; drivePath: string; status: Status; coverage: number; note: string };
export type FinanceException = { id: string; title: string; severity: "high" | "medium" | "low"; status: "open" | "resolved"; source: string; detail: string; owner: string };

export const benchmark = {
  entity: { legalName: "Treso ONO", tradingName: "Aterra", legalForm: "VOF", kvk: "99133954", rsin: "868817375" },
  period: "May 2026",
  metrics: [
    { label: "Bol reported revenue", value: "€3,001.69", status: "provisional" as Status, note: "118 sales · 115 orders · 1,225 visits" },
    { label: "Current bank balance", value: "€994.58", status: "confirmed" as Status, note: "KNAB closing balance · 31 May" },
    { label: "Settlement matches", value: "3 / 3", status: "confirmed" as Status, note: "Bank receipts equal net Bol settlements" },
    { label: "BTW reserve", value: "Policy gate", status: "blocked" as Status, note: "Held until VAT evidence and policy approval" },
  ],
  performance: [
    { day: "1–5", revenue: 354 }, { day: "6–10", revenue: 432 }, { day: "11–15", revenue: 517 },
    { day: "16–20", revenue: 621 }, { day: "21–25", revenue: 493 }, { day: "26–31", revenue: 585 },
  ],
  pnl: [
    { label: "Marketplace revenue", amount: "€3,001.69", state: "provisional" },
    { label: "Refunds & credit notes", amount: "Pending", state: "blocked" },
    { label: "Marketplace fees", amount: "Pending", state: "blocked" },
    { label: "Cost of goods sold", amount: "Pending", state: "blocked" },
    { label: "Freight, duties & fulfilment", amount: "Pending", state: "blocked" },
    { label: "Operating result", amount: "Not released", state: "blocked" },
  ],
  settlements: [
    { gross: 419.96, adjustment: -0.24, net: 419.72, received: "18 May", match: true },
    { gross: 499.03, adjustment: -60.73, net: 438.30, received: "2 June", match: true },
    { gross: 1624.00, adjustment: -50.87, net: 1573.13, received: "16 June", match: true },
  ],
  sources: [
    { id: "kvk", name: "Chamber of Commerce extract", provider: "KvK", kind: "Legal identity", period: "Current", drivePath: "Essential company/uittreksel_handelsregister_99133954.pdf", status: "confirmed", coverage: 100, note: "Defines entity and authorized partners." },
    { id: "bol-daily", name: "Articles per day", provider: "Bol.com", kind: "Sales", period: "May 2026", drivePath: "Finance/Bol.com/Sales reports/May 2026", status: "confirmed", coverage: 100, note: "31 unique dates, two EANs; overlaps deduplicated by date + EAN." },
    { id: "bol-return", name: "Return analysis", provider: "Bol.com", kind: "Returns", period: "2026 YTD", drivePath: "Finance/Bol.com/Return reports/2026", status: "provisional", coverage: 92, note: "Exact duplicate RVS row quarantined." },
    { id: "knab-may", name: "May bank statement", provider: "KNAB", kind: "Bank", period: "May 2026", drivePath: "Finance/Bank/2026/05-May.pdf", status: "confirmed", coverage: 100, note: "Opening €5,009.53; credits €442.22; debits €4,457.17; close €994.58." },
    { id: "bol-settlement", name: "Settlement specifications", provider: "Bol.com", kind: "Settlement", period: "May–June 2026", drivePath: "Finance/Bol.com/Settlement reports/2026", status: "confirmed", coverage: 100, note: "All three net settlement amounts matched to bank receipts." },
    { id: "max", name: "Historical fulfilment files", provider: "Max Fulfilment", kind: "Fulfilment", period: "Historical", drivePath: "Finance/Fulfilment/Max/Historical", status: "provisional", coverage: 70, note: "Historical provider; retained for comparability and provenance." },
    { id: "tien", name: "Fulfilment reports", provider: "Tien Fulfilment", kind: "Fulfilment", period: "Current", drivePath: "Finance/Fulfilment/Tien", status: "blocked", coverage: 15, note: "New provider; report format and service start date need confirmation." },
    { id: "i4y", name: "Freight and import evidence", provider: "Import 4 You", kind: "Freight & customs", period: "Current", drivePath: "Finance/Import 4 You", status: "blocked", coverage: 25, note: "Customs declarations and import VAT files must be linked before VAT release." },
  ] as EvidenceSource[],
  exceptions: [
    { id: "EX-001", title: "Duplicate return row", severity: "medium", status: "open", source: "Bol return analysis", detail: "One exact duplicate RVS row is excluded from totals and awaits confirmation.", owner: "Reinout" },
    { id: "EX-002", title: "Incoterm contradiction", severity: "high", status: "open", source: "CN supplier invoices", detail: "Invoice language conflicts with expected responsibility for freight, duty or import VAT.", owner: "Thijs" },
    { id: "EX-003", title: "Import VAT evidence incomplete", severity: "high", status: "open", source: "Import 4 You", detail: "BTW reserve cannot be released until customs and import VAT evidence is complete.", owner: "Reinout" },
    { id: "EX-004", title: "Inventory opening balance missing", severity: "high", status: "open", source: "Historical fulfilment", detail: "COGS and gross margin remain blocked without an approved opening inventory position.", owner: "Reinout" },
    { id: "EX-005", title: "Accounting policy set pending", severity: "medium", status: "open", source: "Governance", detail: "Revenue, refunds, FX, stock, VAT and period close policies require accountant approval.", owner: "Accountant" },
  ] as FinanceException[],
  approvals: [
    { gate: "Document correction", approver: "Reinout or Thijs", state: "Active" },
    { gate: "Metric definition change", approver: "Owner + accountant", state: "Required" },
    { gate: "Monthly close release", approver: "Owner", state: "Blocked" },
    { gate: "Negotiation draft send", approver: "Human only", state: "Phase 2" },
  ],
  providers: [
    { name: "Max Fulfilment", period: "Historical", note: "Read-only comparison baseline" },
    { name: "Tien Fulfilment", period: "Current", note: "Onboarding and schema mapping" },
  ],
};
