const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('src/tracking/homeTracking.ts','utf8');
const context = { exports: {} };
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,context);
const { DEMO_TRACKING_CARD:d, freshGPS, validPoint, dialable, selectedLoad } = context.exports;
test('demo exact strings and 2:1 map',()=>{
 assert.equal(d.title,'Place Your First order'); assert.equal(d.siteName,'Project site 1');
 assert.equal(`${d.gradeLabel} · ${d.quantityM3} m³`,'M-25 Grade · 6 m³');
 assert.equal(d.mapReferenceWidth/d.mapReferenceHeight,2); assert.equal(d.mode,'demo');
 assert.ok(!JSON.stringify(d).includes('PLAY-REVIEW')); assert.equal(d.driverPhone,undefined);
});
test('GPS rejects invalid, missing, stale and future samples',()=>{
 const now=Date.now(); const p={lat:19,lng:73,at:new Date(now-1000).toISOString()};
 assert.ok(freshGPS(p,now));
 for(const bad of [null,{...p,lat:91},{...p,lng:NaN},{...p,at:'invalid'},{...p,at:new Date(now+1).toISOString()},{...p,at:new Date(now-90000).toISOString()}]) assert.equal(freshGPS(bad,now),false);
 assert.equal(validPoint({lat:0,lng:0}),true);
});
test('mixer contact and telemetry never cross loads',()=>{
 const first={id:'a',status:'en_route',driver_mobile:'1234567890',location:null};
 const second={id:'b',status:'en_route',location:{lat:19,lng:73,at:new Date().toISOString()}};
 assert.equal(selectedLoad({active_loads:[first,second]}),first); assert.equal(selectedLoad(null),undefined);
});
test('dialer rejects demo IDs, missing phones and URL injection',()=>{
 assert.equal(dialable('+91 (98765) 43210'),'+919876543210');
 for(const bad of [null,'TM-08','tel:1234567890','123;4567890','0']) assert.equal(dialable(bad),null);
});
