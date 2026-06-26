/**
 * AgentAvatar — deterministic, original "creature" avatar for an agent.
 *
 * Renders a small monster-style SVG (Pokémon-*aesthetic*, but 100% original art —
 * no copyrighted sprites, names, or likenesses) generated purely from the agent's
 * stable identity. The same `seed` always produces the same creature, so an agent
 * keeps its face across renders and screens, while every agent looks distinct.
 *
 * Feature selection (body shape, ears/horns, eyes, mouth, cheeks) and the colour
 * palette are derived from a seeded PRNG. When the agent has a chosen accent
 * `color` (existing cosmetic), it becomes the body hue so the avatar honours the
 * user's customization; otherwise the hue comes from the seed.
 *
 * Reusable by design: drop it anywhere an agent is shown (registry, leaderboard,
 * competition viewer, social views). It is decorative by default (aria-hidden) so
 * it never changes the accessible name of a button/row that already shows the
 * agent's text name — pass an explicit `label` to make it a standalone image.
 */

interface AgentAvatarProps {
  /** Stable identity — the agent id is ideal (never changes for an agent). */
  seed: string;
  /** Agent's chosen accent colour (hex). Drives the body hue when present/valid. */
  color?: string | null;
  /** Pixel size of the square avatar. Default: 40. */
  size?: number;
  /** When set, the avatar becomes a labelled image instead of decoration. */
  label?: string;
}

// ── Deterministic PRNG ──────────────────────────────────────────────────────

/** FNV-1a 32-bit string hash → stable unsigned seed. */
function hashSeed(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — tiny seeded PRNG returning floats in [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Colour helpers ──────────────────────────────────────────────────────────

/** Parse #rgb / #rrggbb into HSL; returns null if the string is not a hex colour. */
function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  let value = hex.trim().replace(/^#/, '');
  if (value.length === 3) value = value.split('').map(c => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return null;

  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;

  let h = 0;
  let s = 0;
  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r: h = ((g - b) / delta) % 6; break;
      case g: h = (b - r) / delta + 2; break;
      default: h = (r - g) / delta + 4; break;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: s * 100, l: l * 100 };
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const hsl = (h: number, s: number, l: number): string => `hsl(${Math.round(h)} ${Math.round(clamp(s, 0, 100))}% ${Math.round(clamp(l, 0, 100))}%)`;

// ── Component ───────────────────────────────────────────────────────────────

export function AgentAvatar({ seed, color, size = 40, label }: AgentAvatarProps) {
  const rand = mulberry32(hashSeed(seed || 'agent'));

  // Palette: honour the agent's accent colour when valid, else derive a hue from the seed.
  const accent = color ? hexToHsl(color) : null;
  const baseHue = accent ? accent.h : Math.floor(rand() * 360);
  const baseSat = accent ? clamp(accent.s, 45, 85) : 60 + rand() * 25;
  const baseLit = accent ? clamp(accent.l, 45, 65) : 52 + rand() * 12;

  const body    = hsl(baseHue, baseSat, baseLit);
  const belly   = hsl(baseHue, baseSat * 0.55, clamp(baseLit + 26, 0, 92));
  const outline = hsl(baseHue, clamp(baseSat + 6, 0, 100), clamp(baseLit - 30, 12, 100));
  const accentColour = hsl((baseHue + 180) % 360, 70, 55); // complementary, for cheeks/marks

  // Feature variants — each draw advances the PRNG, so the combination is seed-stable.
  const topVariant   = Math.floor(rand() * 4); // 0 ears, 1 horns, 2 antenna, 3 fin
  const eyeVariant   = Math.floor(rand() * 3); // 0 round, 1 oval, 2 happy
  const mouthVariant = Math.floor(rand() * 3); // 0 smile, 1 small, 2 open
  const hasCheeks    = rand() > 0.45;
  const eyeDx        = 11 + Math.floor(rand() * 3); // eye spacing jitter

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role={label ? 'img' : 'presentation'}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ display: 'block', flexShrink: 0 }}
    >
      {/* soft background disc tinted to the body colour */}
      <circle cx="32" cy="32" r="31" fill={hsl(baseHue, baseSat * 0.4, 94)} stroke={outline} strokeOpacity={0.25} />

      {/* ── top feature ── */}
      {topVariant === 0 && ( // ears
        <g fill={body} stroke={outline} strokeWidth={1.5}>
          <path d="M18 18 L13 5 L26 14 Z" />
          <path d="M46 18 L51 5 L38 14 Z" />
        </g>
      )}
      {topVariant === 1 && ( // horns
        <g fill={belly} stroke={outline} strokeWidth={1.5}>
          <path d="M22 14 L19 4 L27 12 Z" />
          <path d="M42 14 L45 4 L37 12 Z" />
        </g>
      )}
      {topVariant === 2 && ( // antenna
        <g stroke={outline} strokeWidth={2} fill={accentColour}>
          <line x1="32" y1="14" x2="32" y2="5" />
          <circle cx="32" cy="4" r="3" stroke="none" />
        </g>
      )}
      {topVariant === 3 && ( // fin / spikes
        <g fill={accentColour} stroke={outline} strokeWidth={1.2}>
          <path d="M26 12 L32 2 L38 12 Z" />
          <path d="M20 14 L24 7 L29 13 Z" />
          <path d="M44 14 L40 7 L35 13 Z" />
        </g>
      )}

      {/* ── body ── */}
      <ellipse cx="32" cy="38" rx="20" ry="19" fill={body} stroke={outline} strokeWidth={2} />
      {/* belly patch */}
      <ellipse cx="32" cy="42" rx="12" ry="12" fill={belly} />

      {/* ── cheeks ── */}
      {hasCheeks && (
        <g fill={accentColour} opacity={0.8}>
          <circle cx="19" cy="40" r="3.2" />
          <circle cx="45" cy="40" r="3.2" />
        </g>
      )}

      {/* ── eyes ── */}
      <g fill={outline}>
        {eyeVariant === 0 && ( // round
          <>
            <circle cx={32 - eyeDx} cy="33" r="4" />
            <circle cx={32 + eyeDx} cy="33" r="4" />
            <circle cx={32 - eyeDx + 1.4} cy="31.6" r="1.3" fill="#ffffff" />
            <circle cx={32 + eyeDx + 1.4} cy="31.6" r="1.3" fill="#ffffff" />
          </>
        )}
        {eyeVariant === 1 && ( // oval
          <>
            <ellipse cx={32 - eyeDx} cy="33" rx="3" ry="4.5" />
            <ellipse cx={32 + eyeDx} cy="33" rx="3" ry="4.5" />
            <circle cx={32 - eyeDx + 1} cy="31" r="1.1" fill="#ffffff" />
            <circle cx={32 + eyeDx + 1} cy="31" r="1.1" fill="#ffffff" />
          </>
        )}
        {eyeVariant === 2 && ( // happy (^ ^)
          <g stroke={outline} strokeWidth={2} fill="none" strokeLinecap="round">
            <path d={`M${32 - eyeDx - 3} 34 Q${32 - eyeDx} 29 ${32 - eyeDx + 3} 34`} />
            <path d={`M${32 + eyeDx - 3} 34 Q${32 + eyeDx} 29 ${32 + eyeDx + 3} 34`} />
          </g>
        )}
      </g>

      {/* ── mouth ── */}
      <g stroke={outline} strokeWidth={2} fill="none" strokeLinecap="round">
        {mouthVariant === 0 && <path d="M27 45 Q32 50 37 45" />}
        {mouthVariant === 1 && <path d="M30 46 Q32 48 34 46" />}
        {mouthVariant === 2 && <ellipse cx="32" cy="47" rx="3.5" ry="2.5" fill={accentColour} stroke={outline} />}
      </g>
    </svg>
  );
}

export default AgentAvatar;
