import { useMemo } from 'react';
import { qrcodegen } from './vendor/qrcodegen';

/**
 * Renders the currently issued otpauth URI as an offline SVG QR.
 *
 * Never use an external QR API: the URI contains the active MFA enrollment key.
 * Neither the URI nor its data is sent to a server, logged or persisted here.
 */
export function AuthenticatorQr({ uri }: { uri: string }) {
  const image = useMemo(() => {
    if (!uri.startsWith('otpauth://totp/TrackMyRMC:') ||
        !uri.includes('issuer=TrackMyRMC') || uri.length > 1024) return null;
    try {
      const qr = qrcodegen.QrCode.encodeText(uri, qrcodegen.QrCode.Ecc.MEDIUM);
      const offset = 4; // Standard white quiet zone required by scanners.
      const segments: string[] = [];
      for (let y = 0; y < qr.size; y++) {
        for (let x = 0; x < qr.size; x++) {
          if (qr.getModule(x, y)) segments.push(`M${x + offset},${y + offset}h1v1h-1z`);
        }
      }
      return { size: qr.size + offset * 2, path: segments.join('') };
    } catch {
      return null;
    }
  }, [uri]);

  if (!image) return (
    <p role="status" style={{ color: '#fde68a' }}>
      QR code is unavailable. Use the setup key shown below.
    </p>
  );

  return (
    <div style={{ margin: '16px auto', textAlign: 'center' }}>
      <svg
        data-testid="admin-authenticator-qr"
        role="img"
        aria-label="Scan this QR code with your authenticator app to add TrackMyRMC"
        xmlns="http://www.w3.org/2000/svg"
        width="256"
        height="256"
        viewBox={`0 0 ${image.size} ${image.size}`}
        style={{ display: 'block', width: '100%', maxWidth: 256, height: 'auto', margin: 'auto', background: '#fff', borderRadius: 8 }}
      >
        <rect width={image.size} height={image.size} fill="#fff" />
        <path d={image.path} fill="#111827" />
      </svg>
    </div>
  );
}
