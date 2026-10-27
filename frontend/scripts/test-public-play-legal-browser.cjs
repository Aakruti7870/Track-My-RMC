// Play legal public pages: real production HTTPS, unauthenticated, read-only.
// A passing HTTP 200 alone is not enough: SPA fallback could render login.
const { chromium } = require("../../admin-web/node_modules/playwright");
const assert = require("node:assert/strict");

const origin = "https://trackmyrmc.com";
const pages = [
  {path:"/privacy_policy",heading:"Privacy Policy",proof:"Location and live delivery tracking"},
  {path:"/account-deletion",heading:"Delete Account",proof:"Before requesting deletion"},
];

(async()=>{
  const browser = await chromium.launch({headless:true,args:["--no-sandbox"]});
  try{
    for(const expected of pages){
      const context = await browser.newContext({viewport:{width:390,height:860}});
      const page = await context.newPage();
      const response = await page.goto(origin+expected.path,{waitUntil:"domcontentloaded",timeout:30000});
      assert(response,"Page did not respond");
      if(response.status()!==200) {
        const headers=response.headers();
        console.error("PUBLIC_LEGAL_DIAGNOSTIC",expected.path,
          "status",response.status(),"server",headers["server"]||"missing",
          "mitigation",headers["cf-mitigated"]||"none",
          "cache",headers["cf-cache-status"]||"none",
          "content-type",headers["content-type"]||"missing");
        // An existing Pages host may be a no-DNS fallback for the Play URL.
        // Diagnostics do NOT count as a production pass and must not hide the
        // canonical 403. Its actual rendered content must also be checked.
        const alternate = await browser.newPage({viewport:{width:390,height:860}});
        try {
          const altResponse = await alternate.goto(
            "https://trackmyrmc-preview.pages.dev" + expected.path,
            {waitUntil:"domcontentloaded",timeout:25000}
          );
          const ok = altResponse?.status() === 200 &&
            await alternate.getByText(expected.heading,{exact:true}).first()
              .waitFor({timeout:13000}).then(()=>true,()=>false);
          console.error("PUBLIC_LEGAL_ALTERNATE",expected.path,
            "status",altResponse?.status()??0,"rendered",ok);
        } catch(err) {
          console.error("PUBLIC_LEGAL_ALTERNATE",expected.path,
            "failed",String(err?.message||err).slice(0,160));
        } finally { await alternate.close(); }
      }
      assert.equal(response.status(),200,expected.path+" must be publicly reachable");
      assert.equal(new URL(page.url()).pathname,expected.path,"Legal page redirected away from public route");
      await page.getByText(expected.heading,{exact:true}).first().waitFor({timeout:20000});
      await page.getByText(expected.proof,{exact:true}).first().waitFor({timeout:20000});
      const token=await page.evaluate(()=>localStorage.getItem("tmrmc_token"));
      assert(!token,"Legal pages may not require app sign-in");
      console.log("PUBLIC LEGAL PAGE PASS",expected.path,"200 and actual legal content");
      await context.close();
    }
  }finally{await browser.close();}
})().catch(e=>{console.error("PUBLIC LEGAL PAGE FAILED",e.name,e.message.slice(0,160));process.exitCode=1;});
