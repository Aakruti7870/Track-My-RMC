const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const source=fs.readFileSync('src/location/currentLocation.ts','utf8');
function harness({permission='granted',consent=true,services=true,native=false,timeout=false}={}){
 const calls=[];
 const position={coords:{latitude:18.99,longitude:73.11,accuracy:10},timestamp:1};
 const exports={};
 const location={hasServicesEnabledAsync:async()=>services,getForegroundPermissionsAsync:async()=>({status:permission}),requestForegroundPermissionsAsync:async()=>{calls.push('permission');return {status:consent?'granted':'denied'};},Accuracy:{High:6},getCurrentPositionAsync:async()=>{calls.push('fix');if(timeout)return new Promise(()=>{});return position;}};
 const disclosure=Object.fromEntries(['Foreground','NearbyPlants','Attendance','Sos'].map(scope=>[`request${scope}LocationConsent`,async()=>{calls.push(scope);return consent;}]));
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>{
  if(name==='react-native')return {Platform:{OS:'android'}};
  if(name==='expo-location')return location;
  if(name.includes('trip-location'))return {__esModule:true,default:native?{isAvailable:()=>true,getCurrentLocation:async()=>{calls.push('native-fix');return {latitude:18.99,longitude:73.11};}}:null};
  if(name.includes('BackgroundLocationConsent'))return disclosure;
  throw Error(name);
 },setTimeout:(callback,ms)=>setTimeout(callback,timeout?0:ms),clearTimeout});
 return {get:exports.getCurrentDeviceLocation,calls};
}
test('customer discovery with existing permission reads once without delivery disclosure',async()=>{
 const h=harness();const result=await h.get('discovery');assert.equal(result.ok,true);assert.deepEqual(h.calls,['fix']);
});
test('customer discovery requests customer consent before OS permission and one fix',async()=>{
 const h=harness({permission:'undetermined'});assert.equal((await h.get('discovery')).ok,true);assert.deepEqual(h.calls,['NearbyPlants','permission','fix']);
});
test('denied consent and disabled services never request a location fix',async()=>{
 const denied=harness({permission:'denied',consent:false});assert.equal((await denied.get('discovery')).reason,'permission-denied');assert.deepEqual(denied.calls,['NearbyPlants']);
 const off=harness({services:false});assert.equal((await off.get('discovery')).reason,'services-disabled');assert.deepEqual(off.calls,[]);
});
test('customer discovery uses native one-shot fix and bounds an unavailable GPS',async()=>{
 const native=harness({native:true});assert.equal((await native.get('discovery')).source,'native');assert.deepEqual(native.calls,['native-fix']);
 const timed=harness({timeout:true});assert.equal((await timed.get('discovery')).reason,'unavailable');
});
test('delivery foreground purpose preserves the existing disclosure flow',async()=>{
 const h=harness();assert.equal((await h.get('foreground')).ok,true);assert.deepEqual(h.calls,['Foreground','fix']);
});
