const { readFileSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const dist = path.resolve(__dirname, "../dist");
const login = path.join(dist, "login.html");
const html = readFileSync(login, "utf8");
const metadata = [
  [/<title(?: [^>]*)?>[\s\S]*?<\/title>/i, "<title>TrackMyRMC | Ready-Mix Concrete Ordering and Delivery</title>"],
  [/<meta[^>]*\bname=["']description["'][^>]*>/i, '<meta name="description" content="Find ready-mix concrete plants, request a quotation, place an order and track your concrete delivery with TrackMyRMC.">'],
  [/<link[^>]*\brel=["']canonical["'][^>]*>/i, '<link rel="canonical" href="https://trackmyrmc.com/login">'],
];

function applyMetadata(file, source) {
  if (!/<\/head>/i.test(source)) throw new Error("The web export has no HTML head: " + file);
  let updated = source;
  for (const [pattern, tag] of metadata) {
    updated = pattern.test(updated)
      ? updated.replace(pattern, tag)
      : updated.replace(/<\/head>/i, tag + "</head>");
  }
  writeFileSync(file, updated);
}

applyMetadata(login, html);
const index = path.join(dist, "index.html");
applyMetadata(index, readFileSync(index, "utf8"));
