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
       id:'admin-review-fixture',status:'PENDING_ADMIN_REVIEW',grade:reviewSubmission.grade,quantity_m3:reviewSubmission.quantity_m3,
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
   const request = route.request().postDataJSON();
   if (request.page_size === 8 && request.q === 'pagination') {
     const page = request.page;
     await route.fulfill({json:{
       plants: Array.from({length: page === 1 ? 8 : 2}, (_, i) => ({
         ...plants[0], id: `page-${page}-${i}`, name: `Pagination plant ${page}-${i}`,
       })),
       page, has_more: page === 1,
     }});return;
   }
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
 await route.fulfill({json:path.endsWith('/tracking')?tracking:path.endsWith('/customer/service-enquiries')?{enquiries:[]}:path.endsWith('/customer/plants')?{plants:[...plants,linkedPlant]}:path.endsWith('/customer/orders')?{orders:mode==='demo'?[]:[order]}:path.endsWith('/customer/order-drafts')?{drafts:[]}:path.endsWith('/permission-consent')?{consent:{version:1,location_choice:'manual',notification_choice:'manual'}}:path.endsWith('/me')?me:path.endsWith('/customer/home')?home:path.endsWith('/customer/project-sites')?{sites:[]}:{}});
 });
 page.on('pageerror',e=>console.error(e.message));
 await page.goto('http://127.0.0.1:8765/customer/');
 await page.getByTestId('action-new').waitFor({timeout:30000});
 const scroll = page.getByTestId('customer-home-scroll');
 const tabBar = page.getByTestId('app-tab-bar');
 const bulk = page.getByTestId('home-bulk-quote');
 const plant = scroll.getByTestId('nearby-plant-fixture-plant');
 await plant.waitFor();
 const sections = await Promise.all([
   'home-promotional-carousel', 'home-quick-actions', 'home-plant-search', 'nearby-plant-fixture-plant',
 ].map(id => scroll.getByTestId(id).boundingBox()));
 for (let i = 1; i < sections.length; i++) {
   const previous = sections[i - 1], next = sections[i];
   assert(next.y >= previous.y + previous.height, 'Home sections must follow the agreed order');
   assert(next.x >= 0 && next.x + next.width <= width + 1, 'Home section exceeds viewport');
 }
 assert(Math.abs(sections[0].width / sections[0].height - 16 / 9) < 0.03, 'Carousel preserves artwork ratio');
 assert.equal(await scroll.getByRole('heading', {name:'Nearby Plants',exact:true}).count(), 1);
 assert.equal(await scroll.getByTestId('kyc-banner').count(), 0);
 assert.equal(await scroll.getByTestId('demo-tracking-card').count(), 0);
 assert.equal(await scroll.getByTestId('real-tracking-card').count(), 0);
 assert.equal(await tabBar.getByTestId('tab-new-order').count(), 0);
 for (const [id, label] of [
   ['action-new','New Order'], ['action-saved-sites','Saved Sites'], ['action-free-tools','RMC Calculator'],
   ['action-pump-rental','Concrete Pump'], ['action-pour-planner','Pour Planner'],
 ]) {
   const action = scroll.getByTestId(id);
   const target = await action.boundingBox();
   await action.getByText(label, {exact:true}).waitFor();
   assert(target.width >= 44 && target.height >= 44);
   assert.equal(await action.locator('svg').first().getAttribute('aria-hidden'), 'true');
 }
 assert.deepEqual(await tabBar.getByRole('tab').allTextContents(), ['Home','Orders','Plan','Supply','Account']);
 const tabs = await Promise.all(['home','orders','plan','supply','account'].map(id=>tabBar.getByTestId('tab-'+id).boundingBox()));
 assert(tabs.every(tab => Math.abs(tab.width - tabs[0].width) <= 1));
 const bulkBox = await bulk.boundingBox();
 const scrollBox = await scroll.boundingBox();
 const tabsBox = await tabBar.boundingBox();
 assert(bulkBox.y >= scrollBox.y + scrollBox.height - 1, 'Bulk card cannot overlap plant results');
 assert(bulkBox.y + bulkBox.height <= tabsBox.y + 1, 'Bulk card cannot overlap bottom tabs');
 await page.screenshot({path:`tracking-previews/home-layout-${width}.png`,fullPage:true});
 if (width === 390) {
   await bulk.waitFor({state:'hidden',timeout:12000});
   const search = scroll.getByTestId('home-plant-search');
   await search.fill('pagination');
   await scroll.getByTestId('nearby-plant-page-1-7').waitFor();
   assert.equal(await scroll.locator('[data-testid^="nearby-plant-page-1-"]').count(),8);
   await scroll.getByTestId('home-plants-next').click();
   await scroll.getByTestId('nearby-plant-page-2-1').waitFor();
   assert.equal(await scroll.getByTestId('home-plants-next').getAttribute('aria-disabled'),'true');
   await scroll.getByTestId('home-plants-previous').click();
   await scroll.getByTestId('nearby-plant-page-1-7').waitFor();
   await search.fill('');
   await plant.waitFor();
   const account = tabBar.getByTestId('tab-account');
   await account.click();
   await page.waitForURL(/\/customer\/more\/?$/);
   await account.click({clickCount:3});
   await page.getByTestId('customer-account-profile').waitFor();
   assert.equal(await account.getAttribute('aria-selected'),'true');
   await tabBar.getByTestId('tab-plan').click();
   await page.getByTestId('customer-directory-projects').click();
   await page.waitForURL('**/customer/projects');
   await page.getByTestId('project-hub-back').click();
   await page.getByTestId('customer-plan').waitFor();
   mode = 'live';
   await tabBar.getByTestId('tab-orders').click();
   const track = page.getByTestId('orders-track-isolated-order');
   await track.click();
   await page.waitForURL('**/track/isolated-order');
   await page.getByText('Live Tracking', {exact:true}).waitFor();
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
     await page.getByTestId('action-new').waitFor();
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
     await page.getByTestId('home-quick-actions').waitFor();
     const quickIcons = page.getByTestId('home-quick-actions').locator('[data-testid^="action-"] svg');
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
     assert.equal(quickPaints.length, 5);
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

     await page.getByTestId('action-pump-rental').click();
     await page.waitForURL(/\/customer\/service-enquiry\/?\?service=pump/);
     await page.getByText('Concrete Pump Rental Enquiry',{exact:true}).waitFor();
     await page.goBack();
     await page.getByTestId('action-new').click();
     await page.waitForURL('**/new-order');
     await page.getByTestId('neworder-draft').waitFor();
     await page.goBack();
     await page.getByTestId('tab-supply').click();
     await page.getByTestId('customer-directory-bulk-quote').click();
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
     await page.getByTestId('customer-directory-sand').click();
     await page.getByText('Sand Enquiry',{exact:true}).waitFor();
     await page.getByTestId('service-area-notice').waitFor();
     await page.getByTestId('material-type-dropdown').click();
     await page.getByRole('radio',{name:'Crushed Sand',exact:true}).waitFor();
     await page.goBack();
     await page.getByTestId('customer-directory-bricks').click();
     await page.getByText('Bricks Enquiry',{exact:true}).waitFor();
     await page.getByTestId('service-enquiry-form').getByText('Bricks',{exact:true}).waitFor();
     await page.goBack();
     for (const [id, title] of [
       ['cement','Cement Enquiry'], ['steel','Steel Enquiry'], ['labour','Labour Contractor Enquiry'],
       ['office-cabin','Office Cabin Enquiry'], ['shuttering','Shuttering Material Enquiry'], ['material','Building Material Enquiry'],
     ]) {
       await page.getByTestId('customer-directory-' + id).click();
       await page.getByText(title,{exact:true}).waitFor();
       await page.getByTestId('service-area-notice').getByText(/within our service area/).waitFor();
       await page.goBack();
     }
     await page.getByTestId('customer-directory-plant-map').click();
     const plant=page.getByTestId('plants-list').getByTestId('nearby-plant-fixture-plant');
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
     await page.getByText('Plant Order Requests',{exact:true}).waitFor();
     await page.getByText('Awaiting Super Admin review',{exact:true}).waitFor();
     await page.getByText('Reference admin-review-fixture',{exact:true}).waitFor();
     console.log('PASS 320px '+theme+' enlarged labels, header Support and matte RFQ calendar');
   }
 }
 await page.close();
 }
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
