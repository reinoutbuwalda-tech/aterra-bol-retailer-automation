import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('npm_execpath is required; run this policy through npm run audit:policy.');
const allowlist = JSON.parse(readFileSync(
  new URL('../security/npm-audit-high-allowlist.json', import.meta.url),
  'utf8',
));

function audit(extraArgs = []) {
  const result = spawnSync(process.execPath, [npmCli, 'audit', '--json', ...extraArgs], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (![0, 1].includes(result.status)) {
    throw new Error(`npm audit failed with exit ${result.status}: ${result.stderr}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`npm audit returned invalid JSON: ${result.stderr}`);
  }
}

function count(report, severity) {
  return Number(report.metadata?.vulnerabilities?.[severity] || 0);
}

const all = audit();
const production = audit(['--omit=dev']);

if (count(all, 'critical') !== 0) {
  throw new Error(`Critical dependency advisories are forbidden; found ${count(all, 'critical')}.`);
}
if (count(production, 'critical') !== 0 || count(production, 'high') !== 0) {
  throw new Error(
    `Production dependencies must have zero critical/high advisories; found critical=${count(production, 'critical')} high=${count(production, 'high')}.`,
  );
}

const highPackages = Object.entries(all.vulnerabilities || {})
  .filter(([, detail]) => detail.severity === 'high')
  .map(([name]) => name)
  .sort();
const highAdvisories = [...new Set(
  Object.values(all.vulnerabilities || {})
    .flatMap(detail => Array.isArray(detail.via) ? detail.via : [])
    .filter(via => via && typeof via === 'object' && via.severity === 'high')
    .map(via => via.url?.split('/').pop())
    .filter(Boolean),
)].sort();

const allowedPackages = [...new Set(allowlist.entries.flatMap(entry => entry.packages))].sort();
const allowedAdvisories = [...new Set(allowlist.entries.map(entry => entry.advisory))].sort();
const today = new Date().toISOString().slice(0, 10);

for (const entry of allowlist.entries) {
  if (!entry.owner?.trim() || !entry.rationale?.trim()) {
    throw new Error(`Allowlist entry ${entry.advisory} must have an owner and rationale.`);
  }
  const expiry = new Date(`${entry.expires}T00:00:00.000Z`);
  const expiryValid = /^\d{4}-\d{2}-\d{2}$/.test(entry.expires)
    && !Number.isNaN(expiry.getTime())
    && expiry.toISOString().slice(0, 10) === entry.expires;
  if (!expiryValid || entry.expires < today) {
    throw new Error(`Allowlist entry ${entry.advisory} expired or has an invalid expiry: ${entry.expires}.`);
  }
}

if (JSON.stringify(highPackages) !== JSON.stringify(allowedPackages)) {
  throw new Error(
    `High advisory package set changed. Actual=${JSON.stringify(highPackages)} Allowed=${JSON.stringify(allowedPackages)}.`,
  );
}
if (JSON.stringify(highAdvisories) !== JSON.stringify(allowedAdvisories)) {
  throw new Error(
    `High advisory IDs changed. Actual=${JSON.stringify(highAdvisories)} Allowed=${JSON.stringify(allowedAdvisories)}.`,
  );
}

console.log(`Dependency policy passed: critical(all)=0, high(production)=0, allowlisted high(dev)=${highPackages.length}.`);
for (const entry of allowlist.entries) {
  console.log(`${entry.advisory} owner=${entry.owner} expires=${entry.expires}`);
}
