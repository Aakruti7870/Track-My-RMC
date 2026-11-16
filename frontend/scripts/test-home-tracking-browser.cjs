const {chromium}=require('../../admin-web/node_modules/playwright');
const fs=require('node:fs');
const assert=require('node:assert/strict');
fs.mkdirSync('tracking-previews',{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.HEADER_CHROMIUM_PATH ? {executablePath:process.env.HEADER_CHROMIUM_PATH} : {})});
 for(const width of [320,390,768,960,1024,1440]){
 let mode='demo';
 let reviewSubmission;
 const page=await browser.newPage({viewport:{width,height:1000}});
 await page.addInitScript(()=>localStorage.setItem('tmrmc_token',JSON.stringify('isolated-browser-fixture')));
 await page.route('https://trackmyrmc.com/api/**',async route=>{
 const path=new URL(route.request().url()).pathname;
 if (path.endsWith('/customer/plant-order-requests')) {
   if (route.request().method() === 'POST') {
     reviewSubmission = route.request().postDataJSON();
     await route.fulfill({json:{id:'admin-review-fixture',status:'PENDING_ADMIN_REVIEW'}});
   } else {
     await route.fulfill({json:{requests:reviewSubmission ? [{
       id:'admin-review-fixture',grade:reviewSubmission.grade,quantity_m3:reviewSubmission.quantity_m3,
       site_address:reviewSubmission.site_address,delivery_date:reviewSubmission.delivery_date,
     }] : []}});
   }
   return;
 }
 if (path.endsWith('/customer/service-enquiries') && route.request().method() === 'POST') {
   await route.fulfill({ status: 201, json: { id: 'isolated-enquiry', status: 'NEW' } });
   return;
 }
 const me={id:'test-customer',name:'Customer',role:'customer',roles:['customer'],status:'active',kyc_status:'VERIFIED',phone:'9000000000',plant_id:null};
 const home={name:'Customer',kyc_status:'VERIFIED',active_order:null,recent_orders:[],nearby_plants:[],unread_notifications:0};
 const order={id:'isolated-order',order_number:'CUSTOMER-ORDER',status:mode==='pending'?'PENDING':mode==='delivered'?'DELIVERED':'DISPATCHED',grade:'M30',quantity:8,site_name:'Actual project'};
 if(mode!=='demo'){home.recent_orders=[order];home.active_order=mode==='delivered'?null:order;}
 const tracking={active:mode==='live',status:order.status,active_loads:mode==='live'?[{id:'load-a',status:'en_route',tm_number:'ASSIGNED-MIXER',location:{lat:19.1,lng:73.1,at:new Date(Date.now()-1000).toISOString()}}]:[],destination:{lat:19.2,lng:73.2}};
 const plants=[{id:'fixture-plant',name:'Panvel Ready-Mix Concrete and Infrastructure Supply',address:'Industrial Estate, Panvel',status:'active',verified:true,order_enabled:true,grades:['M30'],distance_km:4.2}];
 const linkedPlant={...plants[0],id:'fixture-plant-off-page',name:'Registered Linked Concrete'};
 if (path.endsWith('/customer/plants/search')) {
   await route.fulfill({json:{plants,page:1,has_more:false}});return;
 }
 if (path.endsWith('/customer/plants/locate')) {
   await route.fulfill({json:{lat:19.1,lng:73.1,label:'Panvel'}});return;
 }
 if (path.endsWith('/customer/plants/google-nearby')) {
   const google={place_id:'ChIJ_review_fixture',name:'Independent Concrete',address:'Panvel',lat:19.11,lng:73.11,distance_km:2,verified:false,order_enabled:false};
   await route.fulfill({json:{places:[
     google,
     {...google,place_id:'ChIJ_linked_fixture',name:linkedPlant.name,verified:true,order_enabled:true,
       registered_plant:{id:linkedPlant.id,order_intake_mode:'DIRECT'}},
     {...google,place_id:'ChIJ_rfq_fixture',name:'Quotation-only Concrete',verified:true,
       registered_plant:{id:'fixture-rfq-only',order_intake_mode:'RFQ_ONLY'}},
   ],source:'google_places',attribution:'Google Maps',radius_km:50}});return;
 }
 if (path.endsWith('/maps/autocomplete')) {
   await route.fulfill({json:{predictions:[]}});return;
 }
 await route.fulfill({json:path.endsWith('/tracking')?tracking:path.endsWith('/customer/service-enquiries')?{enquiries:[]}:path.endsWith('/customer/plants')?{plants:[...plants,linkedPlant]}:path.endsWith('/customer/orders')?{orders:[]}:path.endsWith('/customer/order-drafts')?{drafts:[]}:path.endsWith('/permission-consent')?{consent:{version:1,location_choice:'manual',notification_choice:'manual'}}:path.endsWith('/me')?me:path.endsWith('/customer/home')?home:{}});
 });
 page.on('pageerror',e=>console.error(e.message));
 await page.goto('http://127.0.0.1:8765/customer/');
 await page.getByTestId('action-new').waitFor({timeout:30000});
 await page.getByText('KYC Verified', { exact: true }).first().waitFor();
 const actualVectorSize = async (testId) => page.getByTestId(testId).locator('svg').first()
   .evaluate(node => [Math.round(node.getBoundingClientRect().width), Math.round(node.getBoundingClientRect().height)]);
 const scroll = page.getByTestId('customer-home-scroll');
 const content = await scroll.boundingBox();
 const tabBar = await page.getByTestId('app-tab-bar').boundingBox();
 const homeHeader = await page.getByTestId('customer-home-header').boundingBox();
 assert(content && tabBar && homeHeader && content.y + content.height <= tabBar.y + 1);
 assert.equal(await page.getByTestId('header-help').count(), 1);
 assert.equal(await page.getByTestId('customer-next-action').count(), 0);
 const sections = await Promise.all([
   'home-promotional-carousel', 'home-quick-actions', 'kyc-banner', 'customer-module-grid', 'home-other-services',
 ].map(id => page.getByTestId(id).boundingBox()));
 for (let i = 1; i < sections.length; i++) {
   const previous = sections[i - 1], next = sections[i];
   assert(next.y - previous.y - previous.height >= 8, 'Home sections must appear in design order with gutter spacing');
   assert(next.x >= 0 && next.x + next.width <= width + 1, 'Home section exceeds viewport');
 }
 assert(Math.abs(sections[0].width / sections[0].height - 16 / 9) < 0.03, 'Carousel preserves artwork ratio');
 assert.equal(await scroll.getByTestId('home-promotional-carousel').count(), 1);
 assert.equal(await page.getByTestId('customer-home-scroll').getByTestId('kyc-banner').count(), 1);
 const bulk = page.getByTestId('home-bulk-quote');
 assert((await bulk.boundingBox()).height >= 49);
 await page.getByTestId('home-quick-actions').getByRole('heading', { name: 'Quick Access', exact: true }).waitFor();
 await bulk.getByText('Concrete in bulk? Get our best rate for your project.', { exact: true }).waitFor();
 await page.getByTestId('kyc-banner').getByText('KYC Verified', { exact: true }).waitFor();
 const planning = page.getByTestId('customer-module-grid');
 const materials = page.getByTestId('home-other-services');
 assert.equal(await planning.getByRole('button').count(), 8);
 assert.equal(await materials.getByRole('button').count(), 4);
 for (const [id, label] of [['action-new','New Order'], ['action-track','Track Order'], ['action-plants','Nearby Plants'], ['action-orders','My Orders']]) {
   const action = page.getByTestId(id);
   const target = await action.boundingBox();
   await action.getByText(label, {exact:true}).waitFor();
   assert(target.width >= 44 && target.height >= 44);
   const symbolSize = width >= 1024 ? 32 : width >= 600 ? 29 : 28;
   assert.deepEqual(await actualVectorSize(id), [symbolSize, symbolSize]);
   assert.equal(await action.locator('svg').first().getAttribute('aria-hidden'), 'true');
 }
 const cardBoxes = await Promise.all(['service-cement', 'service-sand', 'service-bricks', 'home-materials-see-all']
   .map(id => page.getByTestId(id).boundingBox()));
 for (const box of cardBoxes) {
   assert(box.height >= 70 && Math.abs(box.width - cardBoxes[0].width) <= 1);
   assert(Math.abs(box.y - cardBoxes[0].y) <= 1, 'Materials must share a row at normal font scale');
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
 if (width === 390) {
   const more = page.getByTestId('tab-more');
   await more.click();
   await page.waitForURL(/\/customer\/more\/?$/);
   await more.click({ clickCount: 3 });
   await page.getByTestId('customer-account-profile').waitFor();
   assert.equal(await more.getAttribute('aria-selected'), 'true');
   await page.getByTestId('tab-home').click();
   await page.setViewportSize({ width, height: 540 });
   const movement = await scroll.evaluate(node => {
     const cards = ['home-promotional-carousel', 'home-quick-actions', 'kyc-banner']
       .map(id => node.querySelector(`[data-testid="${id}"]`));
     node.scrollTop = 0;
     const positions = cards.map(card => card.getBoundingClientRect().top);
     node.scrollTop = 150;
     return { offset: node.scrollTop, distances: cards.map((card, i) => positions[i] - card.getBoundingClientRect().top) };
   });
   assert(movement.offset > 0);
   assert(movement.distances.every(distance => Math.abs(distance - movement.offset) <= 1));
   await page.setViewportSize({ width, height: 1000 });
 }
 await scroll.evaluate(node => {
   const track = node.querySelector('[data-testid="demo-tracking-card"]');
   node.scrollTop += track.getBoundingClientRect().top - node.getBoundingClientRect().top;
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
 if (width === 390) {
   await page.emulateMedia({ reducedMotion: 'reduce' });
   for (const [id, label, destination] of [
     ['new', 'New Order', '/new-order'],
     ['track', 'Track Order', '/track/isolated-order'],
     ['plants', 'Find Plants', '/customer/plants'],
     ['calculator', 'Calculate Volume', '/customer/free-tools'],
     ['bulk', 'Request a Quote', '/customer/service-enquiry?service=bulk'],
     ['orders', 'My Orders', '/customer/orders'],
   ]) {
     mode = 'live';
     await page.goto('http://127.0.0.1:8765/customer/');
     await page.getByTestId('real-tracking-card').waitFor();
     const dot = page.getByTestId(`carousel-page-${id}`);
     await dot.click();
     const banner = page.getByTestId('home-promotional-carousel').getByRole('button', { name: label, exact: true });
     const loaded = await banner.locator('img').first().evaluate(node =>
       node.decode().then(() => node.currentSrc.includes('.webp')));
     assert.equal(loaded, true, `The ${id} banner must load a WebP`);
     await banner.click();
     await page.waitForURL(url => url.pathname.replace(/\/$/, '') + url.search === destination);
   }
   console.log('PASS all six carousel WebPs load and open their advertised actions');
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
     reviewSubmission=undefined;
     await page.evaluate(value=>localStorage.setItem('tmrmc_theme_mode',JSON.stringify(value)),theme);
     await page.goto('http://127.0.0.1:8765/customer/');
     await page.getByTestId('home-planning-see-all').waitFor();
     const secondaryTile=theme==='light'?'rgb(240, 237, 230)':'rgb(26, 26, 26)';
     for (const id of ['home-pump-rental','service-cement']) {
       const background=await page.getByTestId(id).locator('svg').first().evaluate(el=>getComputedStyle(el.parentElement).backgroundColor);
       assert.equal(background, secondaryTile, `${id} uses its ${theme} icon shade`);
     }
     const quickSection = page.getByTestId('home-quick-actions');
     assert.equal(await quickSection.locator('radialGradient').count(), theme === 'light' ? 0 : 1,
       `${theme} Quick Access corner highlight`);
     const quickIcons = quickSection.locator('[data-testid^="action-"] svg');
     const quickPaints = await quickIcons.evaluateAll(icons => icons.map(icon => {
       const fill = icon.parentElement;
       const copper = fill.parentElement;
       return {
         fill: getComputedStyle(fill).backgroundImage,
         copper: getComputedStyle(copper).backgroundImage,
         rim: getComputedStyle(copper.parentElement).backgroundColor,
         glow: getComputedStyle(fill.firstElementChild).backgroundImage,
         ink: getComputedStyle(icon).color,
       };
     }));
     assert.equal(quickPaints.length, 4);
     for (const paint of quickPaints) {
       if (theme === 'light') {
         assert.match(paint.fill, /rgb\(232, 151, 10\).*rgb\(198, 121, 13\) 50%.*rgb\(179, 101, 14\) 100%/);
         assert.match(paint.copper, /rgb\(173, 108, 36\).*rgb\(204, 121, 38\).*rgb\(246, 142, 45\)/);
         assert.equal(paint.rim, 'rgb(42, 42, 44)');
         assert.match(paint.glow, /rgba\(249, 143, 45, .*\) 97%.*rgba\(255, 152, 51, 0.4\) 100%/);
         assert.equal(paint.ink, 'rgb(254, 248, 239)');
       } else {
         assert.match(paint.fill, /rgb\(96, 56, 19\).*rgb\(71, 45, 19\).*rgb\(58, 38, 17\)/);
         assert.match(paint.copper, /rgb\(157, 105, 48\).*rgb\(129, 85, 48\)/);
         assert.equal(paint.glow, 'none');
         assert.equal(paint.ink, 'rgb(255, 240, 226)');
       }
     }
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
     await page.getByTestId('home-planning-see-all').click();
     const planningDirectory = page.getByTestId('home-shortcut-directory');
     for (const id of ['home-order-request', 'home-compare-plants', 'home-quotations', 'home-documents']) {
       await planningDirectory.getByTestId(id).waitFor();
     }
     await planningDirectory.getByTestId('home-order-request').click();
     await page.waitForURL('**/new-order');
     await page.getByTestId('neworder-draft').waitFor();
     await page.goBack();
     await page.getByTestId('home-bulk-quote').click();
     await page.getByText('Bulk Concrete Enquiry',{exact:true}).waitFor();
     await page.getByTestId('submit-service-enquiry').click();
     assert.equal(await page.getByTestId('enquiry-quantity_m3').getAttribute('aria-invalid'), 'true');
     await page.getByTestId('enquiry-quantity_m3').fill('125.25');
     await page.getByTestId('bulk-grade-dropdown').click();
     await page.getByRole('radio',{name:'M30',exact:true}).click();
     await page.getByTestId('enquiry-location').fill('Synthetic delivery site, Panvel');
     await page.getByTestId('enquiry-contact_number').fill('9000000000');
     await page.getByRole('button',{name:'Required Date: Choose date',exact:true}).click();
     const today = await page.evaluate(() => {
       const d = new Date();
       return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
     });
     await page.getByRole('button',{name:today,exact:true}).click();
     const bulkRequest = page.waitForRequest(req => req.method() === 'POST' && req.url().endsWith('/customer/service-enquiries'));
     await page.getByTestId('submit-service-enquiry').click();
     const bulkData = (await bulkRequest).postDataJSON();
     assert.equal(bulkData.service_type, 'BULK_CONCRETE');
     assert.equal(bulkData.grade, 'M30');
     assert.equal(bulkData.quantity_m3, 125.25);
     await page.getByText('Enquiry received',{exact:true}).waitFor();
     await page.goBack();
     await page.getByTestId('service-sand').click();
     await page.getByText('Sand Enquiry',{exact:true}).waitFor();
     await page.getByTestId('material-type-dropdown').click();
     await page.getByRole('radio',{name:'Crushed Sand',exact:true}).waitFor();
     await page.goBack();
     await page.getByTestId('service-bricks').click();
     await page.getByText('Bricks Enquiry',{exact:true}).waitFor();
     await page.getByTestId('service-enquiry-form').getByText('Bricks',{exact:true}).waitFor();
     await page.goBack();
     await page.getByTestId('home-materials-see-all').click();
     const directory = page.getByTestId('home-shortcut-directory');
     for (const [id, title] of [['steel','Steel Enquiry'], ['labour','Labour Contractor Enquiry'],
       ['office-cabin','Office Cabin Enquiry'], ['shuttering','Shuttering Material Enquiry'], ['material','Building Material Enquiry']]) {
       await directory.getByTestId('home-' + id).click();
       await page.getByText(title,{exact:true}).waitFor();
       await page.goBack();
       if (id !== 'material') await page.getByTestId('home-materials-see-all').click();
     }
     await page.getByTestId('tab-new-order').click();
     await page.waitForURL('**/new-order');
     await page.goBack();
     await page.getByTestId('tab-plants').click();
     const plant=page.getByTestId('nearby-plant-fixture-plant');
     await plant.waitFor();
     assert.equal(await plant.getByRole('button',{name:/^Show .* on map$/}).count(),1);
     const order=plant.getByTestId('nearby-place-order');
     const ink=await order.getByText('Place Order').evaluate(el=>getComputedStyle(el).color);
     assert.equal(ink,theme==='light'?'rgb(10, 9, 7)':'rgb(18, 18, 18)');
     const profile = plant.getByRole('button',{name:'Plant Profile',exact:true});
     assert.equal(await profile.evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(34, 197, 94, 0.2)');
     const target=await order.boundingBox();
     assert(target.height>=44 && target.width<180,theme+' narrow plant primary action must be compact');
     for (const label of ['Request Quotation', 'Plant Profile']) {
       const action = await plant.getByRole('button',{name:label,exact:true}).boundingBox();
       assert(action.height>=44 && Math.abs(action.width-target.width)<1,theme+' plant action targets must be equal');
       assert(Math.abs(action.y-target.y)<1,theme+' plant actions must share one row at the default text scale');
     }
     await order.click();
     await page.waitForURL('**/new-order?plantId=fixture-plant');
     await page.goBack();
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
     assert.equal(surface,theme==='light'?'rgb(252, 251, 247)':'rgb(28, 28, 28)');
     await calendar.getByRole('button',{name:'Next month',exact:true}).click();
     await calendar.getByRole('button',{name:'Close Calendar',exact:true}).click();
     await calendar.waitFor({state:'hidden'});
     await page.goBack();
     await page.getByTestId('plants-filter-toggle').click();
     await page.getByTestId('plants-filter-state').fill('Maharashtra');
     const linked=page.getByTestId('nearby-plant-fixture-plant-off-page');
     await linked.getByText('TrackMyRMC verified',{exact:true}).waitFor();
     const quotationOnly=page.getByTestId('nearby-plant-fixture-rfq-only');
     assert.equal(await quotationOnly.getByTestId('nearby-place-order').getAttribute('aria-disabled'), 'true');
     await quotationOnly.getByRole('button',{name:'Request Quotation',exact:true}).click();
     await page.waitForURL(url=>url.searchParams.get('googlePlaceId')==='ChIJ_rfq_fixture');
     await page.getByRole('button',{name:'Submit Quotation Request',exact:true}).waitFor();
     await page.goBack();
     await linked.getByTestId('nearby-place-order').click();
     await page.waitForURL('**/new-order?plantId=fixture-plant-off-page');
     await page.goBack();
     const googlePlant=page.getByTestId('nearby-plant-google:ChIJ_review_fixture');
     await googlePlant.getByRole('button',{name:'Plant Profile',exact:true}).click();
     await page.getByRole('button',{name:'Close details',exact:true}).waitFor();
     await page.getByRole('button',{name:'Close details',exact:true}).click();
     await googlePlant.getByTestId('nearby-place-order').click();
     await page.getByRole('textbox',{name:'Required Quantity (m³)',exact:true}).fill('6.5');
     await page.getByRole('textbox',{name:'Delivery Site Address',exact:true}).fill('Sector 18, Panvel');
     await page.getByRole('button',{name:'Submit Order Request',exact:true}).click();
     await page.getByText('Order request sent',{exact:true}).waitFor();
     assert.equal(reviewSubmission.google_place_id,'ChIJ_review_fixture');
     assert.equal(reviewSubmission.plant_id,null);
     assert.equal(reviewSubmission.share_with_supplier,undefined);
     await page.getByRole('button',{name:'View My Orders',exact:true}).click();
     await page.getByText('Requests Awaiting Review',{exact:true}).waitFor();
     await page.getByText('Reference admin-review-fixture',{exact:true}).waitFor();
     console.log('PASS 320px '+theme+' enlarged labels, header Support and matte RFQ calendar');
   }
 }
 await page.close();
 }
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
