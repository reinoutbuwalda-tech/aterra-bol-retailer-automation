import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../supabase/functions/bol-retailer-transform/index.ts', import.meta.url), 'utf8');
const fixture = JSON.parse(readFileSync(new URL('../docs/bol-retailer-api-2026-W39-snapshot-2026-09-28.json', import.meta.url), 'utf8'));
const legacyPromotionMigration = readFileSync(
  new URL('../supabase/migrations/20260929163859_promote_verified_legacy_retailer_insights.sql', import.meta.url),
  'utf8',
);

function transformer() {
  const context = vm.createContext({
    Response, Request, URL, Headers, Blob, TextEncoder, TextDecoder,
    crypto: globalThis.crypto,
    Deno: { serve() {}, env: { get() { return 'test'; } } },
  });
  vm.runInContext(stripTypeScriptTypes(source.replace(/^import .*\n/, '')), context);
  return context;
}

function canonicalInput() {
  const snapshot = structuredClone(fixture);
  const offerInsights = snapshot.weekMetrics.offerInsights.map(insight => ({
    ...insight,
    periods: insight.periods ?? insight.sample?.offerInsights?.[0]?.periods ?? [],
  }));
  return {
    claim: {
      status: 'claimed',
      messageId: 1,
      transformRunId: '00000000-0000-4000-8000-000000000001',
      sourceRunId: '32a6e6ad-9a82-453f-840e-078ae592cfe2',
      sourceContractVersion: '3.0',
      transformVersion: 'retailer-transform-v1',
      leaseToken: '00000000-0000-4000-8000-000000000002',
      attemptNumber: 1,
      isoYear: 2026,
      isoWeek: 39,
      periodStart: '2026-09-21',
      periodEnd: '2026-09-27',
      storageBucket: 'bol-retailer-api-json',
      manifestPath: 'test/manifest.json',
      manifestSha256: 'a'.repeat(64),
      sourceStatus: 'complete',
      sourceArtifactCount: 7,
    },
    loaded: {
      manifest: {
        generatedAt: snapshot.generatedAt,
        summary: snapshot.summary,
        datasetStatuses: {
          commercial: { status: 'complete' },
          catalog: { status: 'complete' },
          insights: { status: 'complete' },
          financial: { status: 'complete' },
        },
      },
      artifacts: {
        commercial: { operational: snapshot.operational },
        catalog: { currentState: snapshot.currentState },
        insights: { weekMetrics: { offerInsights }, ranks: snapshot.additionalReadOnlySurfaces.productRanks },
        financial: { settlement: { invoices: [], invoiceDetails: [], invoiceSpecifications: [] } },
        provenance: { summary: snapshot.summary },
      },
      evidence: [],
    },
  };
}

test('W39 canonical trading metrics reconcile to the reviewed workbook', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInput();
  const publication = await context.buildPublication(claim, loaded);
  const metrics = publication.weeklyReport.metrics;
  const total = metrics.reduce((result, row) => ({
    units: result.units + row.gross_shipped_units,
    gross: result.gross + row.gross_shipped_gms,
    commission: result.commission + row.gross_commission,
    linkedReturn: result.linkedReturn + row.linked_return_gms,
    linkedCommission: result.linkedCommission + row.linked_return_commission,
    net: result.net + row.provisional_net_gms,
    afterCommission: result.afterCommission + row.provisional_revenue_after_commission,
    visits: result.visits + (row.product_visits ?? 0),
  }), { units: 0, gross: 0, commission: 0, linkedReturn: 0, linkedCommission: 0, net: 0, afterCommission: 0, visits: 0 });
  assert.equal(total.units, 23);
  assert.equal(Math.round(total.gross * 100) / 100, 769.77);
  assert.equal(Math.round(total.commission * 100) / 100, 134.13);
  assert.equal(Math.round(total.linkedReturn * 100) / 100, 27.99);
  assert.equal(Math.round(total.linkedCommission * 100) / 100, 5.35);
  assert.equal(Math.round(total.net * 100) / 100, 741.78);
  assert.equal(Math.round(total.afterCommission * 100) / 100, 613);
  assert.equal(total.visits, 338);
  assert.equal(publication.weeklyReport.status, 'ready_with_limits');
});

test('partial visit coverage is retained as evidence but not published as a weekly total', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInput();
  for (const insight of loaded.artifacts.insights.weekMetrics.offerInsights) {
    if (insight.metric === 'PRODUCT_VISITS') insight.periods = insight.periods.slice(1);
  }

  const publication = await context.buildPublication(claim, loaded);
  assert.equal(publication.weeklyReport.status, 'not_ready');
  assert.equal(publication.weeklyReport.metrics.every(row => row.product_visits === null), true);
  assert.equal(publication.weeklyReport.metrics.every(row => row.trading_units_per_visit === null), true);
  assert.equal(publication.weeklyReport.metrics.every(row => row.visits_status === 'not_ready'), true);
  assert.equal(publication.facts.offer_insight_daily.some(row => row.metric === 'PRODUCT_VISITS'), true);
});

test('legacy traffic promotion contains only checksum-backed, date-aligned W37-W39 evidence', () => {
  const evidence = JSON.parse(legacyPromotionMigration.match(/\$legacy_data\$(.*)\$legacy_data\$/s)[1]);
  assert.deepEqual(evidence.map(row => row.week), [37, 38, 39]);

  const expected = new Map([[37, 290], [38, 268], [39, 338]]);
  for (const week of evidence) {
    assert.match(week.sha256, /^[0-9a-f]{64}$/);
    assert.equal(Number.isInteger(week.bytes) && week.bytes > 0, true);

    const visitSeries = week.insights.filter(row => row.metric === 'PRODUCT_VISITS');
    assert.equal(visitSeries.length, 4);
    assert.equal(visitSeries.every(row => row.periods.length === 7), true);

    const dates = new Set(visitSeries.flatMap(row => row.periods.map(period => {
      const { year, month, day } = period.period;
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    })));
    assert.equal(dates.size, 7);

    const total = visitSeries.flatMap(row => row.periods).reduce((sum, period) => sum + period.total, 0);
    assert.equal(total, expected.get(week.week));
  }

  assert.match(legacyPromotionMigration, /LEGACY_INSIGHTS_CHECKSUM/);
  assert.match(legacyPromotionMigration, /Exact EAN match to contract 3\.0/);
});

test('every valid offer receives a weekly row even without sales, returns, or visits', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInput();
  const zeroActivityEan = '8720892887528';

  for (const shipment of loaded.artifacts.commercial.operational.shipmentDetails) {
    shipment.detail.shipmentItems = shipment.detail.shipmentItems.filter(item => item.product.ean !== zeroActivityEan);
  }
  loaded.artifacts.insights.weekMetrics.offerInsights = loaded.artifacts.insights.weekMetrics.offerInsights
    .filter(item => item.ean !== zeroActivityEan);

  const publication = await context.buildPublication(claim, loaded);
  const metric = publication.weeklyReport.metrics.find(row => row.ean === zeroActivityEan);
  assert.ok(metric);
  assert.equal(metric.gross_shipped_units, 0);
  assert.equal(metric.gross_shipped_gms, 0);
  assert.equal(metric.registered_return_units, 0);
  assert.equal(metric.product_visits, null);
  assert.equal(metric.visits_status, 'not_ready');
});

test('transient transform failures stop after five attempts', () => {
  const context = transformer();
  assert.equal(context.retryPolicy(1).action, 'retry');
  assert.equal(context.retryPolicy(1).delaySeconds, 300);
  assert.equal(context.retryPolicy(4).action, 'retry');
  assert.equal(context.retryPolicy(4).delaySeconds, 1200);
  assert.equal(context.retryPolicy(5).action, 'reject');
  assert.equal(context.retryPolicy(5).errorCode, 'RETRY_EXHAUSTED');
  assert.equal(context.retryPolicy(1, true).action, 'reject');
});

test('fenced retry and reject mutations require an explicit true result', () => {
  const context = transformer();
  assert.equal(context.fencedMutationSucceeded(true, null), true);
  assert.equal(context.fencedMutationSucceeded(false, null), false);
  assert.equal(context.fencedMutationSucceeded(null, null), false);
  assert.equal(context.fencedMutationSucceeded(true, new Error('rpc failed')), false);
});

test('shipments outside the claimed Monday-Sunday period fail closed', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInput();
  loaded.artifacts.commercial.operational.shipmentDetails[0].detail.shipmentDateTime = '2026-09-28T00:00:00+02:00';
  await assert.rejects(
    context.buildPublication(claim, loaded),
    error => error.code === 'OUT_OF_PERIOD_SHIPMENT',
  );
});

test('returns outside the claimed Monday-Sunday period fail closed', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInput();
  loaded.artifacts.commercial.operational.returns[0].registrationDateTime = '2026-09-20T23:59:59+02:00';
  await assert.rejects(
    context.buildPublication(claim, loaded),
    error => error.code === 'OUT_OF_PERIOD_RETURN',
  );
});

test('a return without an order ID cannot receive a financial value match', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInput();
  const linkedReturn = loaded.artifacts.commercial.operational.returns
    .flatMap(row => row.returnItems)
    .find(item => item.ean === '8720892887504');
  linkedReturn.orderId = null;

  const publication = await context.buildPublication(claim, loaded);
  const metric = publication.weeklyReport.metrics.find(row => row.ean === linkedReturn.ean);
  assert.equal(metric.linked_return_units, 0);
  assert.equal(metric.unlinked_return_units, linkedReturn.expectedQuantity);
  assert.equal(publication.exceptions.some(row => row.exception_code === 'RETURN_MISSING_ORDER_ID'), true);
});

test('a return quantity larger than its exact shipment match remains unlinked', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInput();
  const linkedReturn = loaded.artifacts.commercial.operational.returns
    .flatMap(row => row.returnItems)
    .find(item => item.ean === '8720892887504');
  linkedReturn.expectedQuantity = 99;

  const publication = await context.buildPublication(claim, loaded);
  const metric = publication.weeklyReport.metrics.find(row => row.ean === linkedReturn.ean);
  assert.equal(metric.linked_return_units, 0);
  assert.equal(metric.unlinked_return_units, 99);
  assert.equal(publication.exceptions.some(row => row.exception_code === 'RETURN_QUANTITY_EXCEEDS_SHIPMENT'), true);
});

test('duplicate shipment details fail before weekly metrics can double count', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInput();
  loaded.artifacts.commercial.operational.shipmentDetails.push(
    structuredClone(loaded.artifacts.commercial.operational.shipmentDetails[0]),
  );
  await assert.rejects(
    context.buildPublication(claim, loaded),
    error => error.code === 'DUPLICATE_SHIPMENT_ID',
  );
});

test('duplicate return RMAs fail before return metrics can double count', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInput();
  const returnCase = loaded.artifacts.commercial.operational.returns[0];
  returnCase.returnItems.push(structuredClone(returnCase.returnItems[0]));
  await assert.rejects(
    context.buildPublication(claim, loaded),
    error => error.code === 'DUPLICATE_RETURN_ITEM',
  );
});

test('duplicate product-visit dates fail instead of inflating the weekly total', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInput();
  const visits = loaded.artifacts.insights.weekMetrics.offerInsights.find(row => row.metric === 'PRODUCT_VISITS');
  visits.periods.push(structuredClone(visits.periods[0]));
  await assert.rejects(
    context.buildPublication(claim, loaded),
    error => error.code === 'DUPLICATE_PRODUCT_VISIT_DATE',
  );
});

test('visit date coverage requires a valid nonnegative total', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInput();
  const visits = loaded.artifacts.insights.weekMetrics.offerInsights.find(row => row.metric === 'PRODUCT_VISITS');
  visits.periods[0].total = null;
  await assert.rejects(
    context.buildPublication(claim, loaded),
    error => error.code === 'INVALID_PRODUCT_VISIT_TOTAL',
  );
});

test('rank calls outside the reporting week fail closed', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInput();
  loaded.artifacts.insights.ranks[0].date = '2026-09-28';
  await assert.rejects(
    context.buildPublication(claim, loaded),
    error => error.code === 'OUT_OF_PERIOD_RANK_CALL',
  );
});

test('duplicate rank call combinations fail instead of passing coverage', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInput();
  loaded.artifacts.insights.ranks.push(structuredClone(loaded.artifacts.insights.ranks[0]));
  await assert.rejects(
    context.buildPublication(claim, loaded),
    error => error.code === 'DUPLICATE_RANK_CALL',
  );
});

test('malformed successful return items cannot disappear silently', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInput();
  loaded.artifacts.commercial.operational.returns[0].returnItems[0].rmaId = null;
  await assert.rejects(
    context.buildPublication(claim, loaded),
    error => error.code === 'INVALID_RETURN_ITEM',
  );
});

test('malformed catalog offers cannot disappear from weekly coverage', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInput();
  loaded.artifacts.catalog.currentState.offers[0].ean = null;
  await assert.rejects(
    context.buildPublication(claim, loaded),
    error => error.code === 'INVALID_CATALOG_OFFER',
  );
});

test('malformed invoice headers cannot coexist with a ready financial product', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInput();
  loaded.artifacts.financial.settlement.invoices = [{ invoiceType: 'ALL_IN_ONE' }];
  await assert.rejects(
    context.buildPublication(claim, loaded),
    error => error.code === 'INVALID_INVOICE_HEADER',
  );
});

test('sales facts come from shipment lines and keep gross ASP separate from returns', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInput();
  const publication = await context.buildPublication(claim, loaded);
  const carafe = publication.weeklyReport.metrics.find(row => row.ean === '8720892887504');
  assert.equal(carafe.gross_shipped_units, 4);
  assert.equal(carafe.gross_shipped_gms, 111.96);
  assert.equal(carafe.linked_return_gms, 27.99);
  assert.equal(carafe.provisional_net_gms, 83.97);
  assert.equal(carafe.gross_shipped_asp, 27.99);
});

test('unmatched returns remain visible and do not silently reduce revenue', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInput();
  const publication = await context.buildPublication(claim, loaded);
  const fort = publication.weeklyReport.metrics.find(row => row.ean === '6970452112658');
  assert.equal(fort.registered_return_units, 1);
  assert.equal(fort.linked_return_units, 0);
  assert.equal(fort.unlinked_return_units, 1);
  assert.equal(fort.provisional_net_gms, fort.gross_shipped_gms);
  assert.equal(publication.exceptions.some(row => row.exception_code === 'UNMATCHED_RETURN' && row.ean === fort.ean), true);
});

test('personal return comments are not copied to the structured publication', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInput();
  const publication = await context.buildPublication(claim, loaded);
  assert.equal(JSON.stringify(publication).includes('Perongeluk'), false);
});

test('Buy Box rows contain country percentages and never a fabricated total', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInput();
  const publication = await context.buildPublication(claim, loaded);
  const buyBox = publication.facts.offer_insight_daily.filter(row => row.metric === 'BUY_BOX_PERCENTAGE');
  assert.equal(buyBox.length > 0, true);
  assert.equal(buyBox.every(row => row.is_total === false && row.country_code), true);
  assert.equal(buyBox.every(row => row.value >= 0 && row.value <= 100), true);
});

test('facts carry exact source pointers and semantic hashes', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInput();
  const publication = await context.buildPublication(claim, loaded);
  const row = publication.facts.outbound_shipment_items[0];
  assert.match(row.semantic_hash, /^[0-9a-f]{64}$/);
  assert.equal(row._artifact_name, 'commercial');
  assert.match(row._source_pointer, /^\/operational\/shipmentDetails\//);
});
