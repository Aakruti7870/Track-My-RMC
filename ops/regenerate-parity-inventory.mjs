import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const reference=JSON.parse(await readFile(root+'docs/reference-api-inventory.json','utf8'));
const router=await readFile(root+'backend/src/routes/mod.rs','utf8');
const target=[];
// Balanced Rust route expressions, including chained HTTP methods. This is a
// static inventory, not a route execution or contract test.
for(const match of router.matchAll(/\.route\s*\(/g)) {
  const start=match.index+match[0].length;
  let depth=1,quoted=false,escaped=false,end=start;
  for(;end<router.length&&depth;end++) {
    const c=router[end];
    if(quoted) {if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;}
    else if(c==='"')quoted=true;else if(c==='(')depth++;else if(c===')')depth--;
  }
  const body=router.slice(start,end-1),path=body.match(/^\s*"([^"]+)"/)?.[1];
  if(path)for(const method of body.matchAll(/\b(get|post|patch|put|delete)\s*\(/g))target.push({method:method[1].toUpperCase(),path});
}
const normalize=path=>path.replace(/:[^/]+|\{[^}]+\}|\*[^/]+/g,'{}');
const key=r=>r.method+' '+normalize(r.path);
const targetKeys=new Set(target.map(key));
function classify(row) {
  const p=row.path,m=row.module;
  if(m==='meta_whatsapp'||/cashfree\/(return|webhook)/.test(p))return ['BLOCKED','External integration unavailable','Provider webhook adapter/configuration and controlled live destinations are unavailable.'];
  if(m==='staff_passkeys'||/\/auth\/(demo-login|google\/)/.test(p)||p.endsWith('/payroll')&&row.method==='PUT')return ['NOT IMPLEMENTED','Intentionally retired for security','Use verified OTP/MFA and approved payroll lifecycle; insecure legacy authentication/direct payroll mutation is not restored.'];
  if(targetKeys.has(key(row))) {
    if(/\/kyc\/start$|\/plant-plans\/activate$|\/automation\/events\/.*\/deliver$/.test(p))return ['BLOCKED','External integration unavailable','Guarded route rejects unconfigured providers; no fabricated delivery, KYC or payment success.'];
    return ['PARTIAL','Matching Rust endpoint','Method/path matches; DTO, authorization and full workflow parity require endpoint-specific evidence.'];
  }
  if(m==='admin_portal'&&/\/(users|plants|orders|support|audit)$/.test(p))return ['PARTIAL','Equivalent Rust endpoint','Dedicated web-session /api/control-center/collections/{kind} provides scoped read data; legacy DTO compatibility is incomplete.'];
  if(m==='control_center'&&/\/owners\/(plants\/.*\/assign|unowned-plants)$/.test(p))return ['PARTIAL','Equivalent Rust endpoint','Secure /api/control-center/assign-owner and /api/control-center/unowned-plants; legacy path/DTO compatibility remains.'];
  if(m==='control_center'&&p.endsWith('/sessions'))return ['PARTIAL','Equivalent Rust endpoint','Dedicated /api/control-center/collections/sessions provides permission-filtered session reads.'];
  if(m==='control_center'&&p.endsWith('/support/cases'))return ['PARTIAL','Equivalent Rust endpoint','Dedicated /api/control-center/collections/support provides permission-filtered reads; support mutations remain incomplete.'];
  if(m==='owner'&&/\/orders\/.*\/(assign-driver|assign-tm|challan|dispatch)$/.test(p))return ['PARTIAL','Equivalent Rust endpoint','Guarded /api/staff/orders and /api/loads workflows cover allocation/challan/dispatch; legacy wrappers and request contracts remain.'];
  if(m==='finance_ops'&&p==='/api/ops/customer/quotations')return ['PARTIAL','Compatibility route or frontend correction','Existing GET /api/customer/quotations; quotation screen still calls this legacy GET path.'];
  if(m==='driver'&&p.endsWith('/sos'))return ['PARTIAL','Compatibility route or frontend correction','Existing /api/driver/sos/status; response and legacy path need alignment.'];
  if(m==='auth'||m==='permanent_access'||m==='staff_auth')return ['PARTIAL','Compatibility route or frontend correction','Use explicit /api/auth/otp/{email|whatsapp}/{send|verify} and challenge-bound staff MFA; legacy generic OTP contracts need migration.'];
  if(m==='customer'&&p.endsWith('/project-sites'))return ['PARTIAL','Compatibility route or frontend correction','Existing /api/customer/sites; project-site DTO compatibility remains.'];
  if(m==='master_data'&&p.endsWith('/profile'))return ['PARTIAL','Compatibility route or frontend correction','Existing profile save uses POST; validate PUT semantics before adding an alias.'];
  if(m==='staff'&&/\/(materials|vehicles|users)\b/.test(p))return ['PARTIAL','Equivalent Rust endpoint','Plant-scoped /api/business/plants/{plant_id} and /api/master/plants/{plant_id} handlers exist; legacy no-plant request wrappers remain.'];
  if(m==='staff'&&p.endsWith('/challan'))return ['PARTIAL','Equivalent Rust endpoint','Existing /api/staff/orders/{order_id}/generate-challan delegates to guarded load preparation.'];
  if(m==='workforce'&&/\/owner\/(expenses|leave)\//.test(p))return ['PARTIAL','Compatibility route or frontend correction','Existing plant-scoped leave/owner-expense decision routes use different URLs; legacy DTO migration remains.'];
  return ['NOT IMPLEMENTED','Missing business logic','No equivalent complete Rust workflow has been established; implementation and regression tests remain.'];
}
const entries=reference.map(row=>{const [status,classification,note]=classify(row);return {module:row.module,method:row.method,path:row.path,path_match:targetKeys.has(key(row)),status,classification,note};});
const summary={reference_commit:'51903571f110908c3f1ddcffa6e4171ed406888c',reference_entries:reference.length,reference_unique_pairs:new Set(reference.map(key)).size,target_unique_pairs:targetKeys.size,matched_entries:entries.filter(r=>r.path_match).length,unmatched_entries:entries.filter(r=>!r.path_match).length};
await writeFile(root+'docs/api-parity-current.json',JSON.stringify({summary,entries},null,2)+'\n');
const preamble=`# API contract parity\n\nStatus: PARTIAL. Regenerate with \`node ops/regenerate-parity-inventory.mjs\`. Reference ${summary.reference_commit}; source inventory is preserved unchanged. Static comparison normalizes named and wildcard path parameters. There are ${summary.reference_entries} decorator entries, ${summary.reference_unique_pairs} unique source pairs, ${summary.target_unique_pairs} target pairs, ${summary.matched_entries} matching source entries and ${summary.unmatched_entries} unmatched entries. These are method/path counts, not functional acceptance percentages.\n\nCritical contracts are exercised by authentication_delivery_tests, customer_order_tests, delivery_lifecycle_tests and integration_security_tests with real PostgreSQL and HTTP handlers. Provider transport is injected only in synthetic OTP tests. Older parity_workflow_tests/auth_tests contain mirrored helper assertions and are not proof of live endpoint behavior. Production deployment and live provider testing remain BLOCKED.\n\nKnown cross-screen gaps include RFQ and plant quotation DTOs, workforce review wrappers, Authority functions, privileged recovery, public policy aliases, maps/discovery, account-deletion review and several master-data mutations. The generic dispatcher status endpoint no longer changes lifecycle states: dedicated approval, production, dispatch and POD handlers are required.\n\n| Source module | Method | Reference path | Status | Classification | Evidence / remaining work |\n|---|---|---|---|---|---|\n`;
await writeFile(root+'docs/API_CONTRACT_PARITY.md',preamble+entries.map(r=>`| ${r.module} | ${r.method} | \`${r.path}\` | ${r.status} | ${r.classification} | ${r.note} |`).join('\n')+'\n');
console.log(JSON.stringify(summary));
