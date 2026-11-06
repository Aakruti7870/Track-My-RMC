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
