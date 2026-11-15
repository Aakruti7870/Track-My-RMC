import { createElement, type ReactElement, type SVGProps } from 'react';
import trackIcons from '../../frontend/src/components/vector-symbols/track-icons.json';

export type TrackIconName = keyof typeof trackIcons;
type Shape = ['path' | 'circle' | 'g' | 'line' | 'rect', Record<string, string>, Shape[]?];

function renderShapes(nodes: Shape[]): ReactElement[] {
  return nodes.map(([tag, props, children], index) =>
    createElement(tag, { ...props, key: index }, children && renderShapes(children)));
}

export function TrackIcon({ name, size = 24, ...props }: SVGProps<SVGSVGElement> & { name: TrackIconName; size?: number }) {
  const { full, compact } = trackIcons[name];
  const nodes = (size <= 24 ? compact : full) as unknown as Shape[];

  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true" {...props}>
      {renderShapes(nodes)}
    </svg>
  );
}
