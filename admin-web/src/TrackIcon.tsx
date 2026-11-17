import { createElement, type ReactElement, type SVGProps } from 'react';
import generatedIcons from '../../frontend/src/components/vector-symbols/generated-icons.json';

export type TrackIconName = keyof typeof generatedIcons.symbols;
type Shape = ['path' | 'circle' | 'ellipse' | 'g' | 'line' | 'rect', Record<string, string>, Shape[]?];

function renderShapes(nodes: Shape[]): ReactElement[] {
  return nodes.map(([tag, props, children], index) =>
    createElement(tag, { ...props, key: index }, children && renderShapes(children)));
}

export function TrackIcon({ name, size = 24, ...props }: SVGProps<SVGSVGElement> & { name: TrackIconName; size?: number }) {
  const nodes = generatedIcons.symbols[name] as unknown as Shape[];

  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true" {...props}>
      {renderShapes(nodes)}
    </svg>
  );
}
