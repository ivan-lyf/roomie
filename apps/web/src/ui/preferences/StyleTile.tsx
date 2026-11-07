import type { StylePreset } from '@roomie/schema';

// A style's card picture: one living room drawn as a plan in the style's colours. A stand-in
// until renders of the sample home in each style exist (§4.4); never IKEA's photos.

const PALETTES: Record<StylePreset, { floor: string; sofa: string; wood: string; rug: string }> = {
  scandinavian: { floor: '#efe6d6', sofa: '#e9e7e1', wood: '#d9c3a0', rug: '#f6f4ef' },
  modern: { floor: '#d9d8d4', sofa: '#4a4a48', wood: '#2f2e2c', rug: '#9a9a96' },
  warm_minimal: { floor: '#ead8c3', sofa: '#c9a27e', wood: '#a0673f', rug: '#d8b58f' },
};

export function StyleTile({ style }: { style: StylePreset }) {
  const p = PALETTES[style];
  return (
    <svg viewBox="0 0 240 150" aria-hidden className="block w-full">
      <rect x="0" y="0" width="240" height="150" fill={p.floor} />
      <rect x="6" y="6" width="228" height="138" fill="none" stroke="#1c1c1a" strokeWidth="4" />
      <rect x="60" y="56" width="120" height="58" fill={p.rug} stroke="#1c1c1a" strokeWidth="0.75" />
      <rect x="50" y="14" width="140" height="34" fill={p.sofa} stroke="#1c1c1a" strokeWidth="1.5" />
      <line x1="50" y1="24" x2="190" y2="24" stroke="#1c1c1a" strokeWidth="0.75" />
      <rect x="94" y="66" width="52" height="28" fill={p.wood} stroke="#1c1c1a" strokeWidth="1.5" />
      <rect x="80" y="126" width="80" height="12" fill={p.wood} stroke="#1c1c1a" strokeWidth="1.5" />
      <circle cx="212" cy="30" r="9" fill="none" stroke="#1c1c1a" strokeWidth="1.5" />
      {style !== 'modern' && <rect x="14" y="96" width="26" height="40" fill={p.wood} stroke="#1c1c1a" strokeWidth="1.5" />}
      {style === 'scandinavian' && <circle cx="27" cy="20" r="7" fill="#9bb08f" stroke="#1c1c1a" strokeWidth="1" />}
    </svg>
  );
}
