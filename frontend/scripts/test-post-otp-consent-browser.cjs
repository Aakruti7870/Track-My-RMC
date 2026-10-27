const { chromium } = require("../../admin-web/node_modules/playwright");
const assert = require("node:assert/strict");

// First authenticated session, including isolated Google Play reviewer identity.
(async()=>{
  const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
  try{
    for(const {role,path,review} of [
      {role:"customer",path:"/customer/",review:false},
      {role:"customer",path:"/customer/",review:true},
      {role:"plant_owner",path:"/owner/",review:false},
      {role:"driver",path:"/driver/",review:true},
      {role:"admin",path:"/admin/",review:false},
    ]){
      const page=await browser.newPage({viewport:{width:390,height:860}});
      const writes=[];
      await page.addInitScript(()=>localStorage.setItem("tmrmc_token",JSON.stringify("post-otp-fixture")));
      await page.route("**/api/**",async route=>{
        const pathname=new URL(route.request().url()).pathname;
        const response=pathname.endsWith("/me")
          ? {id:"fresh-"+role+"-"+review,name:review?"TrackMyRMC Play Reviewer":"Test Account",role,roles:[role],status:"active",kyc_status:"NOT_STARTED",plant_id:null}
          : pathname.endsWith("/permission-consent") && route.request().method()==="GET"
            ? {consent:{version:1,location_choice:"manual",notification_choice:"manual"}}
            : pathname.endsWith("/owner/home")
              ? {plant_count:0,plants:[],cards:{todays_orders:0,dispatched_loads:0,active_staff:0,pending_approvals:0},pending_orders:[]}
              : pathname.endsWith("/staff/home")
                ? {role,role_label:"Staff",name:"Test Staff",plant_name:"Test Plant",kpis:[],primary:{title:"Review",kind:"orders"}}
                : pathname.endsWith("/staff/module-permissions")
                  ? {permissions:[]}
                  : pathname.endsWith("/driver/home")
                    ? {name:"Test Driver",vehicle:null,active_trip:null,completed_today:0,checked_in:false}
                    : pathname.endsWith("/driver/attendance")
                      ? {date:"2026-10-27",check_in:null,check_out:null}
                      : {};
        if(pathname.endsWith("/permission-consent")&&route.request().method()==="PUT"){
          writes.push(JSON.parse(route.request().postData()));
          return route.fulfill({json:{success:true}});
        }
        await route.fulfill({json:response});
      });
      await page.goto("http://127.0.0.1:8765"+path);
      const popup=page.getByTestId("post-otp-permission-introduction");
      await popup.waitFor({timeout:30000});
      assert.equal(writes.length,0,"Consent cannot be silently accepted");
      await page.getByTestId("intro-camera-not-now").click();
      await page.getByTestId("intro-skip-location").click();
      await page.getByTestId("intro-skip-notifications").click();
      await page.getByTestId("permission-continue").click();
      await popup.waitFor({state:"hidden",timeout:8000});
      assert.equal(writes.length,1);
      assert.equal(writes[0].version,2);
      assert.equal(writes[0].camera_choice,"denied");
      assert.equal(writes[0].location_choice,"manual");
      assert.equal(writes[0].notification_choice,"manual");
      await page.close();
      console.log("PASS post-OTP intro:",role,review?"review fixture":"normal account");
    }
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
