const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { imageSize } = require('image-size');
const metro = require(path.join(path.dirname(require.resolve('metro/package.json')), 'src/Assets.js'));

test('Metro consumes the pinned parser with the existing Buffer API', () => {
  const root = path.dirname(require.resolve('image-size'));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, '../../package.json'), 'utf8'));
  assert.equal(manifest.version, '2.0.4');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1cAAAAASUVORK5CYII=', 'base64');
  assert.deepEqual(metro.getAssetSize('png', png, 'test.png'), { width: 1, height: 1 });
});

test('all uploaded supported image assets retain valid dimensions through Metro', () => {
  let count = 0;
  function inspect(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) { inspect(file); continue; }
      const extension = path.extname(file).slice(1).toLowerCase();
      if (!['png', 'jpg', 'jpeg', 'webp', 'svg'].includes(extension)) continue;
      const buffer = fs.readFileSync(file);
      const expected = imageSize(buffer);
      const actual = metro.getAssetSize(extension, buffer, file);
      assert.ok(actual.width > 0 && actual.height > 0, file);
      assert.deepEqual(actual, { width: expected.width, height: expected.height }, file);
      count++;
    }
  }
  inspect(path.join(__dirname, '../assets/images'));
  assert.ok(count >= 100, `Expected uploaded asset coverage, inspected ${count}`);
});

test('Metro file-based asset discovery supports the parser byte-only API', async () => {
  const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'metro-parser-'));
  try {
    const file = path.join(directory, 'test.png');
    fs.writeFileSync(file, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1cAAAAASUVORK5CYII=', 'base64'));
    const asset = await metro.getAssetData(file, 'test.png', [], null, '/assets');
    assert.equal(asset.width, 1);
    assert.equal(asset.height, 1);
    assert.equal(asset.type, 'png');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('zero-length and truncated ICNS entries terminate instead of hanging the build', () => {
  // Run in a bounded child so a parser regression fails CI without hanging it.
  for (const length of [0, 1, 7]) {
    const source = `
      const {imageSize}=require('image-size');
      const input=Buffer.alloc(16);
      input.write('icns'); input.writeUInt32BE(16,4);
      input.write('ic07',8); input.writeUInt32BE(${length},12);
      try { imageSize(input); process.exit(2); } catch { process.exit(0); }
    `;
    const result = spawnSync(process.execPath, ['-e', source], { cwd: path.join(__dirname, '..'), timeout: 3000 });
    assert.equal(result.error, undefined, `Parser timed out for entry length ${length}`);
    assert.equal(result.status, 0, `Malformed entry ${length} must be rejected`);
  }
});
