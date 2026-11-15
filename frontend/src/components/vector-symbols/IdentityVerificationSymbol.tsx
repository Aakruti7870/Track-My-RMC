import Svg, { Circle, Path, Rect } from "react-native-svg";

import { homeArtwork } from "@/src/theme/tokens";

/** A TrackMyRMC identity card and lock shield, drawn for legibility at small sizes. */
export function IdentityVerificationSymbol({ size = 28 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" aria-hidden accessible={false}
      importantForAccessibility="no-hide-descendants">
      <Rect x="2.5" y="8" width="22" height="21" rx="3" fill={homeArtwork.kycIconFill} stroke="#FFFFFF" strokeWidth="1.6" />
      <Path d="M3 13h13M6 10.5h4M7 25c0-2 1.5-3.2 3.5-3.2S14 23 14 25m2 0h3"
        fill="none" stroke="#FFFFFF" strokeWidth="1.6" strokeLinecap="round" />
      <Circle cx="10.5" cy="18.5" r="2" fill="none" stroke="#FFFFFF" strokeWidth="1.6" />
      <Path d="M23.5 2.6c2.1 1.5 4.1 2.2 6.2 2.5v6.5c0 4-2.9 6.9-6.2 8.3-3.4-1.4-6.2-4.3-6.2-8.3V5.1c2.1-.3 4.1-1 6.2-2.5Z"
        fill={homeArtwork.kycIconFill} stroke="#FFFFFF" strokeWidth="1.6" strokeLinejoin="round" />
      <Path d="M22 10.1V8.8a1.5 1.5 0 1 1 3 0v1.3m-4 0h5v4.4h-5z"
        fill="none" stroke="#FFFFFF" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
