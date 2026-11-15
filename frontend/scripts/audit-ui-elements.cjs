#!/usr/bin/env node
"use strict";
// Read-only inventory: these signals flag manual review, not verified defects.
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const roots = ["app", "src/components", "src/screens", "src/location", "src/navigation"];
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(p);
    return /\.(?:tsx|jsx)$/.test(entry.name) ? [p] : [];
  });
}
const records = roots.flatMap(dir => walk(path.join(root, dir))).sort().map(file => {
  const source = fs.readFileSync(file, "utf8");
  const rel = path.relative(root, file).replaceAll(path.sep, "/");
  const route = rel.startsWith("app/") && !/\/_layout\.[jt]sx$/.test(rel)
    && !/\/\+html\.tsx$/.test(rel);
  const backCalls = (source.match(/\brouter\.back\(\)/g) || []).length;
  const fixed = [...source.matchAll(/\b(?:width|minWidth|height|minHeight)\s*:\s*(\d{2,4})\b/g)]
    .map(m => Number(m[1])).filter(n => n >= 320).length;
  const flags = [];
  if (backCalls && !source.includes("canGoBack()")) flags.push("inspect-back-history-fallback");
  if (fixed) flags.push("review-large-fixed-dimension");
  if (source.includes("<Modal") && !/(ScrollView|FlatList)/.test(source)) flags.push("inspect-modal-overflow");
  return {
    file: rel, route,
    uses_form: /<TextInput\b|<Input\b|<Picker\b|<select\b/i.test(source),
    uses_dropdown: /Picker|Dropdown|ActionSheet|<select\b/i.test(source),
    uses_status: /<Badge\b|statusColor\(|status\s*===|status\s*==/i.test(source),
    uses_glass: /<BlurView\b|variant="glass"|glassTint|backdropFilter/i.test(source),
    back_calls: backCalls, large_fixed_dimension_signals: fixed, review_flags: flags,
  };
});
const totals = {
  files: records.length,
  routes: records.filter(x => x.route).length,
  forms: records.filter(x => x.uses_form).length,
  dropdowns: records.filter(x => x.uses_dropdown).length,
  status: records.filter(x => x.uses_status).length,
  glass: records.filter(x => x.uses_glass).length,
  files_needing_review: records.filter(x => x.review_flags.length).length,
};
if (!totals.routes) throw Error("Expected Expo routes were not discovered");
const result = { scope: "static source inventory (not device acceptance)", totals, files: records };
if (process.argv.includes("--json")) process.stdout.write(JSON.stringify(result, null, 2) + "\n");
else {
  console.log("UI/UX inventory", totals);
  for (const r of records.filter(x => x.review_flags.length)) console.log(r.file + ": " + r.review_flags.join(", "));
}
