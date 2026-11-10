// Real browser and UI with synthetic API responses; no deployed service access.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
const origin='http://127.0.0.1:4175', api='http://127.0.0.1:8000';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4175','--strictPort'],{
  env:{...process.env,VITE_API_URL:api},stdio:'pipe',
});
let logs='',browser;
server.stdout.on('data',data=>{logs+=data;});server.stderr.on('data',data=>{logs+=data;});
try {
  let ready=false;
  for(let i=0;i<100;i++){
    if(server.exitCode!==null)throw Error(logs);
    try{ready=(await fetch(origin+'/admin/')).ok;}catch{/* starting */}
    if(ready)break;await delay(100);
  }
  assert(ready,'Preview unavailable: '+logs);
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
  for(const [width,blockedStorage,failedLogout] of [[390,true,true],[1440,false,false]]){
    const context=await browser.newContext({viewport:{width,height:1000}});
    if(blockedStorage)await context.addInitScript(()=>{
      Object.defineProperty(window,'sessionStorage',{get(){throw new DOMException('Storage blocked','SecurityError');}});
    });
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    let plantFails=true,delayPlants=false,releasePlants,currentEmail='';
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());if(url.origin===origin)return route.continue();
      assert.equal(url.origin,api,'Unexpected external request');const path=url.pathname;
      const reply=json=>route.fulfill({json});
      if(path.endsWith('/otp/send'))return reply({status:'EMAIL_OTP_SENT'});
      if(path.endsWith('/auth/login')){currentEmail=route.request().postDataJSON().email;return reply({challenge_token:'synthetic-challenge'});}
      if(path.endsWith('/verify-totp'))return reply({token:'synthetic-token-'+currentEmail,user:{id:currentEmail,role:'central_admin',full_name:currentEmail}});
      if(path.endsWith('/auth/me'))return reply({permissions:['user.view','plant.view','plant_owners.manage','order.view']});
      if(path.endsWith('/summary'))return reply({kpis:[{label:'Onboarding Requests',value:1}]});
      if(path==='/api/notifications')return reply({items:[{id:'admin-notice-1',event:'plant_onboarding',title:'Plant onboarding request received',body:'Synthetic approval notice',read:false,created_at:'2026-11-10T01:00:00Z'}],unread:1});
      if(path==='/api/notifications/read-all')return reply({success:true,updated:1});
      if(path==='/api/control-center/plants/master')return reply({items:[{
        id:'synthetic-plant',name:'Synthetic Plant A',code:'PLANT-TEST',city:'Panvel',state:'Maharashtra',
        address:'Example test address',owner_name:'Fixture Owner',owner_email:'fixture-owner@example.invalid',
        owner_active:true,active:true,google_place_id:null,onboarding_approved:true,staff_count:1
      }],total:1});
      if(path==='/api/control-center/plants/synthetic-plant/master')return reply({plant:{
        id:'synthetic-plant',name:'Synthetic Plant A',code:'PLANT-TEST',city:'Panvel',state:'Maharashtra',
        address:'Example test address',owner_name:'Fixture Owner',owner_email:'fixture-owner@example.invalid',
        owner_active:true,active:true,google_place_id:null,onboarding_approved:true,staff_count:1
      },staff:[{user_id:'staff-fixture',name:'Test Supervisor',email:'supervisor@example.invalid',role:'supervisor',active:true,employment_status:'ACTIVE'}]});
      if(path==='/health')return reply({status:'ok',database:'connected',environment:'test'});
      if(path.endsWith('/collections/users'))return reply({items:[{id:'synthetic-user',full_name:'Previous workspace record'}]});
      if(path.endsWith('/collections/orders')){
        if(delayPlants)await new Promise(resolve=>{releasePlants=resolve;});
        if(plantFails)return route.fulfill({status:403,contentType:'text/html',body:'<h1>private-proxy-diagnostic</h1>'});
        return reply({items:[]});
      }
      if(path.endsWith('/plant-discovery/requests'))return reply({requests:[{id:'test-request',name:'Previous account plant',request_number:'TEST-001',applicant_email:'fixture@example.invalid',address:'Test address',city:'Test city',state:'Test state'}]});
      if(path.endsWith('/auth/logout'))return route.fulfill(failedLogout?{status:503,json:{message:'Synthetic availability failure'}}:{json:{success:true}});
      throw Error('Unexpected API path: '+path);
    });
    const button=name=>page.getByRole('button',{name,exact:true});
    const signIn=async email=>{
      await page.getByLabel('Approved administrator email').fill(email);
      await button('Send email verification code').click();
      await page.getByLabel('Email verification code',{exact:true}).fill('123456');await button('Verify email code').click();
      await page.getByLabel('Authenticator code',{exact:true}).fill('123456');await button('Verify authenticator and sign in').click();
      await page.getByRole('heading',{name:'Command Center',exact:true}).waitFor();
    };
    await page.goto(origin+'/admin/');await signIn('first@example.invalid');
    await page.getByRole('button',{name:'Review admin notifications'}).click();
    await page.getByText('Synthetic approval notice').waitFor();
    await button('Open registered plants').click();
    await page.getByText('Fixture Owner').first().waitFor();
    await button('Open plant record').click();
    await page.getByText('Test Supervisor').waitFor();
    await button('users').click();await page.getByText('Previous workspace record',{exact:true}).waitFor();
    delayPlants=true;await button('orders').click();await page.getByRole('status').filter({hasText:'Loading records'}).waitFor();
    assert.equal(await page.getByText('Previous workspace record',{exact:true}).count(),0);
    for(let i=0;!releasePlants&&i<50;i++)await delay(20);assert(releasePlants);releasePlants();delayPlants=false;
    await button('Retry loading records').waitFor();
    assert.equal(await page.getByText('No records on this page.',{exact:true}).count(),0);
    assert.equal(await page.getByText(/private-proxy-diagnostic/).count(),0);
    plantFails=false;await button('Retry loading records').click();await page.getByText('No records on this page.',{exact:true}).waitFor();
    assert.equal(await button('Retry loading records').count(),0);
    await button('Plant Owner approvals and access').click();await page.getByText('Previous account plant · TEST-001',{exact:true}).waitFor();
    await page.getByLabel('Registered Plant Owner account ID',{exact:true}).fill('previous-account-id');
    await page.getByLabel('Reason for privileged change',{exact:true}).fill('Unsent private account reason');
    await page.getByLabel('Fresh authenticator code',{exact:true}).fill('123456');
    await button('Sign out and revoke session').click();await page.getByRole('heading',{name:'Central Admin sign in',exact:true}).waitFor();
    await page.getByText(failedLogout?'Signed out locally. Server revocation could not be confirmed; the session expires automatically.':'Signed out and server session revoked.',{exact:true}).waitFor();
    assert.equal(await page.getByLabel('Approved administrator email').inputValue(),'');await signIn('second@example.invalid');
    assert.equal(await page.getByLabel('Plant Owner access controls').count(),0);
    assert.equal(await page.getByText('Previous account plant · TEST-001',{exact:true}).count(),0);
    assert.equal(await page.getByText('Test Supervisor',{exact:true}).count(),0);
    assert.equal(await button('Close plant record').count(),0);
    await button('Plant Owner approvals and access').click();
    for(const label of ['Registered Plant Owner account ID','Reason for privileged change','Fresh authenticator code'])assert.equal(await page.getByLabel(label,{exact:true}).inputValue(),'');
    assert.deepEqual(errors,[]);await context.close();
    console.log(`PASS ${width}px: storage policy, loading/failure/empty/retry, private errors and sign-out isolation (${failedLogout?'unconfirmed':'confirmed'} revocation)`);
  }
}finally{await browser?.close();server.kill('SIGTERM');}
