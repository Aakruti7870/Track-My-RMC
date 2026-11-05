"use strict";

const fs = require("node:fs");

function dimensions(filename) {
  const data = fs.readFileSync(filename);
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    if (data.toString("ascii", 12, 16) !== "IHDR") throw new Error("Invalid PNG IHDR: " + filename);
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  if (data.toString("ascii", 0, 4) !== "RIFF" || data.toString("ascii", 8, 12) !== "WEBP")
    throw new Error("Invalid WebP header: " + filename);
  const chunk = data.toString("ascii", 12, 16);
  if (chunk === "VP8 ") {
    if (data.toString("hex", 23, 26) !== "9d012a") throw new Error("Invalid VP8 frame: " + filename);
    return { width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === "VP8X") {
    return {
      width: 1 + data[24] + (data[25] << 8) + (data[26] << 16),
      height: 1 + data[27] + (data[28] << 8) + (data[29] << 16),
    };
  }
  if (chunk === "VP8L") {
    if (data[20] !== 0x2f) throw new Error("Invalid VP8L frame: " + filename);
    return {
      width: 1 + data[21] + ((data[22] & 0x3f) << 8),
      height: 1 + (data[22] >> 6) + (data[23] << 2) + ((data[24] & 0x0f) << 10),
    };
  }
  throw new Error("Unknown WebP chunk: " + chunk + " in " + filename);
}

module.exports = { dimensions };
