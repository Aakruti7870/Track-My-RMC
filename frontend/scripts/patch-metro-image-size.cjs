// Metro 0.83.3 has one legacy filename call to image-size. Version 2 accepts
// bytes; keep the security-fixed parser and adapt that caller at install time.
// Refuse unknown source/version rather than silently patching another release.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const packageFile = require.resolve('metro/package.json');
const version = JSON.parse(fs.readFileSync(packageFile, 'utf8')).version;
if (version !== '0.83.3') throw new Error('Review the Metro image parser adapter for the new Metro version');
const file = path.join(path.dirname(packageFile), 'src/Assets.js');
const original = '  const dimensions = isImage ? (0, _imageSize.default)(isImageInput) : null;';
const replacement = '  const dimensions = isImage ? (0, _imageSize.default)(typeof isImageInput === "string" ? _fs.default.readFileSync(isImageInput) : isImageInput) : null;';
const source = fs.readFileSync(file, 'utf8');
const normalized = source.replace(replacement, original);
const hash = crypto.createHash('sha256').update(normalized).digest('hex');
if (hash !== 'bb3f83881e8f3d765c8b9c1bf1de0e4f6ae5143e7eebf6f58a1df52fa6e793ec') {
  throw new Error('Unexpected Metro Assets.js; refusing an unreviewed dependency patch');
}
if (source === normalized) fs.writeFileSync(file, normalized.replace(original, replacement));
console.log('Verified Metro 0.83.3 image-size Buffer compatibility adapter');
