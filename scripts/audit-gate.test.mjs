// Self-test for scripts/audit-gate.mjs. Dependency-free: node:test and
// node:assert only, because the audit workflow runs no `npm ci`.
//
// Run: node --test scripts/audit-gate.test.mjs
//
// scripts/fixtures/audit-gate/ holds real npm output captured from this
// repository's tree with npm 11.18: the `npm audit --audit-level=high --json`
// report (audit.stdout.json, exit status 1) and the failure shape of an
// unreachable registry (outage.stdout.json plus outage.stderr.txt). Variants
// for the other cases are derived from the real report in memory.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { addDays, todayUtc } from './audit-gate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, 'audit-gate.mjs');
const FIXTURES = path.join(HERE, 'fixtures', 'audit-gate');
const BRACES_ID = 'GHSA-vfj7-8cjw-p6xm';
const OTHER_ID = 'GHSA-xxxx-xxxx-xxxx';

const realReport = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'audit.stdout.json'), 'utf8'));
const outageStdout = fs.readFileSync(path.join(FIXTURES, 'outage.stdout.json'), 'utf8');
const outageStderr = fs.readFileSync(path.join(FIXTURES, 'outage.stderr.txt'), 'utf8');

function allowlist(reviewBy = addDays(todayUtc(), 30)) {
  return JSON.stringify({ entries: [{ id: BRACES_ID, reason: 'test entry', reviewBy }] });
}

// The real report plus one more high advisory on a package outside the braces chain.
function reportWithOtherHigh() {
  const copy = structuredClone(realReport);
  copy.vulnerabilities.lodash = {
    name: 'lodash',
    severity: 'high',
    isDirect: false,
    via: [
      {
        source: 1,
        name: 'lodash',
        dependency: 'lodash',
        title: 'synthetic advisory',
        url: `https://github.com/advisories/${OTHER_ID.replace('xxxx', 'cccc')}`,
        severity: 'high',
        range: '*',
      },
    ],
    effects: [],
    range: '*',
    nodes: ['node_modules/lodash'],
    fixAvailable: false,
  };
  return copy;
}

function run(script, { allowlistText, stdout, stderr = '', status }) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'audit-gate-test-')));
  try {
    fs.writeFileSync(path.join(dir, 'allow.json'), allowlistText);
    fs.writeFileSync(path.join(dir, 'out.json'), stdout);
    fs.writeFileSync(path.join(dir, 'err.txt'), stderr);
    let target = script;
    if (script === 'symlink') {
      target = path.join(dir, 'gate-link.mjs');
      fs.symlinkSync(SCRIPT, target);
    }
    const result = spawnSync(
      process.execPath,
      [
        target,
        '--allowlist', path.join(dir, 'allow.json'),
        '--status', String(status),
        '--stdout', path.join(dir, 'out.json'),
        '--stderr', path.join(dir, 'err.txt'),
      ],
      { encoding: 'utf8', cwd: dir },
    );
    return { code: result.status, out: result.stdout, err: result.stderr };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('fixture sanity: the real report carries the allowlisted advisory', () => {
  assert.equal(realReport.auditReportVersion, 2);
  const urls = Object.values(realReport.vulnerabilities).flatMap((v) =>
    v.via.filter((x) => typeof x === 'object').map((x) => x.url),
  );
  assert.ok(urls.includes(`https://github.com/advisories/${BRACES_ID}`));
});

test('allowlisted advisory only: exit 0, entry printed, CLEAN', () => {
  const { code, out, err } = run(SCRIPT, {
    allowlistText: allowlist(),
    stdout: JSON.stringify(realReport),
    status: 1,
  });
  assert.equal(code, 0, out + err);
  assert.match(out, new RegExp(`excepted by allowlist: ${BRACES_ID}`));
  assert.match(out, /npm audit gate: CLEAN/);
});

test('allowlisted advisory plus another high advisory: exit 1, FINDINGS names the other package', () => {
  const { code, out } = run(SCRIPT, {
    allowlistText: allowlist(),
    stdout: JSON.stringify(reportWithOtherHigh()),
    status: 1,
  });
  assert.equal(code, 1, out);
  assert.match(out, /npm audit gate: FINDINGS: 1 package\(s\)/);
  assert.match(out, /- lodash \(high\)/);
  assert.doesNotMatch(out, /npm audit gate: CLEAN/);
});

test('expired entry: exit 1 naming the id, never CLEAN', () => {
  const { code, out } = run(SCRIPT, {
    allowlistText: allowlist(addDays(todayUtc(), -1)),
    stdout: JSON.stringify(realReport),
    status: 1,
  });
  assert.equal(code, 1, out);
  assert.match(out, new RegExp(`allowlist entry ${BRACES_ID} expired`));
  assert.doesNotMatch(out, /npm audit gate: CLEAN/);
});

test('malformed allowlist: exit 3', () => {
  for (const allowlistText of ['{ not json', JSON.stringify({ entries: [{ id: BRACES_ID }] })]) {
    const { code, out } = run(SCRIPT, {
      allowlistText,
      stdout: JSON.stringify(realReport),
      status: 1,
    });
    assert.equal(code, 3, out);
    assert.match(out, /UNCLASSIFIED/);
  }
});

test('reviewBy more than 90 days out: exit 3 (malformed)', () => {
  const { code, out } = run(SCRIPT, {
    allowlistText: allowlist(addDays(todayUtc(), 91)),
    stdout: JSON.stringify(realReport),
    status: 1,
  });
  assert.equal(code, 3, out);
});

test('npm error JSON without a report (registry unreachable): exit 2, OUTAGE', () => {
  const { code, out } = run(SCRIPT, {
    allowlistText: allowlist(),
    stdout: outageStdout,
    stderr: outageStderr,
    status: 1,
  });
  assert.equal(code, 2, out);
  assert.match(out, /OUTAGE/);
});

test('script spawned through a symlink on the findings fixture: exit 1 with a FINDINGS line', () => {
  const { code, out, err } = run('symlink', {
    allowlistText: allowlist(),
    stdout: JSON.stringify(reportWithOtherHigh()),
    status: 1,
  });
  assert.equal(err, '');
  assert.equal(code, 1, out);
  assert.match(out, /npm audit gate: FINDINGS: 1 package\(s\)/);
});
