// Execute the real client against an isolated fetch spy; no network or auth data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { test } = require('node:test');
const source = ts.transpileModule(fs.readFileSync('src/api/client.ts','utf8'), {
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText;

for (const base of ['https://example.invalid','https://example.invalid/','https://example.invalid/api','https://example.invalid/api/']) {
  test(`plant API path is normalized for ${base}`,async () => {
    let url;
    const context = {exports:{},URL,AbortController,setTimeout,clearTimeout,process:{env:{EXPO_PUBLIC_BACKEND_URL:base,NODE_ENV:'production'}},fetch:async input => {
      url=input;
      return {ok:true,status:200,text:async () => '{"plants":[]}'};
    }};
    vm.runInNewContext(source,context);
    await context.exports.apiGet('/customer/plants','synthetic-test-token');
    assert.equal(url,'https://example.invalid/api/customer/plants');
  });
}
