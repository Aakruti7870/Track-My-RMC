// After build:preview, serve dist on port 8765. Reuses admin-web's Playwright dependency.
const {chromium}=require('../../admin-web/node_modules/playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const out=process.env.HEADER_PREVIEW_DIR||'header-previews';fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.HEADER_CHROMIUM_PATH?{executablePath:process.env.HEADER_CHROMIUM_PATH}:{})});
 try {for(const scheme of ['light','dark'])for(const width of [320,390,768,1440]){
  let kyc='VERIFIED',unread=1,locationFailure=false,deletionRequests=0;
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(({scheme})=>{
   localStorage.setItem('tmrmc_token',JSON.stringify('isolated-header-test'));
   localStorage.setItem('tmrmc_theme_mode',JSON.stringify(scheme));
   window.headerGeoMode='denied';window.headerGeoCalls=0;
   navigator.geolocation.getCurrentPosition=(success,failure)=>{window.headerGeoCalls++;if(window.headerGeoMode==='denied')failure({code:1});else if(window.headerGeoMode==='timeout')failure({code:3});else success({coords:{latitude:18.99,longitude:73.11}});};
   navigator.geolocation.watchPosition=()=>{throw Error('Header started background tracking');};
  },{scheme});
  await page.route('**/api/**',async route=>{
   const path=new URL(route.request().url()).pathname;let json={};
   if(path.endsWith('/me'))json={id:'header-customer',name:'Test Customer',role:'customer',roles:['customer'],phone:'12025550171',status:'active',kyc_status:kyc,plant_id:null};
   else if(path.endsWith('/permission-consent'))json={consent:{version:1,location_choice:'manual',notification_choice:'manual'}};
   else if(path.endsWith('/customer/home'))json={name:'Test Customer',kyc_status:kyc,active_order:null,recent_orders:[],nearby_plants:[],unread_notifications:unread};
   else if(path.endsWith('/notifications/read-all')||/\/notifications\/[^/]+\/read$/.test(path)){unread=0;json={success:true};}
   else if(path.endsWith('/notifications'))json={unread,items:[{id:'test-notification',event:'dispatched',title:'Test dispatch update',body:'Synthetic notification fixture',read:!unread,created_at:null}]};
   else if(path.endsWith('/maps/geocode')){if(locationFailure)return route.fulfill({status:503,json:{detail:'Location lookup unavailable. Please retry.'}});json={locality:'Panvel',formatted_address:'Panvel, Maharashtra',lat:18.99,lng:73.11};}
   else if(path.endsWith('/account-deletion/status'))json={request:null};
   else if(path.endsWith('/account-deletion/otp/send'))json={success:true,channel:'whatsapp'};
   else if(path.endsWith('/account-deletion/request')){deletionRequests++;json={success:true};}
   else if(path.endsWith('/assistant/support/cases'))json={cases:[]};
   await route.fulfill({json});
  });
  const home=async()=>{await page.goto('http://127.0.0.1:8765/customer/');await page.getByTestId('customer-home-header').waitFor();};
  await home();const header=page.getByTestId('customer-home-header');
  await page.getByTestId('header-unread-dot').waitFor();
  const headerSurface=await header.evaluate(node=>getComputedStyle(node.parentElement).backgroundColor);
  assert.match(headerSurface,scheme==='light'?/rgba\(255,\s*255,\s*255,\s*0\.92\)/:/rgba\(20,\s*24,\s*31,\s*0\.94\)/,`theme-aware glass surface expected at ${width}px, got ${headerSurface}`);

  assert.equal(await page.evaluate(()=>window.headerGeoCalls),0,'manual consent triggered GPS');
  let previousRight=0;
  for(const id of ['header-kyc','header-location','header-qr-disabled','notifications-bell','header-help']){
   const b=await page.getByTestId(id).boundingBox();assert(b&&b.x>=previousRight-1&&b.x+b.width<=width+1&&b.height>=44,`${id} overlap, clipping or small target at ${width}`);previousRight=b.x+b.width;
  }
  assert.equal(await page.getByTestId('header-qr-disabled').getAttribute('aria-disabled'),'true');
  assert.match(await page.getByTestId('header-kyc').getAttribute('aria-label'),/VERIFIED/);
  await header.screenshot({path:`${out}/header-${scheme}-${width}.png`});
  if(width===390){
   await page.getByTestId('header-location').click();
   await page.getByRole('button',{name:'Refresh current location',exact:true}).click();
   await page.getByText('Location permission was denied. Select a city manually.',{exact:true}).waitFor();
   await page.evaluate(()=>{window.headerGeoMode='timeout';});
   await page.getByRole('button',{name:'Refresh current location',exact:true}).click();
   await page.getByText('Location is unavailable or timed out. Please retry or select a city.',{exact:true}).waitFor();
   await page.getByTestId('header-manual-location').fill('Panvel');locationFailure=true;
   await page.getByRole('button',{name:'Use selected location',exact:true}).click();
   await page.getByText('Server down',{exact:true}).waitFor();locationFailure=false;
   await page.getByRole('button',{name:'Use selected location',exact:true}).click();
   await page.getByTestId('header-location').getByText('Panvel',{exact:true}).waitFor();
   await header.screenshot({path:`${out}/header-${scheme}-selected-location.png`});
   await page.getByTestId('notifications-bell').click();await page.getByTestId('notif-read-all').click();
   await page.getByTestId('notif-read-all').waitFor({state:'detached'});kyc='PENDING';
   await page.getByTestId('notif-back').click();
   await page.waitForFunction(()=>document.querySelector('[data-testid="header-kyc"]')?.getAttribute('aria-label')?.includes('PENDING'));
   await page.getByTestId('header-unread-dot').waitFor({state:'detached'});
   await page.getByTestId('header-kyc').click();await page.getByText('KYC status: pending',{exact:true}).waitFor();
   await page.getByRole('button',{name:'Close dialog',exact:true}).last().click();
   await page.getByTestId('header-help').click();
   await page.getByRole('button',{name:'Customer Support',exact:true}).last().waitFor();await page.getByRole('button',{name:'Delete Account',exact:true}).waitFor();
   assert.equal(await page.getByRole('button',{name:/^(Profile|Settings|Logout)$/}).count(),0);
   await page.waitForTimeout(400); // Let the native-style modal fade finish before capturing evidence.
   await page.screenshot({path:`${out}/header-${scheme}-help.png`,animations:'disabled'});
   await page.getByRole('button',{name:'Customer Support',exact:true}).last().click();await page.waitForURL('**/support');
   assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('tmrmc_token'))),'isolated-header-test');
   await home();await page.getByTestId('header-help').click();await page.getByRole('button',{name:'Delete Account',exact:true}).click();
   await page.waitForURL('**/account-deletion');assert.equal(deletionRequests,0);
   const submit=page.getByRole('button',{name:'Request Account Deletion',exact:true});assert.equal(await submit.getAttribute('aria-disabled'),'true');
   await page.getByRole('button',{name:'Send Deletion Verification Code',exact:true}).click();await page.getByTestId('deletion-otp').fill('123456');
   assert.equal(await submit.getAttribute('aria-disabled'),'true');
   await page.getByRole('textbox',{name:'Type "DELETE" to confirm',exact:true}).fill('DELETE');
   assert.notEqual(await submit.getAttribute('aria-disabled'),'true');assert.equal(deletionRequests,0);
  }
  assert.deepEqual(errors,[]);console.log(`PASS ${scheme} ${width}px: five controls, backend status, QR disabled${width===390?', location errors/retry, unread sync, KYC transition, support and deletion safeguards':''}`);
  await context.close();
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
