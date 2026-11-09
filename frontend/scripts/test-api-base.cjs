// Execute the real client against an isolated fetch spy; no network or auth data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { test } = require('node:test');
const source = ts.transpileModule(fs.readFileSync('src/api/client.ts','utf8'), {
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText;
const eventsSource=ts.transpileModule(fs.readFileSync('src/auth/sessionEvents.ts','utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText;

for (const platform of ['web', 'android', 'ios']) {
 for (const base of ['https://example.invalid','https://example.invalid/','https://example.invalid/api','https://example.invalid/api/']) {
  test(`plant API path is normalized for ${base} on ${platform}`,async () => {
    let url;
    const events={exports:{}};
    vm.runInNewContext(eventsSource,events);
    // transpileModule emits require('react-native') for the Platform import.
    // Node cannot execute React Native's platform source directly; supply only
    // the native boundary and keep the real API client and URL logic under test.
    const context = {exports:{},require: name => {
      if (name==='../auth/sessionEvents') return events.exports;
      assert.equal(name, 'react-native', `Unexpected client dependency: ${name}`);
      return { Platform: { OS: platform } };
    },URL,AbortController,setTimeout,clearTimeout,process:{env:{EXPO_PUBLIC_BACKEND_URL:base,NODE_ENV:'production'}},fetch:async input => {
      url=input;
      return {ok:true,status:200,text:async () => '{"plants":[]}'};
    }};
    vm.runInNewContext(source,context);
    await context.exports.apiGet('/customer/plants','synthetic-test-token');
    assert.equal(url,'https://example.invalid/api/customer/plants');
  });
 }
}

test('protected session replacement is published, while permission denials do not sign out',async()=>{
  const events={exports:{}};vm.runInNewContext(eventsSource,events);
  const losses=[];const unsubscribe=events.exports.onSessionLoss(loss=>losses.push(loss));
  let status=401;
  const context={exports:{},URL,AbortController,setTimeout,clearTimeout,process:{env:{EXPO_PUBLIC_BACKEND_URL:'https://example.invalid',NODE_ENV:'production'}},
    require:name=>{
      if(name==='react-native')return {Platform:{OS:'android'}};
      assert.equal(name,'../auth/sessionEvents');return events.exports;
    },fetch:async()=>({ok:false,status,text:async()=>JSON.stringify({message:'Synthetic authorization result',error_code:status===401?'SESSION_REPLACED':'FORBIDDEN'})})};
  vm.runInNewContext(source,context);
  await assert.rejects(context.exports.apiGet('/customer/orders','synthetic-test-token'),error=>error.status===401);
  assert.equal(losses.length,1);assert.equal(losses[0].token,'synthetic-test-token');
  assert.equal(losses[0].error.error_code,'SESSION_REPLACED');
  await assert.rejects(context.exports.apiPublicPost('/auth/refresh',{}),error=>error.status===401);
  assert.equal(losses.length,1,'Public login/refresh failures cannot revoke an unrelated authenticated session');
  status=403;
  await assert.rejects(context.exports.apiGet('/staff/payroll','synthetic-test-token'),error=>error.status===403);
  assert.equal(losses.length,1,'Role permission denial must preserve the authenticated session');
  unsubscribe();
});

function clientHarness({ base = 'https://example.invalid', platform = 'web', env = 'production', fetch, timers } = {}) {
  const events = { exports: {} };
  vm.runInNewContext(eventsSource, events);
  const context = {
    exports: {}, URL, AbortController, Error, FormData, File,
    setTimeout: timers ? (fn, delay) => { timers.set(1, { fn, delay }); return 1; } : setTimeout,
    clearTimeout: timers ? id => timers.delete(id) : clearTimeout,
    process: { env: { EXPO_PUBLIC_BACKEND_URL: base, NODE_ENV: env } },
    window: { location: { origin: 'https://example.invalid' } },
    require: name => {
      if (name === 'react-native') return { Platform: { OS: platform } };
      assert.equal(name, '../auth/sessionEvents'); return events.exports;
    },
    fetch: fetch || (async () => { throw Error('Unexpected network request'); }),
  };
  vm.runInNewContext(source, context);
  return { client: context.exports, events: events.exports };
}

for (const base of [
  'https://example.invalid?source=preview', 'https://example.invalid/#section',
  'https://user:secret@example.invalid', 'ftp://localhost', 'http://example.invalid',
]) {
  test(`invalid API configuration fails before fetch: ${base}`, async () => {
    const { client } = clientHarness({ base, env: 'development' });
    await assert.rejects(client.apiGet('/customer/plants', 'synthetic-token'), error => error.status === 0);
  });
}

test('local development HTTP remains supported; production HTTP is rejected', async () => {
  let requested;
  const { client } = clientHarness({ base: 'http://localhost:8000/api/', env: 'development', fetch: async url => {
    requested = url; return { ok: true, status: 200, text: async () => '{}' };
  }});
  await client.apiPublicGet('/health');
  assert.equal(requested, 'http://localhost:8000/api/health');
  await assert.rejects(clientHarness({base: 'http://localhost:8000'}).client.apiPublicGet('/health'), error => error.status === 0);
});

test('proxy HTML and plain-text infrastructure errors never reach the UI', async () => {
  for (const status of [403, 429, 502]) {
    const { client } = clientHarness({ fetch: async () => ({ ok: false, status,
      text: async () => '<html>upstream internal-secret-diagnostic</html>' }) });
    await assert.rejects(client.apiGet('/customer/orders', 'synthetic-token'), error =>
      error.status === status && !error.detail.includes('internal-secret-diagnostic') && !error.detail.includes('<html>'));
  }
});

test('multipart certificates share auth, cookies, errors and session-loss handling', async () => {
  const losses = [], requests = [];
  let status = 200;
  const { client, events } = clientHarness({ fetch: async (url, options) => {
    requests.push({url, options});
    return { ok: status === 200, status, text: async () => JSON.stringify(status === 200
      ? { path: 'synthetic/certificate.pdf' } : { message: 'Session ended', error_code: 'SESSION_REVOKED' }) };
  }});
  events.onSessionLoss(loss => losses.push(loss));
  const certificate = new File(['synthetic certificate'], 'certificate.pdf', {type: 'application/pdf'});
  const result = await client.apiUploadCertificate('synthetic-token', certificate);
  assert.equal(result.path, 'synthetic/certificate.pdf');
  assert.equal(requests[0].url, 'https://example.invalid/api/upload');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer synthetic-token');
  assert.equal(requests[0].options.headers['Content-Type'], undefined, 'FormData must supply its own boundary');
  assert.equal(requests[0].options.body.get('purpose'), 'plant_cert');
  assert.equal(requests[0].options.body.get('file').name, 'certificate.pdf');
  assert.equal(requests[0].options.credentials, 'include');
  status = 401;
  await assert.rejects(client.apiUploadCertificate('synthetic-token', certificate), error => error.error_code === 'SESSION_REVOKED');
  assert.equal(losses.length, 1);
});

test('stalled multipart uploads abort at the shared timeout and clear timers', async () => {
  const timers = new Map();
  const { client } = clientHarness({timers, fetch: async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), {name:'AbortError'})));
  })});
  const upload = client.apiUploadCertificate('synthetic-token', new File(['test'], 'test.pdf'));
  assert.equal(timers.get(1).delay, 30000);
  timers.get(1).fn();
  await assert.rejects(upload, error => error.status === 0 && error.detail.includes('timed out'));
  assert.equal(timers.size, 0);
});
