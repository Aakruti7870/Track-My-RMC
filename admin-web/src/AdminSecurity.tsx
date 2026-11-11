import React, {useCallback, useEffect, useState} from 'react';
import apiClient from './api';

type Admin={id:string;name:string;email:string;enabled:boolean};
type Plant={id:string;name:string;code:string;city?:string;state?:string};
type Reviewer={enabled:boolean;environment:string;mode:string};
const panel:React.CSSProperties={background:'rgba(26,31,38,.94)',border:'1px solid rgba(255,154,61,.24)',borderRadius:13,padding:14};
const field:React.CSSProperties={display:'block',width:'100%',boxSizing:'border-box',padding:10,marginTop:5,background:'#0E1116',color:'#F4F6FA',border:'1px solid #6B7380',borderRadius:8};
const button:React.CSSProperties={padding:'9px 14px',borderRadius:8,border:0,color:'#fff',background:'#FF8A00',fontWeight:700,cursor:'pointer'};
const secondary:React.CSSProperties={...button,background:'#1D232D'};
function message(e:unknown){return e&&typeof e==='object'&&'message'in e&&typeof e.message==='string'?e.message:'Request could not be completed.';}
export function AdminSecurity({permissions,onRevokeAll,activeSection='all'}:{
  permissions:string[];onRevokeAll:()=>void;activeSection?:string;
}){
  const [reviewer,setReviewer]=useState<Reviewer|null>(null);
  const [admins,setAdmins]=useState<Admin[]>([]);
  const [plants,setPlants]=useState<Plant[]>([]);
  const [capabilities,setCapabilities]=useState<string[]>([]);
  const [selectedPlant,setSelectedPlant]=useState('');
  const [ownerId,setOwnerId]=useState('');
  const [targetAdmin,setTargetAdmin]=useState('');
  const [diagnostic,setDiagnostic]=useState('Check database connectivity');
  const [diagnosticResult,setDiagnosticResult]=useState('');
  const [reason,setReason]=useState('');
  const [code,setCode]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const can=(s:string)=>permissions.includes(s);
  const show=(section:string)=>activeSection==='all'||activeSection===section;
  const load=useCallback(async()=>{
    setBusy(true);setError('');
    const jobs:Promise<void>[]=[];
    if(show('capabilities')||show('sessions'))jobs.push(
      apiClient.get('/api/control-center/capabilities').then(r=>setCapabilities(r.data?.permissions||[])));
    if(show('reviewer')&&can('reviewer_access.manage'))jobs.push(
      apiClient.get('/api/control-center/reviewer-access').then(r=>setReviewer(r.data)));
    if(show('admin-access')&&can('admin_access.manage'))jobs.push(
      apiClient.get('/api/control-center/admin-access').then(r=>setAdmins(r.data?.admins||[])));
    if((show('unowned')||show('assign-owner'))&&can('plant.view'))jobs.push(
      apiClient.get('/api/control-center/unowned-plants').then(r=>setPlants(r.data?.plants||[])));
    try{await Promise.all(jobs);}catch(e){setError(message(e));}
    finally{setBusy(false);}
  },[permissions,activeSection]);
  useEffect(()=>{void load();},[load]);
  async function privileged(action:()=>Promise<unknown>,description:string,clear=true){
    if(!/^[0-9]{6}$/.test(code.trim())||reason.trim().length<10||reason.trim().length>500){
      setError('Enter a current 6-digit authenticator code and an audit reason (10–500 characters).');return;
    }
    if(!window.confirm(description+'? This decision will be audited.'))return;
    setBusy(true);setError('');setNotice('');
    try{
      await apiClient.post('/api/control-center/step-up',{code:code.trim()});
      setCode('');
      await action();
      setNotice(description+' completed.');
      if(clear)await load();
      setReason('');
    }catch(e){setCode('');setError(message(e));}
    finally{setBusy(false);}
  }
  async function runDiagnostic(){
    if(diagnostic.length<5||diagnostic.length>160){setError('Diagnostic description must be 5–160 characters.');return;}
    setBusy(true);setError('');setDiagnosticResult('');
    try{const r=await apiClient.post('/api/control-center/ai-command',{prompt:diagnostic,confirmed:false});
      setDiagnosticResult(String(r.data?.message||'No diagnostic result'));
    }catch(e){setError(message(e));}finally{setBusy(false);}
  }
  return <section id="security-tools" aria-label="Central Admin Security and Access Controls" style={{...panel,marginTop:16}}>
    <h2 style={{fontSize:19,margin:'0 0 5px'}}>{({reviewer:'Reviewer Access','admin-access':'Admin Access',unowned:'Unowned Plants','assign-owner':'Assign Plant Owner',diagnostics:'AI Command · Database Diagnostics',capabilities:'Platform Capabilities',sessions:'Logout All Sessions'} as Record<string,string>)[activeSection]||'Platform Security & Administrative Access'}</h2>
    <p style={{fontSize:12,color:'#B8C1CC'}}>Existing Rust privileges exposed without creating another Super Admin identity. All changes require explicit justification, permission and fresh MFA.</p>
    <button type="button" style={secondary} onClick={()=>void load()} disabled={busy}>Load / Refresh Security Controls</button>
    {error&&<p role="alert" style={{color:'#FDECEC'}}>{error}</p>}
    {notice&&<p role="status" style={{color:'#72D59B'}}>{notice}</p>}
    <div style={{...panel,background:'#1D232D',marginTop:12,display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(210px,1fr))',gap:12}}>
      <label>Audit reason (all privileged changes)
        <input aria-label="Platform security audit reason" maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} style={field} disabled={busy} placeholder="At least 10 characters"/>
      </label>
      <label>Fresh Central Admin authenticator code
        <input aria-label="Platform security authenticator code" maxLength={6} pattern="[0-9]{6}" inputMode="numeric" type="password"
          value={code} onChange={e=>setCode(e.target.value)} style={field} disabled={busy} autoComplete="off"/>
      </label>
    </div>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(270px,1fr))',gap:12,marginTop:12}}>
      {show('reviewer')&&can('reviewer_access.manage')&&<section aria-label="Reviewer Access" style={panel}>
        <h3 style={{fontSize:16,marginTop:0}}>Google Play Reviewer Access</h3>
        <p style={{fontSize:12}}>Current: {reviewer?.mode||'Load controls'} · {reviewer?.environment||'Unknown environment'}</p>
        <p style={{fontSize:12,color:'#F59E0B'}}>Disabling reviewer access can interrupt Google Play testing and revoke test sessions.</p>
        <button disabled={busy||!reviewer} type="button" style={secondary}
          onClick={()=>void privileged(()=>apiClient.post('/api/control-center/reviewer-access',{enabled:!reviewer?.enabled,reason}),
            reviewer?.enabled?'Disable Play reviewer access':'Enable Play reviewer access')}>
          {reviewer?.enabled?'Disable Reviewer Access':'Enable Reviewer Access'}
        </button>
      </section>}
      {show('admin-access')&&can('admin_access.manage')&&<section aria-label="Admin Access" style={panel}>
        <h3 style={{fontSize:16,marginTop:0}}>Central Admin Access</h3>
        <p style={{fontSize:12,color:'#B8C1CC'}}>Manage existing approved Central Admin identities. This does not create or promote users.</p>
        <label>Existing Central Admin account
          <select aria-label="Select existing Central Admin" value={targetAdmin} onChange={e=>setTargetAdmin(e.target.value)} style={field}>
            <option value="">Select an existing account</option>
            {admins.map(a=><option key={a.id} value={a.email}>{a.name} — {a.email} ({a.enabled?'Active':'Inactive'})</option>)}
          </select>
        </label>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:9}}>
          {([true,false] as const).map(enabled=><button key={String(enabled)} style={enabled?button:secondary}
            disabled={busy||!targetAdmin} type="button"
            onClick={()=>void privileged(()=>apiClient.post('/api/control-center/admin-access',
              {email:targetAdmin,enabled,reason}),enabled?'Enable selected Central Admin':'Disable selected Central Admin')}>
            {enabled?'Enable':'Disable'}
          </button>)}
        </div>
      </section>}
      {(show('unowned')||show('assign-owner'))&&can('plant.view')&&<section aria-label="Unowned Plant Assignment" style={panel}>
        <h3 style={{fontSize:16,marginTop:0}}>Unowned Plants & Owner Assignment</h3>
        <p style={{fontSize:12,color:'#B8C1CC'}}>Only already-active Plant Owner identities may be assigned. No automatic role promotion.</p>
        <label>Unowned plant
          <select aria-label="Unowned plant" value={selectedPlant} onChange={e=>setSelectedPlant(e.target.value)} style={field}>
            <option value="">Choose a plant</option>
            {plants.map(p=><option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
          </select>
        </label>
        <p style={{fontSize:12}}>{plants.length} unowned records loaded</p>
        {show('unowned')&&<div aria-label="Unowned plant records" style={{display:'grid',gap:8,marginTop:12}}>
          {plants.slice(0,50).map(p=><article key={p.id} style={{border:'1px solid rgba(255,154,61,.24)',padding:10,borderRadius:10}}>
            <strong>{p.name}</strong>
            <p style={{fontSize:12,margin:'5px 0'}}>{p.code} · {p.city||'City not recorded'}, {p.state||'State not recorded'}</p>
            {can('owner.assign')&&<button type="button" style={secondary} onClick={()=>{setSelectedPlant(p.id);window.location.hash='#/admin/assign-owner';}}>Review owner assignment</button>}
          </article>)}
        </div>}
        {show('assign-owner')&&can('owner.assign')&&<>
          <label>Approved Plant Owner user UUID
            <input aria-label="Approved owner user ID" style={field} value={ownerId} onChange={e=>setOwnerId(e.target.value)} maxLength={36} placeholder="Existing owner account UUID"/>
          </label>
          <button type="button" disabled={busy||!selectedPlant||!ownerId} style={{...button,marginTop:10}}
            onClick={()=>void privileged(()=>apiClient.post('/api/control-center/assign-plant-owner',
              {plant_id:selectedPlant,owner_user_id:ownerId,reason}),'Assign selected plant to approved Owner')}>
            Assign Plant Owner
          </button>
        </>}
      </section>}
      {show('diagnostics')&&can('ai.diagnose')&&<section aria-label="Read-only Diagnostics" style={panel}>
        <h3 style={{fontSize:16,marginTop:0}}>Platform Diagnostic Check</h3>
        <p style={{fontSize:12,color:'#B8C1CC'}}>The existing API only verifies database connectivity. It does not run AI tasks, deployments or privileged commands.</p>
        <label>Diagnostic request
          <input aria-label="Diagnostic request" value={diagnostic} onChange={e=>setDiagnostic(e.target.value)} maxLength={160} style={field}/>
        </label>
        <button type="button" disabled={busy} onClick={()=>void runDiagnostic()} style={{...secondary,marginTop:10}}>Run Read-only Diagnostic</button>
        {diagnosticResult&&<p role="status">{diagnosticResult}</p>}
      </section>}
      {(show('sessions')||show('capabilities'))&&<section aria-label="Session and Capabilities" style={panel}>
        <h3 style={{fontSize:16,marginTop:0}}>Session Security & Capabilities</h3>
        <p style={{fontSize:12,color:'#B8C1CC'}}>Dedicated Central Admin web session and currently authorized permissions.</p>
        {show('capabilities')&&<p style={{fontSize:12,overflowWrap:'anywhere'}}>{capabilities.length?capabilities.join(' · '):'No capabilities returned by the authorized Rust endpoint.'}</p>}
        {show('sessions')&&<button type="button" disabled={busy} style={{...button,background:'#9B2C2C'}}
          onClick={()=>void privileged(async()=>{
            await apiClient.post('/api/control-center/logout-all');
            onRevokeAll();
          },'Revoke every active session for this Super Admin account',false)}>
          Logout All My Sessions
        </button>}
      </section>}
    </div>
  </section>;
}