import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../supabase/functions/bol-retailer-drive-backup/index.ts', import.meta.url), 'utf8');
const start = source.indexOf('const SENSITIVE_KEYS');
const end = source.indexOf('\nfunction rankPayload', start);
const privacySource = stripTypeScriptTypes(source.slice(start, end));
const context = vm.createContext({});
vm.runInContext(privacySource, context);

test('Drive privacy validation accepts an exact country-only billing object', () => {
  assert.doesNotThrow(() => context.assertSanitized({ billingDetails: { countryCode: 'NL' } }));
  assert.doesNotThrow(() => context.assertSanitized({ billingDetails: '<redacted>' }));
});

test('Drive privacy validation rejects extra billing fields', () => {
  assert.throws(
    () => context.assertSanitized({ billingDetails: { countryCode: 'NL', email: 'private@example.com' } }),
    /Sensitive field is not redacted/,
  );
  assert.throws(
    () => context.assertSanitized({ billingDetails: { countryCode: 'nederland' } }),
    /Sensitive field is not redacted/,
  );
});

test('Drive privacy validation still rejects nested personal data', () => {
  assert.throws(
    () => context.assertSanitized({ detail: { customerComments: 'private' } }),
    /Sensitive field is not redacted/,
  );
});
