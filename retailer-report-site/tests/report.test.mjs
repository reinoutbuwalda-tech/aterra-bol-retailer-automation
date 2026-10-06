import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../lib/report.ts', import.meta.url), 'utf8');

test('cloud report includes the required weekly metrics and rank interpretation', () => {
  for (const label of ['Netto verzonden GMS', 'Verkochte eenheden', 'Productbezoeken', 'Omzet na commissie', 'Retouren', 'Sponsored rank', 'Organic rank']) {
    assert.equal(source.includes(label), true, `missing ${label}`);
  }
  assert.match(source, /geen perfect cohort-gematchte bestelconversie/i);
  assert.match(source, /x\/7 toont op hoeveel dagen/i);
});

test('cloud report escapes dynamic HTML values', () => {
  assert.equal(source.includes('.replace(/[&<>"\']/g'), true);
});
