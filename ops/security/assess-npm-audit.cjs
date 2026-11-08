#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const file = process.argv[2];
const scope = process.argv[3] || "all";
if (!file || !["all", "production"].includes(scope)) {
  console.error("Usage: node assess-npm-audit.cjs <audit.json> <all|production>");
  process.exit(2);
}
let data;
try {
  data = JSON.parse(fs.readFileSync(file, "utf8"));
} catch (error) {
  console.error("BLOCKED: npm audit did not return valid JSON:", error.message);
  process.exit(2);
}
if (data.error || !data.vulnerabilities || !data.metadata?.vulnerabilities) {
  console.error("BLOCKED: npm audit failed or returned an incomplete response:", data.error?.code || "missing fields");
  process.exit(2);
}
const severities = ["critical", "high", "moderate", "low", "info"];
const counts = Object.fromEntries(severities.map(s => [s, Number(data.metadata.vulnerabilities[s] || 0)]));
const active = Object.entries(data.vulnerabilities)
  .filter(([,v]) => v.severity === "high" || v.severity === "critical")
  .map(([name,v])=>({name,severity:v.severity,range:v.range,fixAvailable:v.fixAvailable}))
  .sort((a,b)=>a.name.localeCompare(b.name));
const summary = {scope,status:active.length?"BLOCKED":"PASS",counts,highOrCriticalAffectedPackages:active};
console.log(JSON.stringify(summary,null,2));
if (process.env.GITHUB_STEP_SUMMARY) {
  let output = "## npm audit (" + scope + ")\n\nResult: **" + summary.status + "**. High: " +
    counts.high + "; critical: " + counts.critical + "; moderate: " + counts.moderate + ".\n\n";
  if (active.length) {
    output += "| Package | Severity | Range | Fix available |\n|---|---|---|---|\n";
    for (const v of active) {
      output += "| " + v.name.replace(/[|]/g,"") + " | " + v.severity + " | " +
        String(v.range).replace(/[|]/g,"") + " | " +
        (typeof v.fixAvailable === "boolean" ? v.fixAvailable : "review") + " |\n";
    }
  }
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, output);
}
if (active.length || counts.high || counts.critical) process.exit(1);
