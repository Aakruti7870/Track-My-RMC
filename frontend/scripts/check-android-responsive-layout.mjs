#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const appDir = path.join(root, "app");
const srcDir = path.join(root, "src");
const config = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8")).expo || {};
const rootLayout = fs.readFileSync(path.join(appDir, "_layout.tsx"), "utf8");
const failures = [];

function fail(message) { failures.push(message); }
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const rows = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) rows.push(...walk(full));
    else if (entry.name.endsWith(".tsx")) rows.push(full);
  }
  return rows;
}

function isProductionTsx(file) {
  return !/[\\/]__tests__[\\/]/.test(file) && !/\.(?:test|spec)\.tsx$/.test(file);
}

function scanLayoutViolations(file) {
  const source = fs.readFileSync(file, "utf8");
  const rel = path.relative(root, file);

  if (/Dimensions\.get\(\s*["']screen["']\s*\)/.test(source)) {
    fail(`${rel}: frozen Dimensions.get("screen") is not allowed; use useWindowDimensions or flex layout.`);
  }

  const stylePairs = [...source.matchAll(/\b(width|height|minWidth|minHeight)\s*:\s*(\d{3,4})\b/g)];
  for (const match of stylePairs) {
    const prop = match[1];
    const value = Number(match[2]);
    const deviceSized = (prop === "width" && value >= 600) ||
      (prop === "height" && value >= 900) ||
      (prop === "minWidth" && value >= 360) ||
      (prop === "minHeight" && value >= 700);
    if (deviceSized) fail(`${rel}: suspicious device-sized ${prop}: ${value}; use flex/maxWidth/aspectRatio or viewport-aware sizing.`);
  }
}

if (config.orientation !== "portrait") fail("Expo orientation must remain portrait for the current Android screen contract.");
if (config.android?.edgeToEdgeEnabled !== true) fail("Android edge-to-edge layout must remain enabled.");
if (!rootLayout.includes("<SafeAreaProvider>")) fail("Root layout must provide SafeAreaProvider.");
if (!rootLayout.includes("<KeyboardProvider>")) fail("Root layout must provide KeyboardProvider for form/OTP screens.");

const appFiles = walk(appDir).filter((file) => !/[\\/]\+html\.tsx$/.test(file));
const srcFiles = walk(srcDir).filter(isProductionTsx);
const routeFiles = appFiles.filter((file) => !/[\\/]_layout\.tsx$/.test(file));
const guardFiles = [...new Set([...appFiles, ...srcFiles])];
const responsiveSignal = /ScrollView|FlatList|SectionList|useSafeAreaInsets|SafeAreaView|KeyboardAvoidingView|useWindowDimensions|flex\s*:\s*1/;
const substantial = [];
let responsiveCount = 0;

// Scan every production TSX implementation reachable from the Expo app tree,
// including route/layout modules and globally mounted/shared UI under src/.
// Coverage remains route-focused so shared implementation files do not distort
// the route responsiveness metric.
for (const file of guardFiles) scanLayoutViolations(file);

for (const file of routeFiles) {
  const source = fs.readFileSync(file, "utf8");
  const rel = path.relative(root, file);
  if (source.length < 280 || /^\s*export\s+\{\s*default\s*\}/m.test(source)) continue;
  substantial.push(rel);
  if (responsiveSignal.test(source)) responsiveCount += 1;
}

const coverage = substantial.length ? responsiveCount / substantial.length : 1;
console.log(`Android responsive scan: ${responsiveCount}/${substantial.length} substantial route screens expose a responsive/safe-area/scroll signal (${(coverage * 100).toFixed(1)}%).`);
console.log(`Scanned ${appFiles.length} Expo app TSX files and ${srcFiles.length} production src TSX files for prohibited Android sizing patterns.`);
if (coverage < 0.65) fail(`Responsive primitive coverage is unexpectedly low: ${(coverage * 100).toFixed(1)}% (<65%).`);

if (failures.length) {
  console.error("ANDROID RESPONSIVE LAYOUT GATE FAILED:");
  failures.forEach((message) => console.error(`- ${message}`));
  process.exit(1);
}
console.log("Android responsive layout guard passed.");
