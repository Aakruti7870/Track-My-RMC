const {chromium}=require('../../admin-web/node_modules/playwright');
const fs=require('node:fs');
const assert=require('node:assert/strict');
fs.mkdirSync('tracking-previews',{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.HEADER_CHROMIUM_PATH ? {executablePath:process.env.HEADER_CHROMIUM_PATH} : {})});
 for(const width of [320,390,768,960,1024,1440]){
  const expected=width>=1024
    ? {quick:28,tool:28,service:28,quickTile:88,toolTile:84,serviceTile:84,quickFont:16,toolFont:14,serviceFont:15,heading:18,headingLine:24,sectionGap:16,actionHeight:120,kyc:36,kycTitle:18,location:15}
    : width>=600
      ? {quick:24,tool:24,service:24,quickTile:84,toolTile:80,serviceTile:80,quickFont:15,toolFont:13,serviceFont:14,heading:16,headingLine:22,sectionGap:12,actionHeight:112,kyc:32,kycTitle:16,location:14}
      : {quick:24,tool:24,service:24,quickTile:80,toolTile:76,serviceTile:76,quickFont:14,toolFont:12,serviceFont:12,heading:15,headingLine:20,sectionGap:10,actionHeight:112,kyc:28,kycTitle:15,location:13};
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
 await route.fulfill({json:path.endsWith('/customer/plants/search')?{plants:[{id:'fixture-plant',name:'Panvel Ready-Mix Concrete and Infrastructure Supply',address:'Industrial Estate, Panvel',status:'active',verified:true,order_enabled:true,grades:['M30'],distance_km:4.2}],page:1,has_more:false}:path.endsWith('/tracking')?tracking:path.endsWith('/customer/service-enquiries')?{enquiries:[]}:path.endsWith('/customer/plants')?{plants:[]}:path.endsWith('/permission-consent')?{consent:{version:1,location_choice:'manual',notification_choice:'manual'}}:path.endsWith('/me')?me:path.endsWith('/customer/home')?home:{}});
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
   if(size[0]!==expected.quick||size[1]!==expected.quick)throw Error(`Quick Action SVG size: ${id} ${size} at ${width}`);
 }
 for(const id of ['customer-module-projects','customer-module-free-tools']) {
   const size=await actualVectorSize(id);
   if(size[0]!==expected.tool||size[1]!==expected.tool)throw Error(`RMC Tools SVG size: ${id} ${size} at ${width}`);
 }
 for(const id of ['service-cement','service-labour','service-material']) {
   const size=await actualVectorSize(id);
   if(size[0]!==expected.service||size[1]!==expected.service)throw Error(`Service SVG size: ${id} ${size} at ${width}`);
 }
 const content=await page.getByTestId('customer-home-scroll').boundingBox();
 const tabBar=await page.getByTestId('app-tab-bar').boundingBox();
 if(!content||!tabBar||content.y+content.height>tabBar.y+1)throw Error('Navigation overlaps Home content');
 assert.equal(await page.getByTestId('header-help').count(),1);
 assert.equal(await page.getByTestId('customer-module-customer-support').count(),0);
 assert.equal(await page.getByTestId('customer-next-action').count(),0);
 const textClipping=await page.locator('[data-testid^="customer-module-"], [data-testid^="service-"]').evaluateAll(nodes =>
   nodes.flatMap(node => Array.from(node.querySelectorAll('div')).filter(el =>
     el.childElementCount===0 && el.textContent.trim() &&
     (el.scrollHeight>el.clientHeight+1||el.scrollWidth>el.clientWidth+1)).map(el=>el.textContent)));
 if(textClipping.length)throw Error('Home tile text is clipped: '+textClipping.join(', '));
 const actionBoxes=await Promise.all(['action-new','action-track','action-plants','action-orders'].map(id=>page.getByTestId(id).boundingBox()));
 // Verify compact, single-ink icons with visible labels and touch targets.
 for(const [id,label] of [['action-new','New Order'],['action-track','Track Order'],['action-plants','Plants'],['action-orders','My Orders']]) {
   const action=page.getByTestId(id);
   const tile=await action.boundingBox();
   const svg=await action.locator('svg').first().boundingBox();
   const name=await action.getByText(label,{exact:true}).boundingBox();
   const icon = action.locator('svg');
   if(!tile||!svg||!name)throw Error(`Missing Quick Action geometry: ${id}`);
   if(tile.height<expected.quickTile-1||tile.height>expected.quickTile+30)throw Error(`Quick Action tile height mismatch: ${id} ${tile.height} at ${width}`);
   if(svg.y<tile.y||name.y<svg.y+svg.height-1||name.y+name.height>tile.y+tile.height+1)
     throw Error(`Quick Action SVG/label clipping: ${id}`);
   if(await icon.getAttribute('aria-hidden')!=='true'||await icon.locator('path').count()!==1)
     throw Error(`Quick Action must render one decorative vector path: ${id}`);
 }
 const carouselBox=await page.getByTestId('home-promotional-carousel').boundingBox();
 const quickSectionBox=await page.getByTestId('home-quick-actions').boundingBox();
 if(width<=390) {
   const titleBox=await page.getByText('Quick Actions',{exact:true}).boundingBox();
   const bannerToSection=quickSectionBox.y-(carouselBox.y+carouselBox.height);
   if(Math.abs(bannerToSection-10)>1)
     throw Error('Carousel-to-Quick Actions section gap must be 10dp: '+bannerToSection);
   const bannerToTitle=titleBox.y-(carouselBox.y+carouselBox.height);
   if(bannerToTitle<10||bannerToTitle>18)
     throw Error('Quick Actions title must fit below the 10dp section gap: '+bannerToTitle);

   for(const [id,label] of [['action-new','New Order'],['action-track','Track Order'],['action-plants','Plants'],['action-orders','My Orders']]){
     const font=await page.getByTestId(id).getByText(label,{exact:true}).evaluate(el=>getComputedStyle(el).fontSize);
     if(font!=='14px')throw Error('Quick Action label must be 14sp: '+id+' '+font);
   }
 }
 const expectedQuickHeight=expected.headingLine+expected.sectionGap+expected.quickTile;
 if(quickSectionBox.height<expectedQuickHeight-1||quickSectionBox.height>expectedQuickHeight+24)
   throw Error('Quick Actions height mismatch at '+width+': '+quickSectionBox.height+' vs '+expectedQuickHeight);
 const kycIcon=await actualVectorSize('kyc-banner');
 if(kycIcon[0]!==expected.kyc||kycIcon[1]!==expected.kyc)
   throw Error('KYC symbol mismatch at '+width+': '+kycIcon);
 const kycTitleSize=await page.getByTestId('kyc-banner').getByText('KYC verified',{exact:true})
   .evaluate(el=>getComputedStyle(el).fontSize);
 if(kycTitleSize!==expected.kycTitle+'px')throw Error('KYC title mismatch at '+width+': '+kycTitleSize);
 const kycBox=await page.getByTestId('kyc-banner').boundingBox();
 const toolSectionBox=await page.getByTestId('customer-module-grid').boundingBox();
 const actionSectionBox=await page.getByTestId('home-planning-actions').boundingBox();
 const adviceSectionBox=await page.getByTestId('home-advice-grid').boundingBox();
 const otherServicesSectionBox=await page.getByTestId('home-other-services').boundingBox();
 const trackingSectionBox=await page.getByTestId('demo-tracking-card').locator('xpath=..').boundingBox();
 const gapBetween=(above,below)=>below.y-(above.y+above.height);
 for(const [name,actual] of [
   ['carousel to quick actions',gapBetween(carouselBox,quickSectionBox)],
   ['quick actions to KYC',gapBetween(quickSectionBox,kycBox)],
   ['KYC to planning',gapBetween(kycBox,toolSectionBox)],
   ['planning to order actions',gapBetween(toolSectionBox,actionSectionBox)],
   ['order actions to advice',gapBetween(actionSectionBox,adviceSectionBox)],
   ['advice to supply',gapBetween(adviceSectionBox,otherServicesSectionBox)],
   ['supply to tracking',gapBetween(otherServicesSectionBox,trackingSectionBox)],
   ])if(Math.abs(actual-expected.sectionGap)>1)throw Error(`${name} must be ${expected.sectionGap}dp; got ${actual}`);
 for(const title of ['Quick Actions','Active Projects & Planning','Free Tools & Expert Advice','Supply & Workforce','Track My RMC']){
   if(!await page.getByText(title,{exact:true}).count())throw Error(`Home heading missing: ${title}`);
 }
 if((await page.getByTestId('action-plants').innerText()).trim()!=='Plants')throw Error('Third Quick Action must be labeled Plants');
 if(Math.max(...actionBoxes.map(box=>box.y))-Math.min(...actionBoxes.map(box=>box.y))>2)
   throw Error('All four Quick Actions must fit one row at 320dp and above');

 const homeHeader = await page.getByTestId('customer-home-header').boundingBox();
 assert(Math.abs(carouselBox.y - (homeHeader.y + homeHeader.height) - 10) <= 1, 'Carousel starts under the fixed header');
 assert(Math.abs(carouselBox.width - Math.min(width - 32, 620)) <= 1, 'Carousel shares Home gutters');
 assert(Math.abs(carouselBox.width / carouselBox.height - 16 / 9) < 0.03, 'Carousel preserves artwork ratio');

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
 if(toolBoxes.length!==4||adviceBoxes.length!==3||serviceBoxes.length!==3)throw Error('Missing Home cards');
 for(const [group,columns] of [[toolBoxes,4],[adviceBoxes,3]]) {
   const firstRow = group.filter(box => Math.abs(box.y - group[0].y) < 2);
   if (firstRow.length !== (width < 382 ? 2 : columns)) throw Error('Tool columns must adapt to width');
 }
 for (const [kind,boxes,minHeight,maxHeight] of [
   ['Quick Action',actionBoxes.map(box=>({h:box.height,x:box.x,y:box.y,w:box.width})),expected.quickTile-1,expected.quickTile+30],
   ['Planning Tool',toolBoxes,expected.toolTile-8,expected.toolTile+45],
   ['Expert Advice',adviceBoxes,expected.toolTile-8,expected.toolTile+45],
   ['Supply',serviceBoxes,expected.serviceTile-10,expected.serviceTile+35],
 ]) {
   for(const box of boxes) {
     if(box.h<minHeight||box.h>maxHeight)throw Error(`${kind} card height ${box.h} outside ${minHeight}-${maxHeight}`);
     if(box.x<0||box.x+box.w>width+1)throw Error(`${kind} card overflows the viewport`);
     if(box.scrollHeight&&box.scrollHeight>box.h+1)throw Error(`${kind} label or SVG is clipped`);
   }
   const firstRow=boxes.filter(box=>Math.abs(box.y-boxes[0].y)<2).sort((a,b)=>a.x-b.x);
   for(let i=1;i<firstRow.length;i++){
     const gap=firstRow[i].x-(firstRow[i-1].x+firstRow[i-1].w);
     if(gap>12||gap<0)throw Error(`${kind} horizontal gap ${gap} outside compact bounds`);
   }
 }
 const pump = page.getByTestId('home-pump-rental');
 const request = page.getByTestId('home-order-request');
 const [pumpBox, requestBox] = await Promise.all([pump.boundingBox(), request.boundingBox()]);
 assert(Math.abs(pumpBox.y - requestBox.y) <= 1, 'Planning actions must share a row');
 assert(Math.abs(pumpBox.height - requestBox.height) <= 1 && requestBox.height >= expected.actionHeight - 1,
   'Both planning actions must match the taller card');
 assert(Math.abs(pumpBox.width - requestBox.width) <= 1, 'Planning actions must have equal widths');
 assert(Math.abs(requestBox.x - (pumpBox.x + pumpBox.width) - expected.sectionGap) <= 1, 'Planning actions need the responsive gutter');
 for (const id of ['home-pump-rental', 'home-order-request']) {
   assert.deepEqual(await actualVectorSize(id), [expected.tool, expected.tool]);
 }
 await pump.getByText('Concrete pump rental',{exact:true}).waitFor();
 await pump.getByText('Request a quote',{exact:true}).waitFor();
 await request.getByText('Start an Order Request',{exact:true}).waitFor();
 await request.getByText('Build and save a request without completing KYC first',{exact:true}).waitFor();
 if(await page.getByText('On Time, Everytime').count())throw Error('Removed On Time card still appears');
 for(const title of ['Quick Actions','Active Projects & Planning','Free Tools & Expert Advice','Supply & Workforce','Track My RMC']){
   const style=await page.getByText(title,{exact:true}).first().evaluate(el=>{const s=getComputedStyle(el);return {size:s.fontSize,height:s.lineHeight,family:s.fontFamily};});
   if(style.size!==expected.heading+'px'||style.height!==expected.headingLine+'px'||!style.family.toLowerCase().includes('jakarta-bold'))
     throw Error('Home heading typography regression '+title+': '+JSON.stringify(style));
 }
 if(!await page.getByTestId('header-location').count())throw Error('Location header missing');
 const locationFont=await page.getByTestId('header-location').getByText('Select Location',{exact:true})
   .evaluate(el=>getComputedStyle(el).fontSize);
 if(locationFont!==expected.location+'px')throw Error('Location typography mismatch at '+width+': '+locationFont);
 for(const [id,label,font] of [['customer-module-projects','Project Hub',expected.toolFont],['service-cement','Cement',expected.serviceFont]]){
   const actual=await page.getByTestId(id).getByText(label,{exact:true}).evaluate(el=>getComputedStyle(el).fontSize);
   if(actual!==font+'px')throw Error('Responsive label mismatch at '+width+': '+id+' '+actual);
 }

 // Export full-page Home references at the exact mobile/desktop sizes that
 // the layout gates check; CI uploads them for human visual comparison.
 await page.screenshot({path:`tracking-previews/home-layout-${width}.png`,fullPage:true});
 const tabIds=['tab-home','tab-orders','tab-plants','tab-more'];
 for(const id of tabIds){const size=await actualVectorSize(id);if(size[0]!==24||size[1]!==24)throw Error(`Tab SVG size: ${id} ${size}`);}
 const tabBoxes=await Promise.all(tabIds.map(id=>page.getByTestId(id).boundingBox()));
 const centerBox=await page.getByTestId('tab-new-order').boundingBox();
 const centers=tabBoxes.map(box=>box.x+box.width/2);
 const mid=centerBox.x+centerBox.width/2;
 if(!(centers[0]<centers[1]&&centers[1]<mid&&mid<centers[2]&&centers[2]<centers[3]))throw Error('Tab ordering around center icon');
 if(Math.abs((mid-centers[1])-(centers[2]-mid))>4 || Math.abs((mid-centers[0])-(centers[3]-mid))>4)throw Error('Tab spacing is not symmetric');
 const card=page.getByTestId('demo-tracking-card'); try { await card.waitFor({timeout:30000}); } catch(e) { await page.screenshot({path:`tracking-previews/failure-${width}.png`,fullPage:true}); console.error(await page.locator('body').innerText()); throw e; }
 await page.getByTestId('customer-home-scroll').evaluate((scroll) => {
   const card = scroll.querySelector('[data-testid="demo-tracking-card"]');
   scroll.scrollTo(0, scroll.scrollTop + card.getBoundingClientRect().top - scroll.getBoundingClientRect().top);
 });
 const b=await card.boundingBox();
 assert.equal(Math.round((await page.getByTestId('customer-home-header').boundingBox()).y), Math.round(homeHeader.y));
 assert.equal(Math.round((await page.getByTestId('app-tab-bar').boundingBox()).y), Math.round(tabBar.y));
 if(await page.getByTestId('demo-tracking-map').count())throw Error('The home tracking map should be collapsed initially');
 await card.getByTestId('home-toggle-tracking-map').click();
 const m=await page.getByTestId('demo-tracking-map').boundingBox();
 assert.equal(Math.round((await page.getByTestId('customer-home-header').boundingBox()).y), Math.round(homeHeader.y));
 if(!m||Math.abs(m.width/m.height-2)>0.05)throw Error('map ratio');
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
   assert.equal(await page.getByText('Current order',{exact:true}).count(),0);
   await real.getByRole('button',{name:'View order details for CUSTOMER-ORDER'}).waitFor();
   if(await page.getByTestId('demo-tracking-map').count())throw Error('real order used demo route');
   if(state==='pending'){await real.getByTestId('home-toggle-tracking-map').click();await real.getByText('Waiting for dispatch',{exact:true}).waitFor();}
   if(state==='live'){
     await real.getByText('LIVE TRACKING',{exact:true}).waitFor();
     await real.getByText('Transit Mixer · ASSIGNED-MIXER',{exact:true}).waitFor();
     await real.getByText(/19.10000, 73.10000/).waitFor();
   }
   if(state==='delivered')await real.getByText('DELIVERED',{exact:true}).first().waitFor();
   if(state==='live' && width===390){
     await real.getByTestId('home-view-order-details').click();
     await page.waitForURL('**/order/isolated-order');
     await page.getByTestId('order-back').waitFor();
     await page.goBack();
   }
 }
 if(width===320){
   mode='demo';
   await page.setViewportSize({width,height:480});
   await page.emulateMedia({reducedMotion:'reduce'});
   await page.route('http://127.0.0.1:8765/customer/request-quotation?*',async route=>{
     const response=await route.fetch({url:'http://127.0.0.1:8765/customer/request-quotation.html'});
     await route.fulfill({response});
   });
   for(const theme of ['light','dark']){
     await page.evaluate(value=>localStorage.setItem('tmrmc_theme_mode',JSON.stringify(value)),theme);
     await page.goto('http://127.0.0.1:8765/customer/');
     await page.getByTestId('customer-module-compare-plants').waitFor();
     const clipped=await page.evaluate(()=>{
       const labels=[...document.querySelectorAll('[data-testid^="action-"],[data-testid^="customer-module-"],[data-testid^="service-"],[data-testid="home-pump-rental"],[data-testid="home-order-request"],[role="tab"]')]
         .filter(el=>el.matches('[role="button"],[role="tab"]'))
         .flatMap(el=>[...el.querySelectorAll('div')].filter(text=>!text.childElementCount&&text.textContent.trim()));
       for(const label of labels){
         const style=getComputedStyle(label);
         label.style.fontSize=2*parseFloat(style.fontSize)+'px';
         label.style.lineHeight=2*parseFloat(style.lineHeight)+'px';
       }
       return labels.filter(label=>label.scrollHeight>label.clientHeight+1||label.scrollWidth>label.clientWidth+1)
         .map(label=>label.textContent);
     });
     assert.deepEqual(clipped,[],theme+' Home and navigation text at 200%');
     const help=page.getByTestId('header-help');
     await help.click();
     await page.getByTestId('customer-support-place-order').click();
     await page.getByTestId('customer-support-place-order-card').waitFor();
     await page.getByTestId('customer-support-close').click();
     await page.getByTestId('customer-support-panel').waitFor({state:'hidden'});

     await page.getByTestId('home-pump-rental').click();
     await page.waitForURL(/\/customer\/service-enquiry\/?\?service=pump/);
     await page.getByText('Concrete Pump Rental Enquiry',{exact:true}).waitFor();
     await page.goBack();
     await page.getByTestId('home-order-request').click();
     await page.waitForURL('**/new-order');
     await page.getByTestId('neworder-draft').waitFor();
     await page.goBack();
     await page.getByTestId('tab-new-order').click();
     await page.waitForURL('**/new-order');
     await page.goBack();
     await page.getByTestId('tab-plants').click();
     const plant=page.getByTestId('nearby-plant-fixture-plant');
     await plant.waitFor();
     assert.equal(await plant.getByRole('button',{name:/^Show .* on map$/}).count(),1);
     const order=plant.getByTestId('nearby-place-order');
     const ink=await order.getByText('Place Order').evaluate(el=>getComputedStyle(el).color);
     assert.equal(ink,'rgb(14, 17, 22)');
     const target=await order.boundingBox();
     assert(target.height>=48 && target.width>180,theme+' narrow plant primary action must be full width');
     await plant.getByRole('button',{name:'Request Quotation',exact:true}).click();
     await page.getByRole('button',{name:'Submit Quotation Request',exact:true}).click();
     assert.equal(await page.getByRole('textbox',{name:'Required Quantity (m³)',exact:true}).getAttribute('aria-invalid'),'true');
     await page.getByRole('button',{name:'Concrete grade: M25',exact:true}).click();
     await page.getByRole('radio',{name:'M30',exact:true}).click();
     await page.getByRole('button',{name:'Concrete grade: M30',exact:true}).waitFor();
     await page.getByRole('button',{name:/^Required delivery date:/i}).click();
     const calendar=page.getByTestId('rfq-date-calendar');
     await calendar.waitFor();
     const surface=await calendar.evaluate(el=>getComputedStyle(el).backgroundColor);
     assert.equal(surface,theme==='light'?'rgb(255, 255, 255)':'rgb(32, 38, 46)');
     await calendar.getByRole('button',{name:'Next month',exact:true}).click();
     await calendar.getByRole('button',{name:'Close Calendar',exact:true}).click();
     await calendar.waitFor({state:'hidden'});
     console.log('PASS 320px '+theme+' enlarged labels, header Support and matte RFQ calendar');
   }
 }
 await page.close();
 }
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
