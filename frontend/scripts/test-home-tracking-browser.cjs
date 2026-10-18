const {chromium}=require('../../admin-web/node_modules/playwright');
const fs=require('node:fs');
fs.mkdirSync('tracking-previews',{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 for(const width of [320,390,1440]){
 let mode='demo';
 const page=await browser.newPage({viewport:{width,height:1000}});
 await page.addInitScript(()=>localStorage.setItem('tmrmc_token',JSON.stringify('isolated-browser-fixture')));
 await page.route('https://trackmyrmc.com/api/**',async route=>{
 const path=new URL(route.request().url()).pathname;
 const me={id:'test-customer',name:'Customer',role:'customer',roles:['customer'],status:'active',kyc_status:'VERIFIED',plant_id:null};
 const home={name:'Customer',kyc_status:'VERIFIED',active_order:null,recent_orders:[],nearby_plants:[],unread_notifications:0};
 const order={id:'isolated-order',order_number:'CUSTOMER-ORDER',status:mode==='pending'?'PENDING':mode==='delivered'?'DELIVERED':'DISPATCHED',grade:'M30',quantity:8,site_name:'Actual project'};
 if(mode!=='demo'){home.recent_orders=[order];home.active_order=mode==='delivered'?null:order;}
 const tracking={active:mode==='live',status:order.status,active_loads:mode==='live'?[{id:'load-a',status:'en_route',tm_number:'ASSIGNED-MIXER',location:{lat:19.1,lng:73.1,at:new Date(Date.now()-1000).toISOString()}}]:[],destination:{lat:19.2,lng:73.2}};
 await route.fulfill({json:path.endsWith('/tracking')?tracking:path.endsWith('/permission-consent')?{consent:{version:1,location_choice:'manual',notification_choice:'manual'}}:path.endsWith('/me')?me:path.endsWith('/customer/home')?home:{}});
 });
 page.on('pageerror',e=>console.error(e.message));
 await page.goto('http://127.0.0.1:8765/customer/');
 // Verify real SVG layout (rather than PNG pixel dimensions) at mobile and desktop widths.
 await page.getByTestId('action-new').waitFor({timeout:30000});
 const actualVectorSize = async (testId) => page.getByTestId(testId).locator('svg').first()
   .evaluate(node => [Math.round(node.getBoundingClientRect().width), Math.round(node.getBoundingClientRect().height)]);
 for(const id of ['action-new','action-track','action-plants','action-orders']) {
   const size = await actualVectorSize(id);
   if(size[0]!==75||size[1]!==75)throw Error(`Quick Action SVG size: ${id} ${size}`);
 }
 for(const id of ['customer-module-projects','customer-module-free-tools']) {
   const size=await actualVectorSize(id);
   if(size[0]!==52||size[1]!==52)throw Error(`RMC Tools SVG size: ${id} ${size}`);
 }
 for(const id of ['service-cement','service-labour','service-material']) {
   const size=await actualVectorSize(id);
   if(size[0]!==58||size[1]!==58)throw Error(`Service SVG size: ${id} ${size}`);
 }
 const actionBoxes=await Promise.all(['action-new','action-track','action-plants','action-orders'].map(id=>page.getByTestId(id).boundingBox()));
 const fourAcross=width>=390;
 if(fourAcross && Math.max(...actionBoxes.map(box=>box.y))-Math.min(...actionBoxes.map(box=>box.y))>2)throw Error('Wide Quick Actions must remain four columns');
 if(!fourAcross && !(actionBoxes[2].y>actionBoxes[0].y+50))throw Error('Narrow Quick Actions must use two rows, preserving 75-unit icons');

 // Compact sections have no second border. Keep the individual cards narrow,
 // close together, and short while preserving full-sized SVGs and readable text.
 for (const section of ['home-quick-actions','customer-module-grid','home-other-services']) {
   const locator=page.getByTestId(section);
   const bounds=await locator.boundingBox();
   const border=await locator.evaluate(node=>getComputedStyle(node).borderTopWidth);
   if(border!=='0px')throw Error(`Redundant outer section border on ${section}: ${border}`);
   if(bounds.width>620.5)throw Error(`Oversized desktop outer section: ${section} ${bounds.width}`);
   if(bounds.x<0||bounds.x+bounds.width>width+1)throw Error(`Outer section overflow: ${section}`);
 }
 const boundsOf=async (container,prefix)=>page.getByTestId(container).locator(`[data-testid^="${prefix}"]`)
   .evaluateAll(nodes=>nodes.map(node=>{const box=node.getBoundingClientRect();return {x:box.x,y:box.y,w:box.width,h:box.height,scrollHeight:node.scrollHeight};}));
 const toolBoxes=await boundsOf('customer-module-grid','customer-module-');
 const serviceBoxes=await boundsOf('home-other-services','service-');
 if(toolBoxes.length!==8||serviceBoxes.length!==3)throw Error('Missing compact Home cards');
 const expectedToolColumns=width>=360?4:2;
 if(Math.abs(toolBoxes[expectedToolColumns].y-toolBoxes[0].y)<50)throw Error('RMC Tools responsive row arrangement');
 for (const [kind,boxes,minHeight,maxHeight] of [['Quick Action',actionBoxes.map(box=>({h:box.height,x:box.x,y:box.y,w:box.width})),102,132],['RMC Tool',toolBoxes,90,134],['Other Service',serviceBoxes,92,120]]) {
   for(const box of boxes){
     if(box.h<minHeight||box.h>maxHeight)throw Error(`${kind} card height ${box.h} outside ${minHeight}-${maxHeight}`);
     if(box.x<0||box.x+box.w>width+1)throw Error(`${kind} card overflows the viewport`);
     if(box.scrollHeight&&box.scrollHeight>box.h+1)throw Error(`${kind} text or SVG is clipped`);
   }
   const firstRow=boxes.filter(box=>Math.abs(box.y-boxes[0].y)<2).sort((a,b)=>a.x-b.x);
   for(let i=1;i<firstRow.length;i++) {
     const gap=firstRow[i].x-(firstRow[i-1].x+firstRow[i-1].w);
     if(gap>11||gap<0)throw Error(`${kind} card gap ${gap} violates compact spacing`);
   }
 }
 const tabIds=['tab-home','tab-orders','tab-plants','tab-more'];
 for(const id of tabIds){const size=await actualVectorSize(id);if(size[0]!==35||size[1]!==35)throw Error(`Tab SVG size: ${id} ${size}`);}
 const tabBoxes=await Promise.all(tabIds.map(id=>page.getByTestId(id).boundingBox()));
 const centerBox=await page.getByTestId('tab-quick-actions').boundingBox();
 const centers=tabBoxes.map(box=>box.x+box.width/2);
 const mid=centerBox.x+centerBox.width/2;
 if(!(centers[0]<centers[1]&&centers[1]<mid&&mid<centers[2]&&centers[2]<centers[3]))throw Error('Tab ordering around center icon');
 if(Math.abs((mid-centers[1])-(centers[2]-mid))>4 || Math.abs((mid-centers[0])-(centers[3]-mid))>4)throw Error('Tab spacing is not symmetric');
 const card=page.getByTestId('demo-tracking-card'); try { await card.waitFor({timeout:30000}); } catch(e) { await page.screenshot({path:`tracking-previews/failure-${width}.png`,fullPage:true}); console.error(await page.locator('body').innerText()); throw e; }
 await card.evaluate(el=>el.scrollIntoView({block:'start'}));
 const b=await card.boundingBox();const m=await page.getByTestId('demo-tracking-map').boundingBox();
 if(Math.abs(m.width/m.height-2)>0.05)throw Error('map ratio');
 if(b.x<0||b.x+b.width>width+1)throw Error('overflow');
 for(const text of ['Place Your First order','M-25 Grade · 6 m³','Project site 1','Print Challan','Track TM','Call Driver','Call Plant'])if(!await card.getByText(text,{exact:true}).count())throw Error(text);
 await card.screenshot({path:`tracking-previews/tracking-${width}.png`});
 console.log(JSON.stringify({width,card:b,map:m}));
 await card.getByRole('button',{name:'Track TM',exact:true}).click();
 await page.getByText('Demonstration only. Live tracking becomes available after dispatch.',{exact:true}).waitFor();
 await card.getByRole('button',{name:'Call Driver',exact:true}).click();
 await page.getByText('Driver contact becomes available after assignment.',{exact:true}).waitFor();
 for(const state of ['pending','live','delivered']){
   mode=state; await page.reload();
   const real=page.getByTestId('real-tracking-card');await real.waitFor();
   await real.getByText('CUSTOMER-ORDER',{exact:true}).waitFor();
   await real.getByText('Actual project',{exact:true}).waitFor();
   if(await page.getByTestId('demo-tracking-map').count())throw Error('real order used demo route');
   if(state==='pending')await real.getByText('Waiting for dispatch',{exact:true}).waitFor();
   if(state==='live'){
     await real.getByText('LIVE TRACKING',{exact:true}).waitFor();
     await real.getByText('Transit Mixer · ASSIGNED-MIXER',{exact:true}).waitFor();
     await real.getByText(/19.10000, 73.10000/).waitFor();
   }
   if(state==='delivered')await real.getByText('DELIVERED',{exact:true}).first().waitFor();
 }
 await page.close();
 }
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
