"use client";

import { useMemo, useState } from "react";
import { UserButton } from "@clerk/nextjs";
import type { Actor } from "@/lib/auth";
import type { FinanceException, EvidenceSource } from "@/lib/benchmark";

type State = {
  entity: { legalName: string; tradingName: string; legalForm: string; kvk: string; rsin: string; vatId: string; vatIdStatus: string };
  period: string;
  revenuePeriods: { id: string; label: string; scope: string; revenueExVat: number; revenueIncVat: number; sales: number; orders: number; visits: number | null; performance: { day: string; revenue: number }[] }[];
  metrics: { label: string; value: string; status: string; note: string }[];
  performance: { day: string; revenue: number }[];
  pnl: { label: string; amount: string; state: string }[];
  settlements: { gross: number; adjustment: number; net: number; received: string; match: boolean }[];
  sources: EvidenceSource[]; exceptions: FinanceException[];
  approvals: { gate: string; approver: string; state: string }[];
  providers: { name: string; period: string; note: string }[];
  closeSteps: { step: string; status: string; owner: string; note: string }[];
  vatWorkingPaper: { outputVat: string; inputVat: string; capturedNet: string; status: string; note: string; lines: { label: string; amount: string; state: string }[] };
  policyDrafts: { id: string; name: string; proposal: string; status: string; impact: string }[];
  policyApproval: { owner: string; approvedAt: string; scope: string; status: string; nextGate: string };
  inventory: { ean: string; product: string; opening: number; current: number; location: string; status: string; note: string }[];
  operatingFacts: { marketplace: string; warehouse: string; historicalWarehouse: string; cutoverRule: string; returnRule: string };
};

const nav = ["Overview", "May close", "Reconciliations", "Evidence", "Exceptions", "Controls"] as const;
type View = typeof nav[number];

function StatusPill({ status }: { status: string }) { return <span className={`pill ${status.toLowerCase()}`}><i />{status}</span>; }
function Euro({ value }: { value: number }) { return <>{new Intl.NumberFormat("en-NL", { style: "currency", currency: "EUR" }).format(value)}</>; }

export default function ControlRoom({ actor, initialState }: { actor: Actor; initialState: State }) {
  const [view, setView] = useState<View>("Overview");
  const [periodId, setPeriodId] = useState("may");
  const [exceptions, setExceptions] = useState(initialState.exceptions);
  const [evidence, setEvidence] = useState<EvidenceSource | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);
  const revenuePeriod = initialState.revenuePeriods.find(period => period.id === periodId) ?? initialState.revenuePeriods[0];
  const max = Math.max(...revenuePeriod.performance.map(p => p.revenue));
  const openCount = exceptions.filter(e => e.status === "open").length;
  const confirmedCoverage = Math.round(initialState.sources.reduce((sum, source) => sum + source.coverage, 0) / initialState.sources.length);
  const canEdit = actor.role !== "architect";
  const viewSubtitle = useMemo(() => ({
    Overview: `A release-gated view of the ${revenuePeriod.label} financial position.`,
    "May close": "A controlled route from captured evidence to accountant-approved output.",
    Reconciliations: "Deterministic matching from source report to bank receipt.",
    Evidence: "Every number remains connected to its source and transformation history.",
    Exceptions: "Issues are quarantined until a named human resolves them.",
    Controls: "Access, approvals and accounting policy gates.",
  }[view]), [view, revenuePeriod.label]);

  async function resolve(item: FinanceException) {
    const resolution = window.prompt(`Resolution for ${item.id}:`, "Reviewed against source evidence; correction approved.");
    if (!resolution) return;
    setResolving(item.id);
    const response = await fetch("/api/exceptions/resolve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: item.id, resolution }) });
    if (response.ok) setExceptions(items => items.map(x => x.id === item.id ? { ...x, status: "resolved" } : x));
    else window.alert((await response.json()).error || "Could not save the resolution.");
    setResolving(null);
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">A</div><div><strong>ATERRA</strong><span>Financial system</span></div></div>
      <nav>{nav.map(item => <button key={item} className={view === item ? "active" : ""} onClick={() => setView(item)}><span>{item.slice(0,1)}</span>{item}{item === "Exceptions" && openCount > 0 ? <b>{openCount}</b> : null}</button>)}</nav>
      <div className="entity-card"><span>Legal entity</span><strong>{initialState.entity.legalName}</strong><small>{initialState.entity.legalForm} · KvK {initialState.entity.kvk}</small></div>
      <div className="user-card"><UserButton /><p><strong>{actor.name}</strong><span>{actor.role}</span></p></div>
    </aside>
    <main className="workspace">
      <header><div><span className="eyebrow">Financial control room · {revenuePeriod.label}</span><h1>{view}</h1><p>{viewSubtitle}</p></div><div className="header-actions"><span className="live-dot">Evidence connected</span><label className="period"><span>Reporting period</span><select value={periodId} onChange={event => setPeriodId(event.target.value)}>{initialState.revenuePeriods.map(period => <option value={period.id} key={period.id}>{period.label}</option>)}</select></label></div></header>

      {view === "Overview" && <>
        <section className="reporting-scope"><div><span className="eyebrow">Selected reporting scope</span><strong>{revenuePeriod.scope}</strong></div><p>Bol order revenue is shown excluding BTW for the P&amp;L. Refunds, cancellations and credit notes remain separate reversals until confirmed.</p></section>
        <section className="metric-grid">
          <article className="metric provisional"><div><span>Bol order revenue · excl. BTW</span><StatusPill status="provisional" /></div><strong><Euro value={revenuePeriod.revenueExVat}/></strong><p>{revenuePeriod.sales} sales · {revenuePeriod.orders} orders · before confirmed reversals</p></article>
          <article className="metric provisional"><div><span>Customer sales value · incl. BTW</span><StatusPill status="provisional" /></div><strong><Euro value={revenuePeriod.revenueIncVat}/></strong><p>Presentation value only · not P&amp;L revenue</p></article>
          {initialState.metrics.slice(1).map(metric => <article className={`metric ${metric.status}`} key={metric.label}><div><span>{metric.label}</span><StatusPill status={metric.status} /></div><strong>{metric.value}</strong><p>{metric.note}</p></article>)}
        </section>
        <section className="two-column">
          <article className="panel chart-panel"><div className="panel-head"><div><span className="eyebrow">Commercial signal · excluding BTW</span><h2>Bol revenue progression</h2></div><button onClick={() => setEvidence(initialState.sources[1])}>View source ↗</button></div><div className="chart"><div className="axis"><span><Euro value={max}/></span><span>€0</span></div>{revenuePeriod.performance.map(point => <div className="bar-wrap" key={point.day}><div className="bar-value"><Euro value={point.revenue}/></div><div className="bar" style={{ height: `${Math.round((point.revenue / max) * 100)}%` }} /><span>{point.day}</span></div>)}</div><p className="chart-note">Reported Bol order revenue before confirmed cancellations, refunds and credit notes. Overlapping 14-day exports are deduplicated by date + EAN.</p></article>
          <article className="panel readiness"><div className="panel-head"><div><span className="eyebrow">May close</span><h2>Release readiness</h2></div><strong>58%</strong></div><div className="progress"><i style={{ width: "58%" }} /></div>{[{n:"Sales completeness",s:"confirmed"},{n:"Bank completeness",s:"confirmed"},{n:"Fees & refunds",s:"provisional"},{n:"COGS & inventory",s:"blocked"},{n:"BTW evidence",s:"blocked"}].map(x => <div className="check-row" key={x.n}><span>{x.n}</span><StatusPill status={x.s}/></div>)}<button className="primary" onClick={() => setView("Exceptions")}>Review {openCount} blocking items</button></article>
        </section>
        <section className="two-column lower">
          <article className="panel"><div className="panel-head"><div><span className="eyebrow">Provisional P&amp;L · {revenuePeriod.label}</span><h2>Revenue-to-result bridge</h2></div><span className="lock">Policy-gated</span></div><div className="pnl-table"><div><span>Marketplace order revenue · excl. BTW</span><strong className="provisional"><Euro value={revenuePeriod.revenueExVat}/></strong></div>{initialState.pnl.slice(1).map(row => <div key={row.label}><span>{row.label}</span><strong className={row.state}>{row.amount}</strong></div>)}</div></article>
          <article className="panel"><div className="panel-head"><div><span className="eyebrow">Source coverage</span><h2>Evidence health</h2></div><strong>{confirmedCoverage}%</strong></div>{initialState.sources.slice(0,5).map(source => <button className="source-row" key={source.id} onClick={() => setEvidence(source)}><span className="source-icon">{source.provider.slice(0,2).toUpperCase()}</span><p><strong>{source.name}</strong><span>{source.provider} · {source.period}</span></p><div className="mini-progress"><i style={{width:`${source.coverage}%`}} /></div><b>{source.coverage}%</b></button>)}<button className="text-button" onClick={() => setView("Evidence")}>Open evidence registry →</button></article>
        </section>
      </>}

      {view === "Reconciliations" && <section className="stack"><article className="callout success"><div><span className="eyebrow">Settlement control · Rule v1.0</span><h2>All available Bol settlements match the bank</h2><p>Matching is deterministic: exact net EUR amount, expected payment window and Bol counterparty.</p></div><strong>€0.00<br/><span>difference</span></strong></article>{initialState.settlements.map((s,i)=><article className="settlement" key={i}><div className="step"><span>01</span><p>Bol gross<strong><Euro value={s.gross}/></strong></p></div><i>−</i><div className="step"><span>02</span><p>Adjustments<strong><Euro value={Math.abs(s.adjustment)}/></strong></p></div><i>=</i><div className="step focus"><span>03</span><p>Net settlement<strong><Euro value={s.net}/></strong></p></div><i>→</i><div className="step matched"><span>✓</span><p>KNAB · {s.received}<strong><Euro value={s.net}/></strong></p></div><button onClick={()=>setEvidence(initialState.sources[4])}>Evidence ↗</button></article>)}</section>}

      {view === "May close" && <section className="stack">
        <article className="callout caution"><div><span className="eyebrow">Close status · Draft policy set</span><h2>May is reconciled for cash, not yet releasable for accounting</h2><p>Inventory valuation, import evidence and accountant approval remain hard gates.</p></div><strong>3 / 8<br/><span>gates cleared</span></strong></article>
        <section className="two-column close-grid">
          <article className="panel"><div className="panel-head"><div><span className="eyebrow">Close checklist</span><h2>Evidence-to-release workflow</h2></div></div><div className="close-list">{initialState.closeSteps.map((item,index)=><div key={item.step}><i className={item.status}>{index+1}</i><p><strong>{item.step}</strong><span>{item.note}</span><small>Owner · {item.owner}</small></p><StatusPill status={item.status}/></div>)}</div></article>
          <article className="panel vat-paper"><div className="panel-head"><div><span className="eyebrow">Diagnostic only</span><h2>Captured BTW lines</h2></div><span className="lock">Not a reserve</span></div><div className="vat-summary"><div><span>Modeled output</span><strong>{initialState.vatWorkingPaper.outputVat}</strong></div><div><span>Captured input</span><strong>{initialState.vatWorkingPaper.inputVat}</strong></div><div><span>Captured net</span><strong>{initialState.vatWorkingPaper.capturedNet}</strong></div></div><p className="warning-copy">{initialState.vatWorkingPaper.note}</p><div className="pnl-table">{initialState.vatWorkingPaper.lines.map(line=><div key={line.label}><span>{line.label}</span><strong className={line.state}>{line.amount}</strong></div>)}</div></article>
        </section>
        <article className="panel"><div className="panel-head"><div><span className="eyebrow">Quantity ledger · Tien Fulfilment</span><h2>Opening to current inventory</h2></div><StatusPill status="confirmed"/></div><div className="inventory-table"><div className="inventory-head"><span>Product</span><span>Opening</span><span>Current</span><span>Status</span></div>{initialState.inventory.map(item=><div key={item.ean}><p><strong>{item.product}</strong><small>EAN {item.ean} · {item.location}</small></p><b>{item.opening}</b><b>{item.current}</b><span>{item.status}</span></div>)}</div><p className="chart-note">Quantity logic: opening + inbound + resellable returns − Bol sales − approved exceptions. Valuation remains separate.</p></article>
        <article className="identity-alert resolved-identity"><div><span className="eyebrow">Operating model · Owner confirmed</span><h2>Bol orders → revenue · Tien → physical stock</h2><p>Max is historical. Tien’s effective cutover is derived from its first inbound or dispatch event, so no exact user-supplied date is required.</p></div><button onClick={()=>setView("Controls")}>View policies →</button></article>
      </section>}

      {view === "Evidence" && <section className="evidence-grid">{initialState.sources.map(source => <article className="evidence-card" key={source.id} onClick={() => setEvidence(source)}><div><span className="source-icon large">{source.provider.slice(0,2).toUpperCase()}</span><StatusPill status={source.status}/></div><h3>{source.name}</h3><p>{source.note}</p><div className="coverage"><span>Coverage</span><strong>{source.coverage}%</strong><i><b style={{width:`${source.coverage}%`}}/></i></div><small>{source.drivePath}</small></article>)}</section>}

      {view === "Exceptions" && <section className="stack">{exceptions.map(item => <article className={`exception ${item.status}`} key={item.id}><div className="severity" data-level={item.severity}>{item.severity}</div><div><span className="eyebrow">{item.id} · {item.source}</span><h3>{item.title}</h3><p>{item.detail}</p><small>Owner: {item.owner}</small></div><StatusPill status={item.status}/>{item.status === "open" && canEdit ? <button className="primary small" disabled={resolving===item.id} onClick={()=>resolve(item)}>{resolving===item.id?"Saving…":"Resolve"}</button>:null}</article>)}</section>}

      {view === "Controls" && <section className="two-column controls"><article className="panel"><div className="panel-head"><div><span className="eyebrow">Human-in-the-loop</span><h2>Approval gates</h2></div></div>{initialState.approvals.map(a=><div className="approval" key={a.gate}><p><strong>{a.gate}</strong><span>{a.approver}</span></p><StatusPill status={a.state.toLowerCase()==="active"?"confirmed":a.state.toLowerCase()==="phase 2"?"provisional":"blocked"}/></div>)}</article><article className="panel"><span className="eyebrow">Provider continuity</span><h2>Fulfilment transition</h2><div className="timeline">{initialState.providers.map((p,i)=><div key={p.name}><i>{i+1}</i><p><strong>{p.name}</strong><span>{p.period} · {p.note}</span></p></div>)}</div><div className="policy-note"><strong>Accounting consistency rule</strong><p>Provider changes may alter source shape, never the canonical definitions or approved metric formulas.</p></div></article><article className="policy-approval full"><div><span className="eyebrow">Owner approval recorded · {initialState.policyApproval.approvedAt}</span><h2>All ten policy proposals approved by {initialState.policyApproval.owner}</h2><p>{initialState.policyApproval.scope} now await {initialState.policyApproval.nextGate.toLowerCase()} before accounting and BTW activation.</p></div><StatusPill status="confirmed"/></article><article className="panel full"><span className="eyebrow">Owner-approved policy register</span><h2>Ten decisions for accountant countersignature</h2><div className="policy-grid">{initialState.policyDrafts.map(policy=><div key={policy.id}><span>{policy.id} · {policy.status}</span><h3>{policy.name}</h3><p>{policy.proposal}</p><small>{policy.impact}</small></div>)}</div></article><article className="panel full"><span className="eyebrow">Security boundary</span><h2>Authorized access</h2><div className="access-grid"><div><strong>Reinout &amp; Thijs</strong><span>Owners · approve and correct</span></div><div><strong>Hidde</strong><span>Architect · read-only review</span></div><div><strong>Evidence storage</strong><span>Encrypted · SHA-256 registered</span></div><div><strong>Audit trail</strong><span>Actor, change, timestamp, before/after</span></div></div></article></section>}
    </main>
    {evidence && <div className="drawer-backdrop" onClick={()=>setEvidence(null)}><aside className="drawer" onClick={e=>e.stopPropagation()}><button className="close" onClick={()=>setEvidence(null)}>×</button><span className="eyebrow">Evidence detail</span><h2>{evidence.name}</h2><StatusPill status={evidence.status}/><dl><dt>Provider</dt><dd>{evidence.provider}</dd><dt>Type</dt><dd>{evidence.kind}</dd><dt>Period</dt><dd>{evidence.period}</dd><dt>Coverage</dt><dd>{evidence.coverage}%</dd><dt>Google Drive location</dt><dd>{evidence.drivePath}</dd></dl><div className="provenance"><strong>Traceability chain</strong><ol><li>Source file registered</li><li>Hash and metadata captured</li><li>Adapter transforms record</li><li>Validation and exception checks</li><li>Approved metric formula</li></ol></div><p>{evidence.note}</p></aside></div>}
  </div>;
}
