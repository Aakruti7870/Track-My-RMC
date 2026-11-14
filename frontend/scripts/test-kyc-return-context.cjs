const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function harness() {
  let now = 1_800_000_000_000;
  const values = new Map();
  const storage = {
    async setItem(key, value) { values.set(key, value); return true; },
    async getItem(key, fallback) { return values.has(key) ? values.get(key) : fallback; },
    async removeItem(key) { values.delete(key); return true; },
  };
  const source = fs.readFileSync('src/kyc/returnContext.ts', 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  class Clock extends Date { static now() { return now; } }
  vm.runInNewContext(code, { module, exports: module.exports, require: (id) => {
    if (id === '@/src/utils/storage') return { storage };
    throw new Error(`Unexpected import: ${id}`);
  }, Date: Clock, JSON, Number, RegExp });
  return { api: module.exports, advance: (ms) => { now += ms; } };
}
const draft = '01234567-89ab-4cde-8fab-0123456789ab';

test('authenticated return resumes only the original customer draft once', async () => {
  const { api } = harness();
  assert.equal(await api.saveKycDestination('customer-a', { kind: 'order', draftId: draft }), true);
  await api.markKycReturnPending();
  assert.equal(await api.shouldResumeKycAfterLogin('customer-a'), true);
  const destination = await api.takeKycDestination('customer-a');
  assert.equal(destination.kind, 'order');
  assert.equal(destination.draftId, draft);
  assert.equal((await api.takeKycDestination('customer-a')).kind, 'home');
});

test('another account and expired return contexts cannot recover a draft', async () => {
  const { api, advance } = harness();
  await api.saveKycDestination('customer-a', { kind: 'order', draftId: draft });
  await api.markKycReturnPending();
  assert.equal(await api.shouldResumeKycAfterLogin('customer-b'), false);
  assert.equal((await api.takeKycDestination('customer-b')).kind, 'home');
  await api.saveKycDestination('customer-a', { kind: 'order', draftId: draft });
  await api.markKycReturnPending();
  advance(24 * 60 * 60 * 1000 + 1);
  assert.equal(await api.shouldResumeKycAfterLogin('customer-a'), false);
  assert.equal((await api.takeKycDestination('customer-a')).kind, 'home');
});

test('external destinations and malformed draft IDs are never used as navigation targets', async () => {
  const { api } = harness();
  assert.equal(await api.saveKycDestination('customer-a', { kind: 'order', draftId: 'https://evil.invalid' }), false);
  await api.saveKycDestination('customer-a', { kind: 'https://evil.invalid' });
  assert.equal((await api.takeKycDestination('customer-a')).kind, 'home');
});
