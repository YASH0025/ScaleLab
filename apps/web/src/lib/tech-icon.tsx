import { ICONS } from './icons.generated';

interface Props {
  icon: string;
  name: string;
  brandColor: string;
  size?: number;
  className?: string;
}

/** Relative luminance, to pick white or dark glyphs on a brand-colored tile. */
function isLight(hex: string): boolean {
  const v = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6;
}

/**
 * A technology's logo on a tile in its brand color. Falls back to its initials
 * when Simple Icons has no logo for it.
 */
export function TechIcon({ icon, name, brandColor, size = 32, className = '' }: Props) {
  const data = ICONS[icon];
  const tile = brandColor.toLowerCase() === '#000000' ? '#111318' : brandColor;
  const fg = isLight(tile) ? '#111318' : '#ffffff';
  const words = name.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const first = words[0] ?? '?';
  const initials =
    first.length <= 3 && first === first.toUpperCase()
      ? first
      : words.length > 1
        ? words.slice(0, 2).map((w) => w[0]!.toUpperCase()).join('')
        : first.slice(0, 2);
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-[22%] ${className}`}
      style={{
        width: size,
        height: size,
        background: tile,
        boxShadow: tile === '#111318' ? 'inset 0 0 0 1px #3a4152' : undefined,
      }}
    >
      {data ? (
        <svg viewBox="0 0 24 24" width={size * 0.58} height={size * 0.58} fill={fg}>
          <path d={data.path} />
        </svg>
      ) : (
        <span style={{ color: fg, fontSize: size * 0.36, fontWeight: 700, letterSpacing: '-0.02em' }}>{initials}</span>
      )}
    </span>
  );
}
