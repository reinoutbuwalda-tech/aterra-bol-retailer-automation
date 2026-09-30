import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../supabase/functions/bol-retailer-weekly-extract/index.ts', import.meta.url), 'utf8');
function collector(responses = []) {
  const context = vm.createContext({
    Response, Request, URL, Headers, Blob, AbortSignal, AbortController, DOMException, TextEncoder,
    crypto: globalThis.crypto, setTimeout: (fn) => { fn(); return 0; }, clearTimeout() {},
    Deno: { serve() {}, env: { get() { return 'test'; } } },
    fetch: async () => {
      const response = responses.shift();
      if (!response) throw new Error('Unexpected request');
      return new Response(JSON.stringify(response.body), { status: response.status ?? 200 });
    },
  });
  vm.runInContext(stripTypeScriptTypes(source.replace(/^import .*\n/, '')), context);
  return context;
}
function state(maxPages = 2) {
  return { args: { start: '2026-09-14', end: '2026-09-20', rankMode: 'primary', maxPages }, token: 'test', apiCalls: [], paginationWarnings: [] };
}

test('personal data is removed while business IDs and country remain exact', () => {
  const result = collector().sanitize({
    orderId: 'C000-EXACT-ID',
    trackAndTrace: '3S-EXACT-ID',
    customerComments: 'private',
    billingDetails: { countryCode: 'NL', email: 'private' },
    child: { secret: 'private' },
    ean: '123',
  });
  assert.equal(JSON.stringify(result).includes('private'), false);
  assert.equal(result.orderId, 'C000-EXACT-ID');
  assert.equal(result.trackAndTrace, '3S-EXACT-ID');
  assert.equal(result.billingDetails.countryCode, 'NL');
  assert.equal(result.ean, '123');
});
test('successful malformed page responses fail closed', async () => {
  const context = collector([{ body: { unexpected: [] } }]);
  const s = state();
  const rows = await context.collectPageEndpoint(s, { pathname: '/invoices', label: 'invoices.week', rowKeys: ['invoiceListItems'] });
  assert.equal(rows.length, 0);
  assert.equal(s.apiCalls[0].contractValid, false);
  assert.equal(s.apiCalls[0].ok, false);
  assert.match(s.paginationWarnings[0], /response contract mismatch/);
});
test('only explicitly configured endpoints accept an empty object as no data', async () => {
  const context = collector([{ body: {} }, { body: { unexpected: [] } }]);
  const accepted = state();
  const rows = await context.collectPageEndpoint(accepted, { pathname: '/returns', label: 'returns', rowKeys: ['returns'], allowEmptyObject: true });
  assert.equal(rows.length, 0);
  assert.equal(accepted.paginationWarnings.length, 0);
  assert.equal(accepted.apiCalls[0].contractValid, true);
  const rejected = state();
  await context.collectPageEndpoint(rejected, { pathname: '/returns', label: 'returns', rowKeys: ['returns'], allowEmptyObject: true });
  assert.equal(rejected.apiCalls[0].contractValid, false);
});
test('an explicit metadata-only terminator is accepted for product-list pagination', async () => {
  const context = collector([{ body: { sort: 'RELEVANCE' } }]);
  const s = state();
  const result = await context.collectBodyPageEndpoint(s, {
    pathname: '/products/list',
    label: 'products.list.aterra',
    rowKeys: ['products'],
    body: {},
    allowEmptyObject: true,
    emptyResponseKeys: ['sort'],
  });
  assert.equal(result.length, 0);
  assert.equal(s.paginationWarnings.length, 0);
  assert.equal(s.apiCalls[0].contractValid, true);
});
test('invoice list uses the Retailer API invoiceListItems contract', async () => {
  const context = collector([{ body: { invoiceListItems: [] } }]);
  const s = state();
  const result = await context.collectSettlement(s);
  assert.equal(result.invoices.length, 0);
  assert.equal(s.paginationWarnings.length, 0);
  assert.equal(s.apiCalls[0].contractValid, true);
});
test('rank pagination follows every page and flags a truncated dataset', async () => {
  const context = collector([{ body: { ranks: [{ rank: 1 }], hasNextPage: true } }, { body: { ranks: [{ rank: 2 }], hasNextPage: true } }]);
  const s = state(); s.args.end = s.args.start;
  const rows = await context.collectProductRanks(s, ['123'], ['nl-NL']);
  assert.equal(rows.length, 2);
  assert.equal(s.paginationWarnings.length, 1);
});
test('failed rank responses cannot claim pagination completed', async () => {
  const context = collector([{ status: 400, body: {} }]);
  const s = state(); s.args.end = s.args.start;
  await context.collectProductRanks(s, ['123'], ['nl-NL']);
  assert.equal(s.apiCalls[0].paginationComplete, false);
});
test('repeated offer cursor stops with a warning', async () => {
  const context = collector([{ body: { offers: [], nextCursor: 'same' } }, { body: { offers: [], nextCursor: 'same' } }]);
  const s = state(10);
  await context.collectOffers(s);
  assert.equal(s.apiCalls.length, 2);
  assert.match(s.paginationWarnings[0], /repeated cursor/);
});
test('seven duplicate insight dates do not count as seven days', async () => {
  const periods = Array.from({ length: 7 }, () => ({ date: '2026-09-14', total: 1 }));
  const context = collector([{ body: { periods } }, { body: { periods } }]);
  const rows = await context.collectOfferInsights(state(), [{ offerId: 'offer', ean: '123' }]);
  assert.equal(rows[0].targetPeriodAligned, false);
});
test('buy box percentages retain daily country values and are never summed', async () => {
  const periods = Array.from({ length: 7 }, (_, index) => ({
    period: { year: 2026, month: 9, day: 14 + index },
    countries: [{ countryCode: 'NL', value: 100 }, ...(index === 6 ? [] : [{ countryCode: 'BE', value: 80 }])],
  }));
  const visits = periods.map(row => ({ ...row, total: 2 }));
  const context = collector([
    { body: { offerInsights: [{ name: 'PRODUCT_VISITS', periods: visits }] } },
    { body: { offerInsights: [{ name: 'BUY_BOX_PERCENTAGE', periods }] } },
  ]);
  const rows = await context.collectOfferInsights(state(), [{ offerId: 'offer-exact', ean: '123' }]);
  assert.equal(rows[0].weekTotal, 14);
  assert.equal(rows[1].weekTotal, null);
  assert.equal(rows[1].dailyCountryValues.length, 13);
  assert.deepEqual({ ...rows[1].dailyCountryValues[0] }, { date: '2026-09-14', countryCode: 'NL', value: 100 });
});
test('commercial summary is based only on shipment items', () => {
  const result = collector().summarizeShipmentsByEan([{
    shipmentId: 'shipment-exact',
    detail: {
      shipmentId: 'shipment-exact',
      order: { orderId: 'order-exact' },
      shipmentItems: [{ product: { ean: '123' }, quantityShipped: 2, unitPrice: 10, commission: 3 }],
    },
  }]);
  assert.deepEqual({ ...result['123'] }, {
    orders: 1,
    shipments: 1,
    lines: 1,
    units: 2,
    grossOrderValue: 20,
    commission: 3,
  });
});
test('stored data is verified by checksum, not just length', async () => {
  const context = collector();
  const bytes = new TextEncoder().encode('"a"\n').length;
  const client = { storage: { from: () => ({
    upload: async () => ({ error: null }),
    list: async () => ({ data: [{ name: 'test.json', metadata: { size: bytes } }] }),
    download: async () => ({ data: new Blob(['"b"\n']) }),
  }) } };
  await assert.rejects(context.uploadJsonArtifact(client, 'run/test.json', 'a'), /checksum mismatch/);
});
test('Amsterdam week selection handles year boundaries', () => {
  const period = collector().previousCompletedWeek('2027-01-04');
  assert.equal(period.start, '2026-12-28');
  assert.equal(period.end, '2027-01-03');
});
test('dataset status reflects missing insight dates and pagination limits', () => {
  const result = collector().datasetStatuses({
    apiCalls: [
      { label: 'insight.offer.PRODUCT_VISITS.123', status: 200 },
      { label: 'offers.v11.cursor1', status: 200, paginationComplete: false },
    ],
    completeness: { offerInsightsAligned: false, rankMode: 'primary', paginationWarnings: ['offers pagination incomplete'] },
  });
  assert.equal(result.insights.status, 'partial');
  assert.equal(result.catalog.status, 'partial');
  assert.equal(result.financial.status, 'not_collected');
});
