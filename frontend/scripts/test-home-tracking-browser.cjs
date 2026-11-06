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
 // The first paint can use a two-column fallback before onLayout measures
 // the grid. Assert after the responsive four-column calculation settles.
 await page.waitForFunction(() => {
   const ids=['action-new','action-track','action-plants','action-orders'];
   const nodes=ids.map(id=>document.querySelector(`[data-testid="${id}"]`));
   if(nodes.some(node=>!node))return false;
   const ys=nodes.map(node=>node.getBoundingClientRect().top);
   return ys.every(y=>Math.abs(y-ys[0])<2);
 },undefined,{timeout:15000});

 const actualVectorSize = async (testId) => page.getByTestId(testId).locator('svg').first()
   .evaluate(node => [Math.round(node.getBoundingClientRect().width), Math.round(node.getBoundingClientRect().height)]);
 for(const id of ['action-new','action-track','action-plants','action-orders']) {
   const size = await actualVectorSize(id);
   if(size[0]!==52||size[1]!==52)throw Error(`Quick Action SVG size: ${id} ${size}`);
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
 // Round PhonePe-style quick actions: 52dp artwork is displayed inside a
 // 56dp circular frame with the label visibly below, never clipped.
 for(const [id,label] of [['action-new','New Order'],['action-track','Track Order'],['action-plants','Plants'],['action-orders','My Orders']]) {
   const action=page.getByTestId(id);
   const tile=await action.boundingBox();
   const svg=await action.locator('svg').first().boundingBox();
   const name=await action.getByText(label,{exact:true}).boundingBox();
   const circle=await action.locator('svg').first().evaluate(node=>node.parentElement.getBoundingClientRect().toJSON());
   if(!tile||!svg||!name||!circle)throw Error(`Missing Quick Action geometry: ${id}`);
   if(tile.height<95||tile.height>124)throw Error(`Quick Action row height outside 95–124dp: ${id} ${tile.height}`);
   if(Math.abs(circle.width-56)>1||Math.abs(circle.height-56)>1)throw Error(`Missing 56dp circular frame: ${id}`);
   if(svg.y<circle.y-1||name.y<svg.y+svg.height-1||name.y+name.height>tile.y+tile.height+1)
     throw Error(`Quick Action SVG/label clipping: ${id}`);
 }
 const carouselBox=await page.getByTestId('home-promotional-carousel').boundingBox();
 const quickSectionBox=await page.getByTestId('home-quick-actions').boundingBox();
 // Geometry measured from the PhonePe reference, expressed in viewport dp on web.
 if(width<=390) {
   if(Math.abs(quickSectionBox.height-160)>4)
     throw Error('Quick Actions reference section must be about 160dp: '+quickSectionBox.height);
   const titleBox=await page.getByText('Quick Actions',{exact:true}).boundingBox();
   const bannerToTitle=titleBox.y-(carouselBox.y+carouselBox.height);
   if(bannerToTitle<21||bannerToTitle>27)
     throw Error('Banner-to-header text gap must be about 23dp: '+bannerToTitle);
   const slogan=await page.getByText('Built Better',{exact:true}).locator('xpath=..').boundingBox();
   if(Math.abs(slogan.width-106)>1||Math.abs(slogan.height-28)>2)
     throw Error('Built Better pill must be 106x28dp: '+JSON.stringify(slogan));
   for(const [id,label] of [['action-new','New Order'],['action-track','Track Order'],['action-plants','Plants'],['action-orders','My Orders']]){
     const font=await page.getByTestId(id).getByText(label,{exact:true}).evaluate(el=>getComputedStyle(el).fontSize);
     if(font!=='14px')throw Error('Quick Action label must be 14sp: '+id+' '+font);
   }
 }
 const kycBox=await page.getByTestId('kyc-banner').boundingBox();
 const toolSectionBox=await page.getByTestId('customer-module-grid').boundingBox();
 const pumpSectionBox=await page.getByTestId('home-pump-rental-promo').boundingBox();
 const adviceSectionBox=await page.getByTestId('home-advice-grid').boundingBox();
 const otherServicesSectionBox=await page.getByTestId('home-other-services').boundingBox();
 const trackingSectionBox=await page.getByTestId('demo-tracking-card').locator('xpath=..').boundingBox();
 const gapBetween=(above,below)=>below.y-(above.y+above.height);
 for(const [name,actual] of [
   ['carousel to quick actions',gapBetween(carouselBox,quickSectionBox)],
   ['quick actions to KYC',gapBetween(quickSectionBox,kycBox)],
   ['KYC to planning',gapBetween(kycBox,toolSectionBox)],
   ['planning to pump rental',gapBetween(toolSectionBox,pumpSectionBox)],
   ['pump rental to advice',gapBetween(pumpSectionBox,adviceSectionBox)],
   ['advice to supply',gapBetween(adviceSectionBox,otherServicesSectionBox)],
   ['supply to tracking',gapBetween(otherServicesSectionBox,trackingSectionBox)],
 ])if(Math.abs(actual-4)>1)throw Error(`${name} must be 4dp; got ${actual}`);
 for(const title of ['Quick Actions','Active Projects & Planning','Free Tools & Expert Advice','Supply & Workforce','Track My RMC']){
   if(!await page.getByText(title,{exact:true}).count())throw Error(`Home heading missing: ${title}`);
 }
 if(!await page.getByText('Built Better',{exact:true}).count())throw Error('Built Better slogan missing');
 if((await page.getByTestId('action-plants').innerText()).trim()!=='Plants')throw Error('Third Quick Action must be labeled Plants');
 if(Math.max(...actionBoxes.map(box=>box.y))-Math.min(...actionBoxes.map(box=>box.y))>2)
   throw Error('All four Quick Actions must fit one row at 320dp and above');

 // Carousel is full-bleed at mobile widths with the original five-slide source.
 if(width<=390 && (Math.abs(carouselBox.x)>1||Math.abs(carouselBox.width-width)>1))
   throw Error(`Mobile carousel is not full width: ${JSON.stringify(carouselBox)}`);

 // No redundant outer borders. The responsive tools and supply sections have
 // stable test IDs, and all eight catalog actions still have a reachable tile.
 for (const section of ['home-quick-actions','customer-module-grid','home-advice-grid','home-other-services']) {
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
 const adviceBoxes=await boundsOf('home-advice-grid','customer-module-');
 const serviceBoxes=await boundsOf('home-other-services','service-');
 if(toolBoxes.length!==4||adviceBoxes.length!==4||serviceBoxes.length!==3)throw Error('Missing Home cards');
 for(const group of [toolBoxes,adviceBoxes]) {
   if(Math.max(...group.map(box=>box.y))-Math.min(...group.map(box=>box.y))>2)
     throw Error('All four module vectors must fit one row');
 }
 for (const [kind,boxes,minHeight,maxHeight] of [
   ['Quick Action',actionBoxes.map(box=>({h:box.height,x:box.x,y:box.y,w:box.width})),95,124],
   ['Planning Tool',toolBoxes,94,146],
   ['Expert Advice',adviceBoxes,94,146],
   ['Supply',serviceBoxes,92,130],
 ]) {
   for(const box of boxes) {
     if(box.h<minHeight||box.h>maxHeight)throw Error(`${kind} card height ${box.h} outside ${minHeight}-${maxHeight}`);
     if(box.x<0||box.x+box.w>width+1)throw Error(`${kind} card overflows the viewport`);
     if(box.scrollHeight&&box.scrollHeight>box.h+1)throw Error(`${kind} label or SVG is clipped`);
   }
   const firstRow=boxes.filter(box=>Math.abs(box.y-boxes[0].y)<2).sort((a,b)=>a.x-b.x);
   for(let i=1;i<firstRow.length;i++){
     const gap=firstRow[i].x-(firstRow[i-1].x+firstRow[i-1].w);
     if(gap>11||gap<0)throw Error(`${kind} horizontal gap ${gap} outside compact bounds`);
   }
 }
 const promoCards=await page.getByTestId('home-pump-rental-promo').locator(':scope > *').all();
 if(promoCards.length!==2)throw Error('Rental and On Time callouts must be in one row');
 const [left,right]=await Promise.all(promoCards.map(card=>card.boundingBox()));
 if(Math.abs(left.height-right.height)>1)throw Error('Rental and watch cards must have equal height');
 // A 65% booking card + 28% delivery card leaves exactly 7% blank space.
 const row=await page.getByTestId('home-pump-rental-promo').boundingBox();
 if(Math.abs(left.width-row.width*0.65)>1)throw Error('Booking card width must be 65%');
 if(Math.abs(right.width-row.width*0.28)>1)throw Error('On Time card width must be 28%');
 if(Math.abs(right.x-(left.x+left.width)-row.width*0.07)>1)throw Error('Promo gap must be 7%');
 if(left.height<36||right.height<36)throw Error('Promo cards shorter than 36dp minimum');
 if(!await page.getByRole('button',{name:'Book Concrete Pump'}).count())throw Error('Booking accessible button missing');
 for(const title of ['Quick Actions','Active Projects & Planning','Free Tools & Expert Advice','Supply & Workforce','Track My RMC','Built Better']){
   const style=await page.getByText(title,{exact:true}).first().evaluate(el=>{const s=getComputedStyle(el);return {size:s.fontSize,height:s.lineHeight,family:s.fontFamily,weight:s.fontWeight};});
   if(style.size!=='14px'||style.height!=='20px'||!style.family.toLowerCase().includes('roboto')||Number(style.weight)!==700)
     throw Error('Home heading typography regression '+title+': '+JSON.stringify(style));
 }
 if(!await page.getByTestId('header-location').count())throw Error('Location header missing');

 // Export full-page Home references at the exact mobile/desktop sizes that
 // the layout gates check; CI uploads them for human visual comparison.
 await page.screenshot({path:`tracking-previews/home-layout-${width}.png`,fullPage:true});
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
