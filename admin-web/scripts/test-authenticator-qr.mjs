import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendorSource = fs.readFileSync(path.join(root, 'src/vendor/qrcodegen.ts'), 'utf8');
const componentSource = fs.readFileSync(path.join(root, 'src/AuthenticatorQr.tsx'), 'utf8');
const adminSource = fs.readFileSync(path.join(root, 'src/main.tsx'), 'utf8');

assert.match(vendorSource, /Copyright \(c\) Project Nayuki/);
assert.match(vendorSource, /MIT License/);
assert.match(componentSource, /qrcodegen\.QrCode\.encodeText\(uri/);
assert.match(componentSource, /QR code is unavailable\. Use the setup key/);
assert.doesNotMatch(componentSource, /fetch\(|axios\.|XMLHttpRequest|window\.open\(|image\.src\s*=/,
  'Enrollment QR must never be sent to an external renderer or analytics service');
assert.match(adminSource, /<AuthenticatorQr uri=\{enrollment\.otpauth_uri\} \/>/);

const compiled = ts.transpileModule(vendorSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  reportDiagnostics: true,
});
assert.equal((compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
const mod = { exports: {} };
vm.runInNewContext(compiled.outputText, { module: mod, exports: mod.exports }, { timeout: 3000 });
const QR = mod.exports.qrcodegen.QrCode;
const uri = 'otpauth://totp/TrackMyRMC:ci-admin@example.invalid?secret=JBSWY3DPEHPK3PXP&issuer=TrackMyRMC&algorithm=SHA1&digits=6&period=30';
const qr = QR.encodeText(uri, QR.Ecc.MEDIUM);
assert.ok(qr.size >= 21 && qr.size <= 177);
assert.ok(qr.getModule(3, 3), 'top-left finder should be dark at its center');
assert.ok(qr.getModule(qr.size - 4, 3), 'top-right finder should be dark at its center');
assert.ok(qr.getModule(3, qr.size - 4), 'bottom-left finder should be dark at its center');
console.log('PASS: local MIT QR encoder produces a valid QR grid without network or secret persistence');
