import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../supabase/functions/bol-retailer-transform/index.ts', import.meta.url), 'utf8');
const legacyPromotionMigration = readFileSync(
  new URL('../supabase/migrations/20260929163859_promote_verified_legacy_retailer_insights.sql', import.meta.url),
  'utf8',
);

const weekDates = [
  '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24',
  '2026-09-25', '2026-09-26', '2026-09-27',
];
const rankLocales = ['fr-BE', 'nl-BE', 'nl-NL'];
const products = [
  {
    ean: '6970452112658', offerId: 'offer-fort', title: 'Fort kit',
    units: 1, unitPrice: 59.99, commission: 10.15, visits: [4, 6, 3, 8, 6, 3, 4],
  },
  {
    ean: '8720892887504', offerId: 'offer-fruit-carafe', title: 'Fruit carafe',
    units: 4, unitPrice: 27.99, commission: 21.4, visits: [14, 6, 6, 7, 11, 10, 13],
  },
  {
    ean: '8720892887511', offerId: 'offer-steel-carafe', title: 'Steel carafe',
    units: 7, unitPrice: 206.93 / 7, commission: 39.1, visits: [15, 14, 9, 16, 11, 14, 13],
  },
  {
    ean: '8720892887528', offerId: 'offer-sports-bag', title: 'Sports bag 54L',
    units: 11, unitPrice: 390.89 / 11, commission: 63.48, visits: [20, 26, 23, 24, 14, 13, 25],
  },
];

function dateParts(date) {
  const [year, month, day] = date.split('-').map(Number);
  return { year, month, day };
}

function buildFixture() {
  const shipments = products.map((product, index) => {
    const shipmentId = `shipment-${index + 1}`;
    const orderId = `order-${index + 1}`;
    return {
      status: 200,
      shipmentId,
      detail: {
        shipmentId,
        shipmentDateTime: `${weekDates[index]}T12:00:00+02:00`,
        order: { orderId },
        pickupPoint: false,
        shipmentDetails: { countryCode: 'NL' },
        billingDetails: { countryCode: 'NL' },
        transport: {},
        shipmentItems: [{
          orderItemId: `order-item-${index + 1}`,
          product: { ean: product.ean, title: product.title },
          offer: { offerId: product.offerId },
          fulfilment: { method: 'FBR', distributionParty: 'RETAILER' },
          quantityShipped: product.units,
          unitPrice: product.unitPrice,
          commission: product.commission,
        }],
      },
    };
  });
  const offers = products.map(product => ({
    offerId: product.offerId,
    ean: product.ean,
    lastModifiedDateTime: '2026-09-27T12:00:00+02:00',
    onHoldByRetailer: false,
    condition: { category: 'NEW' },
    product: { bolProductId: `bol-${product.ean}` },
    stock: { amount: 100, correctedStock: 100, managedByRetailer: true },
    pricing: { bundlePrices: [{ quantity: 1, unitPrice: product.unitPrice }] },
    fulfilment: { method: 'FBR', schedule: 'SHIPPING_VIA_BOL' },
    countryAvailabilities: [
      { countryCode: 'NL', forSale: true },
      { countryCode: 'BE', forSale: true },
    ],
  }));
  const offerInsights = products.flatMap(product => [
    {
      ean: product.ean,
      offerId: product.offerId,
      metric: 'PRODUCT_VISITS',
      periods: weekDates.map((date, index) => ({
        period: dateParts(date),
        total: product.visits[index],
        countries: [{ countryCode: 'NL', value: product.visits[index] }],
      })),
    },
    {
      ean: product.ean,
      offerId: product.offerId,
      metric: 'BUY_BOX_PERCENTAGE',
      periods: weekDates.map(date => ({
        period: dateParts(date),
        countries: [
          { countryCode: 'NL', value: 100 },
          { countryCode: 'BE', value: 90 },
        ],
      })),
    },
  ]);
  const ranks = products.flatMap(product => weekDates.flatMap(date => rankLocales.map(locale => ({
    status: 200,
    ean: product.ean,
    date,
    locale,
    type: 'SEARCH',
    data: { ranks: [{ searchTerm: product.title.toLowerCase(), rank: 1, impressions: 1, wasSponsored: false }] },
  }))));

  return {
    generatedAt: '2026-09-28T08:00:00+02:00',
    summary: { fixture: 'synthetic W39 reconciliation case' },
    operational: {
      shipmentDetails: shipments,
      ordersFromShipmentDetails: [],
      returns: [
        {
          returnId: 'return-unmatched-fort',
          registrationDateTime: '2026-09-27T12:05:18+02:00',
          fulfilmentMethod: 'FBR',
          returnItems: [{
            rmaId: 'rma-unmatched-fort',
            orderId: 'order-outside-week',
            ean: '6970452112658',
            expectedQuantity: 1,
            handled: false,
            returnReason: { mainReason: 'Ordered by mistake', customerComments: 'Perongeluk' },
          }],
        },
        {
          returnId: 'return-linked-carafe',
          registrationDateTime: '2026-09-23T20:21:01+02:00',
          fulfilmentMethod: 'FBR',
          returnItems: [{
            rmaId: 'rma-linked-carafe',
            orderId: 'order-2',
            ean: '8720892887504',
            expectedQuantity: 1,
            handled: false,
            returnReason: { mainReason: 'Quality' },
          }],
        },
      ],
      unhandledReturns: [],
    },
    currentState: { offers, inventory: [], commissions: [] },
    weekMetrics: { offerInsights },
    additionalReadOnlySurfaces: { productRanks: ranks },
  };
}

const fixture = buildFixture();

function transformer() {
  const context = vm.createContext({
    Response, Request, URL, Headers, Blob, TextEncoder, TextDecoder,
    crypto: globalThis.crypto,
    Deno: { serve() {}, env: { get() { return 'test'; } } },
  });
  vm.runInContext(stripTypeScriptTypes(source.replace(/^import[^\r\n]*(?:\r?\n)/, '')), context);
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
      transformVersion: 'retailer-transform-v2',
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

function canonicalInvoiceInput() {
  const input = canonicalInput();
  input.loaded.artifacts.financial.settlement.invoices = [{
    invoiceId: 'invoice-1',
    issueDate: '2026-09-27',
    invoiceType: 'ALL_IN_ONE',
    invoicePeriod: { startDate: '2026-09-21', endDate: '2026-09-27' },
    legalMonetaryTotal: {
      payableAmount: { amount: 12.34, currencyID: 'EUR' },
      taxExclusiveAmount: { amount: 10.2, currencyID: 'EUR' },
      taxInclusiveAmount: { amount: 12.34, currencyID: 'EUR' },
    },
  }];
  input.loaded.artifacts.financial.settlement.invoiceSpecifications = [{
    invoiceId: 'invoice-1',
    lines: [{
      invoiceLineRef: 'line-1',
      type: 'COMMISSION',
      quantity: -1.25,
      lineExtensionAmount: { amount: -12.3456, currencyID: 'EUR' },
      priceAmount: { amount: 9.5, currencyID: 'EUR' },
      taxAmount: { amount: -2.1456, currencyID: 'EUR' },
      taxPercentage: 21,
    }],
  }];
  return input;
}

function manifestInput() {
  const { claim } = canonicalInput();
  claim.manifestPath = `retailer-api/year=2026/week=39/run=${claim.sourceRunId}/manifest.json`;
  const datasetStatuses = Object.fromEntries([
    'account', 'catalog', 'commercial', 'financial', 'insights', 'operations',
  ].map(name => [name, { status: 'complete', calls: 1, errors: 0, unavailable: 0, rows: 1 }]));
  const basePath = claim.manifestPath.slice(0, claim.manifestPath.lastIndexOf('/'));
  const manifest = {
    schemaVersion: '3.0',
    runId: claim.sourceRunId,
    status: 'complete',
    week: { label: '2026-W39', start: claim.periodStart, end: claim.periodEnd },
    generatedAt: fixture.generatedAt,
    datasetStatuses,
    summary: {},
    completeness: {},
    warnings: [],
    artifacts: ['catalog', 'commercial', 'financial', 'insights', 'operations', 'provenance'].map(name => ({
      name,
      path: `${basePath}/${name}.json`,
      sha256: 'a'.repeat(64),
      bytes: 1,
    })),
  };
  return { claim, manifest };
}

function artifactEnvelope(name, manifest) {
  const shared = { week: structuredClone(manifest.week), generatedAt: manifest.generatedAt };
  if (name === 'commercial') return { ...shared, operational: {} };
  if (name === 'catalog') return { ...shared, currentState: {} };
  if (name === 'insights') return { ...shared, weekMetrics: {}, ranks: [] };
  if (name === 'financial') return { ...shared, settlement: {} };
  if (name === 'provenance') return {
    ...shared,
    summary: {},
    completeness: {},
    datasetStatuses: structuredClone(manifest.datasetStatuses),
    calls: [],
  };
  throw new Error(`Unsupported artifact ${name}`);
}

test('source manifest must agree exactly with the claimed run', () => {
  const context = transformer();
  const { claim, manifest } = manifestInput();
  assert.equal(context.validateManifestContract(manifest, claim).length, 6);

  const wrongStatus = structuredClone(manifest);
  wrongStatus.status = 'partial';
  assert.throws(
    () => context.validateManifestContract(wrongStatus, claim),
    error => error.code === 'SOURCE_STATUS_MISMATCH',
  );

  const wrongWeek = structuredClone(manifest);
  wrongWeek.week.label = '2026-W38';
  assert.throws(
    () => context.validateManifestContract(wrongWeek, claim),
    error => error.code === 'MANIFEST_WEEK_MISMATCH',
  );

  const wrongPath = structuredClone(manifest);
  wrongPath.artifacts[0].path = `${claim.manifestPath.slice(0, claim.manifestPath.lastIndexOf('/'))}/nested/catalog.json`;
  assert.throws(
    () => context.validateManifestContract(wrongPath, claim),
    error => error.code === 'ARTIFACT_PATH_MISMATCH',
  );
});

test('manifest dataset statuses have an exact, internally consistent shape', () => {
  const context = transformer();
  const { claim, manifest } = manifestInput();

  const missingDataset = structuredClone(manifest);
  delete missingDataset.datasetStatuses.account;
  assert.throws(
    () => context.validateManifestContract(missingDataset, claim),
    error => error.code === 'DATASET_STATUS_SET_MISMATCH',
  );

  const impossibleCounts = structuredClone(manifest);
  impossibleCounts.datasetStatuses.catalog.errors = 2;
  assert.throws(
    () => context.validateManifestContract(impossibleCounts, claim),
    error => error.code === 'INVALID_DATASET_STATUS',
  );

  const emptyArtifact = structuredClone(manifest);
  emptyArtifact.artifacts[0].bytes = 0;
  assert.throws(
    () => context.validateManifestContract(emptyArtifact, claim),
    error => error.code === 'INVALID_ARTIFACT_SIZE',
  );
});

test('parsed artifact envelopes agree with their manifest', () => {
  const context = transformer();
  const { manifest } = manifestInput();
  for (const name of ['commercial', 'catalog', 'insights', 'financial', 'provenance']) {
    assert.doesNotThrow(() => context.validateArtifactEnvelope(name, artifactEnvelope(name, manifest), manifest));
  }

  const wrongGeneratedAt = artifactEnvelope('catalog', manifest);
  wrongGeneratedAt.generatedAt = '2026-09-29T08:00:00.000Z';
  assert.throws(
    () => context.validateArtifactEnvelope('catalog', wrongGeneratedAt, manifest),
    error => error.code === 'ARTIFACT_GENERATED_AT_MISMATCH',
  );

  const wrongProvenance = artifactEnvelope('provenance', manifest);
  wrongProvenance.datasetStatuses.catalog.status = 'partial';
  assert.throws(
    () => context.validateArtifactEnvelope('provenance', wrongProvenance, manifest),
    error => error.code === 'PROVENANCE_STATUS_MISMATCH',
  );
});

test('date-only parsing requires canonical calendar-valid YYYY-MM-DD values', () => {
  const context = transformer();
  assert.equal(context.isoDate('2028-02-29'), '2028-02-29');
  assert.equal(context.isoDate('2026-02-29'), null);
  assert.equal(context.isoDate('2026-02-30'), null);
  assert.equal(context.isoDate('2026-09-21T00:00:00Z'), null);
  assert.equal(context.isoDate('2026-09-21suffix'), null);
});

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

test('an incomplete catalog blocks catalog-dependent reporting', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInput();
  loaded.manifest.datasetStatuses.catalog.status = 'partial';

  const publication = await context.buildPublication(claim, loaded);
  const revisions = new Map(publication.dataProductRevisions.map(row => [row.data_product, row]));
  assert.equal(publication.weeklyReport.status, 'not_ready');
  assert.equal(revisions.get('catalog_offers').status, 'not_ready');
  assert.equal(revisions.get('product_visits').status, 'not_ready');
  assert.equal(revisions.get('keyword_ranks').status, 'not_ready');
  assert.equal(revisions.get('buy_box').status, 'not_ready');
  assert.equal(publication.qualityChecks.some(row => row.check_code === 'CATALOG_SOURCE_VALID' && row.result === 'failed'), true);
  assert.equal(publication.steps.find(row => row.step_code === 'catalog').status, 'failed');
  assert.equal(publication.steps.find(row => row.step_code === 'quality').status, 'failed');
});

test('a sold product missing from the current catalog cannot hide missing visits', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInput();
  const missingEan = '8720892887528';
  loaded.artifacts.catalog.currentState.offers = loaded.artifacts.catalog.currentState.offers
    .filter(row => row.ean !== missingEan);
  loaded.artifacts.insights.weekMetrics.offerInsights = loaded.artifacts.insights.weekMetrics.offerInsights
    .filter(row => row.ean !== missingEan);
  loaded.artifacts.insights.ranks = loaded.artifacts.insights.ranks
    .filter(row => row.ean !== missingEan);

  const publication = await context.buildPublication(claim, loaded);
  const soldProduct = publication.weeklyReport.metrics.find(row => row.ean === missingEan);
  assert.ok(soldProduct);
  assert.equal(soldProduct.gross_shipped_units, 11);
  assert.equal(soldProduct.product_visits, null);
  assert.equal(publication.weeklyReport.metrics.every(row => row.product_visits === null), true);
  assert.equal(publication.weeklyReport.status, 'not_ready');
  assert.equal(publication.qualityChecks.some(row => row.check_code === 'PRODUCT_VISIT_DATE_COVERAGE' && row.result === 'failed'), true);
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

test('shipment quantity rejects every non-number or non-positive-int32 raw value', async () => {
  const invalidQuantities = [undefined, null, true, 1.9, '1.9', '2', '1e3', ' 2 ', 0, -1, 2_147_483_648, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity];
  for (const invalidQuantity of invalidQuantities) {
    const context = transformer();
    const { claim, loaded } = canonicalInput();
    loaded.artifacts.commercial.operational.shipmentDetails[0]
      .detail.shipmentItems[0].quantityShipped = invalidQuantity;
    let publication;
    await assert.rejects(
      async () => { publication = await context.buildPublication(claim, loaded); },
      error => error.code === 'INVALID_SHIPMENT_QUANTITY',
    );
    assert.equal(publication, undefined);
  }
});

test('shipment quantity accepts a positive int32 JSON number without coercion', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInput();
  loaded.artifacts.commercial.operational.shipmentDetails[0]
    .detail.shipmentItems[0].quantityShipped = 2;
  const publication = await context.buildPublication(claim, loaded);
  const fact = publication.facts.outbound_shipment_items
    .find(row => row.shipment_id === 'shipment-1');
  const metric = publication.weeklyReport.metrics.find(row => row.ean === '6970452112658');
  assert.equal(fact.quantity_shipped, 2);
  assert.equal(metric.gross_shipped_units, 2);
});

test('shipment monetary fields reject coercible or imprecise source values', async () => {
  const invalidValues = [undefined, null, true, [], {}, '', '1.00', ' 1 ', 1e-7, 0.12345678901234567, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, -1];
  for (const [field, code] of [['unitPrice', 'INVALID_SHIPMENT_UNIT_PRICE'], ['commission', 'INVALID_SHIPMENT_COMMISSION']]) {
    for (const invalidValue of invalidValues) {
      const context = transformer();
      const { claim, loaded } = canonicalInput();
      loaded.artifacts.commercial.operational.shipmentDetails[0]
        .detail.shipmentItems[0][field] = invalidValue;
      let publication;
      await assert.rejects(
        async () => { publication = await context.buildPublication(claim, loaded); },
        error => error.code === code,
      );
      assert.equal(publication, undefined);
    }
  }
});

test('shipment monetary fields accept exact zero and positive JSON numbers', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInput();
  const item = loaded.artifacts.commercial.operational.shipmentDetails[0].detail.shipmentItems[0];
  item.unitPrice = 0;
  item.commission = 0;
  const publication = await context.buildPublication(claim, loaded);
  const fact = publication.facts.outbound_shipment_items.find(row => row.shipment_id === 'shipment-1');
  assert.equal(fact.unit_price, 0);
  assert.equal(fact.commission, 0);
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

test('return quantity rejects every non-number or non-positive-int32 raw value', async () => {
  const invalidQuantities = [undefined, null, true, 1.9, '1.9', '2', '1e3', ' 2 ', 0, -1, 2_147_483_648, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity];
  for (const invalidQuantity of invalidQuantities) {
    const context = transformer();
    const { claim, loaded } = canonicalInput();
    loaded.artifacts.commercial.operational.returns[0]
      .returnItems[0].expectedQuantity = invalidQuantity;
    let publication;
    await assert.rejects(
      async () => { publication = await context.buildPublication(claim, loaded); },
      error => error.code === 'INVALID_RETURN_QUANTITY',
    );
    assert.equal(publication, undefined);
  }
});

test('return quantity accepts a positive int32 JSON number without coercion', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInput();
  const linkedReturn = loaded.artifacts.commercial.operational.returns
    .flatMap(row => row.returnItems)
    .find(item => item.ean === '8720892887504');
  linkedReturn.expectedQuantity = 2;
  const publication = await context.buildPublication(claim, loaded);
  const fact = publication.facts.return_items.find(row => row.rma_id === linkedReturn.rmaId);
  const metric = publication.weeklyReport.metrics.find(row => row.ean === linkedReturn.ean);
  assert.equal(fact.expected_quantity, 2);
  assert.equal(metric.linked_return_units, 2);
});

test('shipment and return quantities accept the PostgreSQL int32 maximum', async () => {
  const shipmentContext = transformer();
  const shipmentInput = canonicalInput();
  const shipmentItem = shipmentInput.loaded.artifacts.commercial.operational.shipmentDetails[0].detail.shipmentItems[0];
  shipmentItem.quantityShipped = 2_147_483_647;
  shipmentItem.unitPrice = 0;
  shipmentItem.commission = 0;
  const shipmentPublication = await shipmentContext.buildPublication(shipmentInput.claim, shipmentInput.loaded);
  assert.equal(
    shipmentPublication.weeklyReport.metrics.find(row => row.ean === '6970452112658').gross_shipped_units,
    2_147_483_647,
  );

  const returnContext = transformer();
  const returnInput = canonicalInput();
  const returnItem = returnInput.loaded.artifacts.commercial.operational.returns[0].returnItems[0];
  returnItem.expectedQuantity = 2_147_483_647;
  const returnPublication = await returnContext.buildPublication(returnInput.claim, returnInput.loaded);
  assert.equal(
    returnPublication.weeklyReport.metrics.find(row => row.ean === returnItem.ean).unlinked_return_units,
    2_147_483_647,
  );
});

test('per-EAN shipment quantity aggregate overflow fails before publication', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInput();
  const first = loaded.artifacts.commercial.operational.shipmentDetails[0];
  first.detail.shipmentItems[0].quantityShipped = 2_147_483_647;
  first.detail.shipmentItems[0].unitPrice = 0;
  first.detail.shipmentItems[0].commission = 0;
  const second = structuredClone(first);
  second.shipmentId = 'shipment-int32-overflow';
  second.detail.shipmentId = 'shipment-int32-overflow';
  second.detail.order.orderId = 'order-int32-overflow';
  second.detail.shipmentItems[0].orderItemId = 'order-item-int32-overflow';
  second.detail.shipmentItems[0].quantityShipped = 1;
  loaded.artifacts.commercial.operational.shipmentDetails.push(second);
  let publication;
  await assert.rejects(
    async () => { publication = await context.buildPublication(claim, loaded); },
    error => error.code === 'WEEKLY_INTEGER_OUT_OF_RANGE',
  );
  assert.equal(publication, undefined);
});

test('grouped return quantity aggregate overflow fails before publication', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInput();
  const shipment = loaded.artifacts.commercial.operational.shipmentDetails
    .find(row => row.detail.order.orderId === 'order-2');
  shipment.detail.shipmentItems[0].quantityShipped = 2_147_483_647;
  shipment.detail.shipmentItems[0].unitPrice = 0;
  shipment.detail.shipmentItems[0].commission = 0;
  const returnCase = loaded.artifacts.commercial.operational.returns
    .find(row => row.returnItems.some(item => item.ean === '8720892887504'));
  const original = returnCase.returnItems[0];
  original.expectedQuantity = 2_147_483_647;
  returnCase.returnItems.push({ ...structuredClone(original), rmaId: 'rma-int32-overflow', expectedQuantity: 1 });
  let publication;
  await assert.rejects(
    async () => { publication = await context.buildPublication(claim, loaded); },
    error => error.code === 'RETURN_QUANTITY_AGGREGATE_OUT_OF_RANGE',
  );
  assert.equal(publication, undefined);
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
  assert.equal(publication.exceptions.some(row => row.exception_code === 'RETURN_GROUP_QUANTITY_EXCEEDS_SHIPMENT'), true);
});

test('valid cumulative return allocation is permutation-invariant', async () => {
  const runPermutation = async reverse => {
    const context = transformer();
    const { claim, loaded } = canonicalInput();
    const returnCase = loaded.artifacts.commercial.operational.returns
      .find(row => row.returnItems.some(item => item.ean === '8720892887504'));
    const original = structuredClone(returnCase.returnItems[0]);
    const returns = [
      { ...original, rmaId: 'rma-valid-a', expectedQuantity: 1 },
      { ...original, rmaId: 'rma-valid-b', expectedQuantity: 3 },
    ];
    returnCase.returnItems = reverse ? returns.reverse() : returns;
    const publication = await context.buildPublication(claim, loaded);
    return publication.weeklyReport.metrics.find(row => row.ean === '8720892887504');
  };

  const forward = await runPermutation(false);
  const reversed = await runPermutation(true);
  for (const metric of [forward, reversed]) {
    assert.equal(metric.linked_return_units, 4);
    assert.equal(metric.unlinked_return_units, 0);
    assert.equal(metric.linked_return_gms, metric.gross_shipped_gms);
    assert.equal(metric.linked_return_commission, metric.gross_commission);
    assert.equal(metric.provisional_net_gms, 0);
    assert.equal(metric.provisional_revenue_after_commission, 0);
  }
  assert.equal(
    JSON.stringify(forward.calculation_trace.minorUnits),
    JSON.stringify(reversed.calculation_trace.minorUnits),
  );
});

test('a full return reverses the exact recurring-decimal shipment total and commission', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInput();
  const linkedReturn = loaded.artifacts.commercial.operational.returns
    .flatMap(row => row.returnItems)
    .find(item => item.ean === '8720892887504');
  linkedReturn.orderId = 'order-3';
  linkedReturn.ean = '8720892887511';
  linkedReturn.expectedQuantity = 7;

  const publication = await context.buildPublication(claim, loaded);
  const metric = publication.weeklyReport.metrics.find(row => row.ean === '8720892887511');
  assert.equal(metric.gross_shipped_gms, 206.93);
  assert.equal(metric.linked_return_gms, 206.93);
  assert.equal(metric.provisional_net_gms, 0);
  assert.equal(metric.gross_commission, 39.1);
  assert.equal(metric.linked_return_commission, 39.1);
  assert.equal(metric.provisional_revenue_after_commission, 0);
});

test('a partial return uses the exact shipment-line valuation ratio', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInput();
  const linkedReturn = loaded.artifacts.commercial.operational.returns
    .flatMap(row => row.returnItems)
    .find(item => item.ean === '8720892887504');
  linkedReturn.orderId = 'order-3';
  linkedReturn.ean = '8720892887511';
  linkedReturn.expectedQuantity = 3;

  const publication = await context.buildPublication(claim, loaded);
  const metric = publication.weeklyReport.metrics.find(row => row.ean === '8720892887511');
  assert.equal(metric.linked_return_units, 3);
  assert.equal(metric.linked_return_gms, 88.68);
  assert.equal(metric.linked_return_commission, 16.76);
  assert.equal(metric.provisional_net_gms, 118.25);
  assert.equal(metric.provisional_revenue_after_commission, 95.91);
  const minor = Object.fromEntries(
    Object.entries(metric.calculation_trace.minorUnits).map(([key, value]) => [key, BigInt(value)]),
  );
  assert.equal(minor.linkedReturnGms, 8868n);
  assert.equal(minor.linkedReturnCommission, 1676n);
  assert.equal(minor.provisionalNetGms, minor.grossShippedGms - minor.linkedReturnGms);
  assert.equal(
    minor.provisionalRevenueAfterCommission,
    minor.provisionalNetGms - (minor.grossCommission - minor.linkedReturnCommission),
  );
});

test('a 20.15 line allocated one-half rounds deterministically to 10.08', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInput();
  const shipment = loaded.artifacts.commercial.operational.shipmentDetails
    .find(row => row.detail.order.orderId === 'order-3');
  shipment.detail.shipmentItems[0].quantityShipped = 2;
  shipment.detail.shipmentItems[0].unitPrice = 10.075;
  shipment.detail.shipmentItems[0].commission = 0;
  const linkedReturn = loaded.artifacts.commercial.operational.returns
    .flatMap(row => row.returnItems)
    .find(item => item.ean === '8720892887504');
  linkedReturn.orderId = 'order-3';
  linkedReturn.ean = '8720892887511';
  linkedReturn.expectedQuantity = 1;

  const publication = await context.buildPublication(claim, loaded);
  const metric = publication.weeklyReport.metrics.find(row => row.ean === '8720892887511');
  assert.equal(metric.gross_shipped_gms, 20.15);
  assert.equal(metric.linked_return_gms, 10.08);
  assert.equal(metric.provisional_net_gms, 10.07);
  assert.equal(metric.gross_shipped_asp, 10.075);
  assert.equal(metric.calculation_trace.minorUnits.linkedReturnGms, '1008');
  assert.equal(context.allocateMinor(-2015n, 1, 2), -1008n);
});

test('multiple shipment lines aggregate and reconcile in exact minor units', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInput();
  const primary = loaded.artifacts.commercial.operational.shipmentDetails
    .find(row => row.detail.order.orderId === 'order-2');
  const primaryItem = primary.detail.shipmentItems[0];
  primaryItem.quantityShipped = 1;
  primaryItem.unitPrice = 10.01;
  primaryItem.commission = 1.01;

  const second = structuredClone(primary);
  second.shipmentId = 'shipment-minor-second';
  second.detail.shipmentId = 'shipment-minor-second';
  second.detail.order.orderId = 'order-minor-second';
  second.detail.shipmentItems[0].orderItemId = 'order-item-minor-second';
  second.detail.shipmentItems[0].unitPrice = 10.02;
  second.detail.shipmentItems[0].commission = 1.02;
  loaded.artifacts.commercial.operational.shipmentDetails.push(second);

  const linkedReturn = loaded.artifacts.commercial.operational.returns
    .flatMap(row => row.returnItems)
    .find(item => item.ean === '8720892887504');
  linkedReturn.expectedQuantity = 1;

  const publication = await context.buildPublication(claim, loaded);
  const metric = publication.weeklyReport.metrics.find(row => row.ean === '8720892887504');
  const minor = Object.fromEntries(
    Object.entries(metric.calculation_trace.minorUnits).map(([key, value]) => [key, BigInt(value)]),
  );
  assert.equal(metric.gross_shipped_units, 2);
  assert.equal(metric.gross_shipped_gms, 20.03);
  assert.equal(metric.linked_return_gms, 10.01);
  assert.equal(metric.provisional_net_gms, 10.02);
  assert.equal(metric.gross_commission, 2.03);
  assert.equal(metric.linked_return_commission, 1.01);
  assert.equal(metric.provisional_revenue_after_commission, 9);
  assert.equal(metric.gross_shipped_asp, 10.015);
  assert.equal(minor.provisionalNetGms, minor.grossShippedGms - minor.linkedReturnGms);
  assert.equal(
    minor.provisionalRevenueAfterCommission,
    minor.provisionalNetGms - (minor.grossCommission - minor.linkedReturnCommission),
  );
});

test('revenue after commission can be negative without unsigned rounding artifacts', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInput();
  const shipment = loaded.artifacts.commercial.operational.shipmentDetails
    .find(row => row.detail.order.orderId === 'order-4');
  shipment.detail.shipmentItems[0].quantityShipped = 1;
  shipment.detail.shipmentItems[0].unitPrice = 1;
  shipment.detail.shipmentItems[0].commission = 2;

  const publication = await context.buildPublication(claim, loaded);
  const metric = publication.weeklyReport.metrics.find(row => row.ean === '8720892887528');
  assert.equal(metric.gross_shipped_gms, 1);
  assert.equal(metric.gross_commission, 2);
  assert.equal(metric.provisional_net_gms, 1);
  assert.equal(metric.provisional_revenue_after_commission, -1);
  assert.equal(metric.calculation_trace.minorUnits.provisionalRevenueAfterCommission, '-100');
});

test('cumulative return overflow is permutation-invariant and wholly unallocated', async () => {
  const runPermutation = async reverse => {
    const context = transformer();
    const { claim, loaded } = canonicalInput();
    const returnCase = loaded.artifacts.commercial.operational.returns
      .find(row => row.returnItems.some(item => item.ean === '8720892887504'));
    const original = structuredClone(returnCase.returnItems[0]);
    const returns = [
      { ...original, rmaId: 'rma-overflow-a', expectedQuantity: 1 },
      { ...original, rmaId: 'rma-overflow-b', expectedQuantity: 4 },
    ];
    returnCase.returnItems = reverse ? returns.reverse() : returns;
    const publication = await context.buildPublication(claim, loaded);
    const metric = publication.weeklyReport.metrics.find(row => row.ean === '8720892887504');
    const overflow = publication.exceptions.find(row => row.exception_code === 'RETURN_GROUP_QUANTITY_EXCEEDS_SHIPMENT');
    return { metric, overflow };
  };

  const forward = await runPermutation(false);
  const reversed = await runPermutation(true);
  for (const result of [forward, reversed]) {
    assert.equal(result.metric.linked_return_units, 0);
    assert.equal(result.metric.unlinked_return_units, 5);
    assert.equal(result.metric.linked_return_gms, 0);
    assert.equal(result.metric.linked_return_commission, 0);
    assert.equal(result.overflow.evidence.aggregateReturnQuantity, 5);
    assert.equal(result.overflow.evidence.shipmentQuantity, 4);
    assert.deepEqual(
      Array.from(result.overflow.evidence.returnItems, item => item.rmaId),
      ['rma-overflow-a', 'rma-overflow-b'],
    );
  }
  assert.deepEqual(
    {
      linked: forward.metric.linked_return_units,
      unlinked: forward.metric.unlinked_return_units,
      gms: forward.metric.linked_return_gms,
      commission: forward.metric.linked_return_commission,
    },
    {
      linked: reversed.metric.linked_return_units,
      unlinked: reversed.metric.unlinked_return_units,
      gms: reversed.metric.linked_return_gms,
      commission: reversed.metric.linked_return_commission,
    },
  );
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

test('seven valid insight dates plus an out-of-week date fail closed', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInput();
  const visits = loaded.artifacts.insights.weekMetrics.offerInsights.find(row => row.metric === 'PRODUCT_VISITS');
  visits.periods.push({
    period: { year: 2026, month: 9, day: 28 },
    total: 1,
    countries: [{ countryCode: 'NL', value: 1 }],
  });
  await assert.rejects(
    context.buildPublication(claim, loaded),
    error => error.code === 'OUT_OF_PERIOD_INSIGHT',
  );
});

test('a malformed insight row cannot hide beside valid weekly coverage', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInput();
  loaded.artifacts.insights.weekMetrics.offerInsights.push({
    ean: 'invalid-ean',
    offerId: 'offer-invalid',
    metric: 'PRODUCT_VISITS',
    periods: [],
  });
  await assert.rejects(
    context.buildPublication(claim, loaded),
    error => error.code === 'INVALID_INSIGHT_EAN',
  );
});

test('an unsupported insight metric cannot hide beside valid weekly coverage', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInput();
  const malformed = structuredClone(loaded.artifacts.insights.weekMetrics.offerInsights[0]);
  malformed.metric = 'UNKNOWN_METRIC';
  loaded.artifacts.insights.weekMetrics.offerInsights.push(malformed);
  await assert.rejects(
    context.buildPublication(claim, loaded),
    error => error.code === 'INVALID_INSIGHT_METRIC',
  );
});

test('an insight-only foreign EAN is rejected', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInput();
  const foreign = structuredClone(loaded.artifacts.insights.weekMetrics.offerInsights[0]);
  foreign.ean = '1234567890123';
  foreign.offerId = 'offer-foreign';
  loaded.artifacts.insights.weekMetrics.offerInsights.push(foreign);
  await assert.rejects(
    context.buildPublication(claim, loaded),
    error => error.code === 'INSIGHT_EAN_WITHOUT_SOURCE_IDENTITY',
  );
});

test('a catalog EAN with an unknown wrong offer ID is rejected', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInput();
  loaded.artifacts.insights.weekMetrics.offerInsights[0].offerId = 'offer-wrong';
  await assert.rejects(
    context.buildPublication(claim, loaded),
    error => error.code === 'INSIGHT_OFFER_ID_MISMATCH',
  );
});

test('using another catalog product offer ID is rejected explicitly', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInput();
  loaded.artifacts.insights.weekMetrics.offerInsights[0].offerId = 'offer-steel-carafe';
  await assert.rejects(
    context.buildPublication(claim, loaded),
    error => error.code === 'INSIGHT_OFFER_ID_BELONGS_TO_DIFFERENT_EAN',
  );
});

test('an exact catalog EAN and offer pair is accepted', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInput();
  const publication = await context.buildPublication(claim, loaded);
  const rows = publication.facts.offer_insight_daily
    .filter(row => row.ean === '8720892887504');
  assert.ok(rows.length > 0);
  assert.equal(rows.every(row => row.offer_id === 'offer-fruit-carafe'), true);
});

test('a commercial-only EAN keeps valid insight evidence after leaving the catalog', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInput();
  const commercialOnlyEan = '8720892887511';
  loaded.artifacts.catalog.currentState.offers = loaded.artifacts.catalog.currentState.offers
    .filter(row => row.ean !== commercialOnlyEan);
  loaded.artifacts.insights.ranks = loaded.artifacts.insights.ranks
    .filter(row => row.ean !== commercialOnlyEan);

  const publication = await context.buildPublication(claim, loaded);
  const rows = publication.facts.offer_insight_daily
    .filter(row => row.ean === commercialOnlyEan);
  assert.ok(rows.length > 0);
  assert.equal(rows.every(row => row.offer_id === 'offer-steel-carafe'), true);
  assert.ok(publication.weeklyReport.metrics.some(row => row.ean === commercialOnlyEan));
});

test('a commercial-only EAN rejects an unknown offer ID', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInput();
  const ean = '8720892887511';
  loaded.artifacts.catalog.currentState.offers = loaded.artifacts.catalog.currentState.offers
    .filter(row => row.ean !== ean);
  loaded.artifacts.insights.ranks = loaded.artifacts.insights.ranks.filter(row => row.ean !== ean);
  for (const insight of loaded.artifacts.insights.weekMetrics.offerInsights.filter(row => row.ean === ean)) {
    insight.offerId = 'offer-typo';
  }
  await assert.rejects(
    context.buildPublication(claim, loaded),
    error => error.code === 'INSIGHT_COMMERCIAL_OFFER_ID_MISMATCH',
  );
});

test('a commercial-only EAN rejects an offer ID belonging to another EAN', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInput();
  const ean = '8720892887511';
  loaded.artifacts.catalog.currentState.offers = loaded.artifacts.catalog.currentState.offers
    .filter(row => row.ean !== ean);
  loaded.artifacts.insights.ranks = loaded.artifacts.insights.ranks.filter(row => row.ean !== ean);
  for (const insight of loaded.artifacts.insights.weekMetrics.offerInsights.filter(row => row.ean === ean)) {
    insight.offerId = 'offer-fruit-carafe';
  }
  await assert.rejects(
    context.buildPublication(claim, loaded),
    error => error.code === 'INSIGHT_OFFER_ID_BELONGS_TO_DIFFERENT_EAN',
  );
});

test('a commercial-only EAN rejects conflicting historical shipment offer IDs', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInput();
  const ean = '8720892887511';
  loaded.artifacts.catalog.currentState.offers = loaded.artifacts.catalog.currentState.offers
    .filter(row => row.ean !== ean);
  loaded.artifacts.insights.ranks = loaded.artifacts.insights.ranks.filter(row => row.ean !== ean);
  const alternate = structuredClone(
    loaded.artifacts.commercial.operational.shipmentDetails.find(row => row.detail.order.orderId === 'order-3'),
  );
  alternate.shipmentId = 'shipment-steel-alternate';
  alternate.detail.shipmentId = 'shipment-steel-alternate';
  alternate.detail.order.orderId = 'order-steel-alternate';
  alternate.detail.shipmentItems[0].orderItemId = 'order-item-steel-alternate';
  alternate.detail.shipmentItems[0].offer.offerId = 'offer-steel-alternate';
  loaded.artifacts.commercial.operational.shipmentDetails.push(alternate);
  await assert.rejects(
    context.buildPublication(claim, loaded),
    error => error.code === 'INSIGHT_COMMERCIAL_OFFER_IDENTITY_AMBIGUOUS',
  );
});

test('a return-only EAN cannot establish a trusted insight offer identity', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInput();
  const ean = '1234567890123';
  loaded.artifacts.commercial.operational.returns[0].returnItems.push({
    rmaId: 'rma-return-only', orderId: 'order-absent', ean, expectedQuantity: 1, handled: false,
  });
  const insight = structuredClone(loaded.artifacts.insights.weekMetrics.offerInsights[0]);
  insight.ean = ean;
  insight.offerId = 'offer-return-only';
  loaded.artifacts.insights.weekMetrics.offerInsights.push(insight);
  await assert.rejects(
    context.buildPublication(claim, loaded),
    error => error.code === 'INSIGHT_COMMERCIAL_OFFER_IDENTITY_MISSING',
  );
});

test('canonical direct insight dates are accepted without truncation', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInput();
  const visits = loaded.artifacts.insights.weekMetrics.offerInsights.find(row => row.metric === 'PRODUCT_VISITS');
  visits.periods[0].date = '2026-09-21';
  delete visits.periods[0].period;
  await assert.doesNotReject(context.buildPublication(claim, loaded));
});

test('an insight date with a suffix fails closed', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInput();
  const visits = loaded.artifacts.insights.weekMetrics.offerInsights.find(row => row.metric === 'PRODUCT_VISITS');
  visits.periods[0].date = '2026-09-21T00:00:00Z';
  delete visits.periods[0].period;
  await assert.rejects(
    context.buildPublication(claim, loaded),
    error => error.code === 'INVALID_INSIGHT_DATE',
  );
});

test('an impossible structured insight date fails closed', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInput();
  const visits = loaded.artifacts.insights.weekMetrics.offerInsights.find(row => row.metric === 'PRODUCT_VISITS');
  visits.periods[0].period = { year: 2026, month: 2, day: 30 };
  await assert.rejects(
    context.buildPublication(claim, loaded),
    error => error.code === 'INVALID_INSIGHT_DATE',
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

test('weekly product-visit aggregate overflow fails before publication', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInput();
  const visits = loaded.artifacts.insights.weekMetrics.offerInsights.find(row => row.metric === 'PRODUCT_VISITS');
  visits.periods[0].total = 2_147_483_647;
  visits.periods[1].total = 1;
  let publication;
  await assert.rejects(
    async () => { publication = await context.buildPublication(claim, loaded); },
    error => error.code === 'WEEKLY_INTEGER_OUT_OF_RANGE',
  );
  assert.equal(publication, undefined);
});

test('product-visit totals require nonnegative int32 JSON numbers', async () => {
  const invalidTotals = [null, true, 1.5, '1', ' 1 ', -1, 2_147_483_648, NaN, Infinity];
  for (const invalidTotal of invalidTotals) {
    const context = transformer();
    const { claim, loaded } = canonicalInput();
    const visits = loaded.artifacts.insights.weekMetrics.offerInsights.find(row => row.metric === 'PRODUCT_VISITS');
    visits.periods[0].total = invalidTotal;
    await assert.rejects(
      context.buildPublication(claim, loaded),
      error => error.code === 'INVALID_PRODUCT_VISIT_TOTAL',
    );
  }
});

test('canonical rank dates are accepted exactly', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInput();
  const publication = await context.buildPublication(claim, loaded);
  assert.equal(publication.facts.keyword_rank_daily[0].rank_date, '2026-09-21');
});

test('rank dates reject timestamp suffixes and impossible calendar dates', async () => {
  for (const invalidDate of ['2026-09-21T00:00:00Z', '2026-02-30']) {
    const context = transformer();
    const { claim, loaded } = canonicalInput();
    loaded.artifacts.insights.ranks[0].date = invalidDate;
    await assert.rejects(
      context.buildPublication(claim, loaded),
      error => error.code === 'INVALID_RANK_DATE',
    );
  }
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

test('order-item monetary facts use strict decimals and exact derived totals', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInput();
  loaded.artifacts.commercial.operational.ordersFromShipmentDetails = [{
    status: 200,
    detail: {
      orderId: 'demand-order-1',
      orderPlacedDateTime: '2026-09-21T10:00:00+02:00',
      orderItems: [{
        orderItemId: 'demand-item-1',
        product: { ean: '8720892887504', title: 'Fruit carafe' },
        offer: { offerId: 'offer-fruit-carafe' },
        fulfilment: { method: 'FBR', distributionParty: 'RETAILER' },
        quantity: 2,
        quantityShipped: 0,
        quantityCancelled: 0,
        unitPrice: 10.015,
      }],
    },
  }];
  const publication = await context.buildPublication(claim, loaded);
  const fact = publication.facts.order_items[0];
  assert.equal(fact.unit_price, 10.02);
  assert.equal(fact.total_price, 20.03);
  assert.equal(fact.commission, null);

  const invalidContext = transformer();
  const invalidInput = canonicalInput();
  invalidInput.loaded.artifacts.commercial.operational.ordersFromShipmentDetails = structuredClone(
    loaded.artifacts.commercial.operational.ordersFromShipmentDetails,
  );
  invalidInput.loaded.artifacts.commercial.operational.ordersFromShipmentDetails[0]
    .detail.orderItems[0].unitPrice = '10.01';
  await assert.rejects(
    invalidContext.buildPublication(invalidInput.claim, invalidInput.loaded),
    error => error.code === 'INVALID_ORDER_ITEM_UNIT_PRICE',
  );
});

test('commission estimates preserve absent optionals and reject malformed financial values', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInput();
  loaded.artifacts.catalog.currentState.commissions = [{
    ean: '8720892887504', status: 200, unitPrice: 0, result: {},
  }];
  const publication = await context.buildPublication(claim, loaded);
  const fact = publication.facts.commission_estimates[0];
  assert.equal(fact.unit_price, 0);
  assert.equal(fact.fixed_amount, null);
  assert.equal(fact.percentage, null);
  assert.equal(fact.total_cost, null);

  const invalidCases = [
    ['unitPrice', 'INVALID_COMMISSION_ESTIMATE_UNIT_PRICE', '1.00'],
    ['fixedAmount', 'INVALID_COMMISSION_FIXED_AMOUNT', true],
    ['percentage', 'INVALID_COMMISSION_PERCENTAGE', 100.000001],
    ['totalCost', 'INVALID_COMMISSION_TOTAL_COST', {}],
  ];
  for (const [field, code, invalidValue] of invalidCases) {
    const invalidContext = transformer();
    const invalidInput = canonicalInput();
    const row = { ean: '8720892887504', status: 200, unitPrice: 1, result: {} };
    if (field === 'unitPrice') row.unitPrice = invalidValue;
    else row.result[field] = invalidValue;
    invalidInput.loaded.artifacts.catalog.currentState.commissions = [row];
    await assert.rejects(
      invalidContext.buildPublication(invalidInput.claim, invalidInput.loaded),
      error => error.code === code,
    );
  }
});

test('valid invoice decimals preserve exact signs and optional nulls', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInvoiceInput();
  loaded.artifacts.financial.settlement.invoiceSpecifications[0].lines.push({
    invoiceLineRef: 'line-optional-null',
    type: 'ADJUSTMENT',
    lineExtensionAmount: { amount: 0, currencyID: 'EUR' },
  });
  const publication = await context.buildPublication(claim, loaded);
  const header = publication.facts.invoice_headers[0];
  const line = publication.facts.invoice_transactions.find(row => row.invoice_line_ref === 'line-1');
  const optional = publication.facts.invoice_transactions.find(row => row.invoice_line_ref === 'line-optional-null');
  assert.equal(header.payable_amount, '12.34');
  assert.equal(header.tax_exclusive_amount, '10.2');
  assert.equal(line.quantity, '-1.25');
  assert.equal(line.line_extension_amount, '-12.3456');
  assert.equal(line.tax_amount, '-2.1456');
  assert.equal(line.source_sign, '-12.3456');
  assert.equal(line.settlement_effect, '12.3456');
  assert.equal(optional.line_extension_amount, '0');
  assert.equal(optional.quantity, null);
  assert.equal(optional.price_amount, null);
  assert.equal(optional.tax_amount, null);
  assert.equal(optional.tax_percentage, null);
  assert.equal(publication.dataProductRevisions.find(row => row.data_product === 'invoices').status, 'ready');
});

test('optional invoice header totals remain null only when absent', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInvoiceInput();
  delete loaded.artifacts.financial.settlement.invoices[0].legalMonetaryTotal.taxExclusiveAmount;
  delete loaded.artifacts.financial.settlement.invoices[0].legalMonetaryTotal.taxInclusiveAmount;
  const publication = await context.buildPublication(claim, loaded);
  assert.equal(publication.facts.invoice_headers[0].tax_exclusive_amount, null);
  assert.equal(publication.facts.invoice_headers[0].tax_inclusive_amount, null);

  for (const [field, code] of [['taxExclusiveAmount', 'INVALID_INVOICE_TAX_EXCLUSIVE_AMOUNT'], ['taxInclusiveAmount', 'INVALID_INVOICE_TAX_INCLUSIVE_AMOUNT']]) {
    const invalidContext = transformer();
    const invalidInput = canonicalInvoiceInput();
    invalidInput.loaded.artifacts.financial.settlement.invoices[0].legalMonetaryTotal[field] = ' 10.00 ';
    await assert.rejects(
      invalidContext.buildPublication(invalidInput.claim, invalidInput.loaded),
      error => error.code === code,
    );
  }
});

test('required invoice payable and line amounts reject malformed source values', async () => {
  const invalidValues = [undefined, null, true, [], {}, '', '1.00', ' 1 ', 1e-7, 0.12345678901234567, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity];
  for (const [target, code] of [['payable', 'INVALID_INVOICE_PAYABLE_AMOUNT'], ['line', 'INVALID_INVOICE_LINE_AMOUNT']]) {
    for (const invalidValue of invalidValues) {
      const context = transformer();
      const { claim, loaded } = canonicalInvoiceInput();
      if (target === 'payable') loaded.artifacts.financial.settlement.invoices[0].legalMonetaryTotal.payableAmount = invalidValue;
      else loaded.artifacts.financial.settlement.invoiceSpecifications[0].lines[0].lineExtensionAmount = invalidValue;
      let publication;
      await assert.rejects(
        async () => { publication = await context.buildPublication(claim, loaded); },
        error => error.code === code,
      );
      assert.equal(publication, undefined);
    }
  }
});

test('optional invoice decimals remain null only when absent and reject malformed values', async () => {
  const cases = [
    ['quantity', 'INVALID_INVOICE_QUANTITY'],
    ['priceAmount', 'INVALID_INVOICE_PRICE_AMOUNT'],
    ['taxAmount', 'INVALID_INVOICE_TAX_AMOUNT'],
    ['taxPercentage', 'INVALID_INVOICE_TAX_PERCENTAGE'],
  ];
  const invalidValues = [true, [], {}, '', '1', ' 1 ', 1e-7, 0.12345678901234567, NaN, Infinity];
  for (const [field, code] of cases) {
    for (const invalidValue of invalidValues) {
      const context = transformer();
      const { claim, loaded } = canonicalInvoiceInput();
      loaded.artifacts.financial.settlement.invoiceSpecifications[0].lines[0][field] = invalidValue;
      let publication;
      await assert.rejects(
        async () => { publication = await context.buildPublication(claim, loaded); },
        error => error.code === code,
      );
      assert.equal(publication, undefined);
    }
  }
});

test('invoice tax percentage rejects values outside zero through one hundred', async () => {
  for (const invalidValue of [-1, 100.0001]) {
    const context = transformer();
    const { claim, loaded } = canonicalInvoiceInput();
    loaded.artifacts.financial.settlement.invoiceSpecifications[0].lines[0].taxPercentage = invalidValue;
    await assert.rejects(
      context.buildPublication(claim, loaded),
      error => error.code === 'INVALID_INVOICE_TAX_PERCENTAGE',
    );
  }
});

test('negative invoice payable values remain exact for credit documents', async () => {
  const context = transformer();
  const { claim, loaded } = canonicalInvoiceInput();
  loaded.artifacts.financial.settlement.invoices[0].legalMonetaryTotal.payableAmount = { amount: -12.34, currencyID: 'EUR' };
  const publication = await context.buildPublication(claim, loaded);
  assert.equal(publication.facts.invoice_headers[0].payable_amount, '-12.34');
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
