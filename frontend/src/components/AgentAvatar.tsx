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
  const eyeVariant   = Math.floor(rand() * 3); // 0 round, 1 sparkly, 2 happy
  const mouthVariant = Math.floor(rand() * 3); // 0 grin, 1 smirk, 2 open + tongue
  const hasBrows     = rand() > 0.5;
  const eyeDx        = 10 + Math.floor(rand() * 3); // eye spacing jitter

  // Thick cartoon outline that scales gently with avatar size.
  const stroke = 2.6;

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
      <circle cx="32" cy="32" r="31" fill={hsl(baseHue, baseSat * 0.4, 95)} stroke={outline} strokeOpacity={0.2} />
      {/* ground shadow for a bit of depth */}
      <ellipse cx="32" cy="57" rx="17" ry="3.4" fill={outline} opacity={0.15} />

      {/* ── top feature (oversized, cartoon proportions) ── */}
      {topVariant === 0 && ( // big floppy ears
        <g fill={body} stroke={outline} strokeWidth={stroke} strokeLinejoin="round">
          <path d="M17 20 Q9 8 17 4 Q26 8 25 17 Z" />
          <path d="M47 20 Q55 8 47 4 Q38 8 39 17 Z" />
        </g>
      )}
      {topVariant === 1 && ( // chunky horns
        <g fill={belly} stroke={outline} strokeWidth={stroke} strokeLinejoin="round">
          <path d="M21 15 Q17 4 25 3 Q27 9 27 14 Z" />
          <path d="M43 15 Q47 4 39 3 Q37 9 37 14 Z" />
        </g>
      )}
      {topVariant === 2 && ( // bouncy antenna with a shiny bobble
        <g stroke={outline} strokeWidth={stroke} fill={accentColour} strokeLinecap="round">
          <path d="M32 16 Q28 9 32 5" fill="none" />
          <circle cx="32" cy="4" r="4" />
          <circle cx="30.6" cy="2.8" r="1.2" stroke="none" fill="#ffffff" />
        </g>
      )}
      {topVariant === 3 && ( // rounded fin / mohawk
        <g fill={accentColour} stroke={outline} strokeWidth={stroke} strokeLinejoin="round">
          <path d="M24 13 Q26 2 32 3 Q38 2 40 13 Z" />
        </g>
      )}

      {/* ── arms ── */}
      <g fill={body} stroke={outline} strokeWidth={stroke} strokeLinejoin="round">
        <ellipse cx="13" cy="40" rx="5" ry="6" />
        <ellipse cx="51" cy="40" rx="5" ry="6" />
      </g>

      {/* ── feet ── */}
      <g fill={belly} stroke={outline} strokeWidth={stroke} strokeLinejoin="round">
        <ellipse cx="24" cy="55" rx="6" ry="4.5" />
        <ellipse cx="40" cy="55" rx="6" ry="4.5" />
      </g>

      {/* ── body (big & round) ── */}
      <ellipse cx="32" cy="37" rx="21" ry="20" fill={body} stroke={outline} strokeWidth={stroke} />
      {/* belly patch */}
      <ellipse cx="32" cy="41" rx="13" ry="13" fill={belly} />
      {/* glossy highlight */}
      <ellipse cx="24" cy="27" rx="7" ry="5" fill="#ffffff" opacity={0.28} />

      {/* ── blush cheeks (always, for a friendly cartoon look) ── */}
      <g fill={accentColour} opacity={0.55}>
        <ellipse cx="18" cy="40" rx="4.2" ry="3" />
        <ellipse cx="46" cy="40" rx="4.2" ry="3" />
      </g>

      {/* ── eyebrows ── */}
      {hasBrows && (
        <g stroke={outline} strokeWidth={2} strokeLinecap="round">
          <path d={`M${32 - eyeDx - 4} 25 Q${32 - eyeDx} 23 ${32 - eyeDx + 4} 25`} fill="none" />
          <path d={`M${32 + eyeDx - 4} 25 Q${32 + eyeDx} 23 ${32 + eyeDx + 4} 25`} fill="none" />
        </g>
      )}

      {/* ── eyes (large, glossy) ── */}
      <g fill={outline}>
        {eyeVariant === 0 && ( // big round
          <>
            <circle cx={32 - eyeDx} cy="33" r="5.5" fill="#ffffff" stroke={outline} strokeWidth={1.4} />
            <circle cx={32 + eyeDx} cy="33" r="5.5" fill="#ffffff" stroke={outline} strokeWidth={1.4} />
            <circle cx={32 - eyeDx} cy="33.5" r="3" />
            <circle cx={32 + eyeDx} cy="33.5" r="3" />
            <circle cx={32 - eyeDx + 1.3} cy="32" r="1.4" fill="#ffffff" />
            <circle cx={32 + eyeDx + 1.3} cy="32" r="1.4" fill="#ffffff" />
          </>
        )}
        {eyeVariant === 1 && ( // tall sparkly
          <>
            <ellipse cx={32 - eyeDx} cy="33" rx="4.5" ry="6" fill="#ffffff" stroke={outline} strokeWidth={1.4} />
            <ellipse cx={32 + eyeDx} cy="33" rx="4.5" ry="6" fill="#ffffff" stroke={outline} strokeWidth={1.4} />
            <circle cx={32 - eyeDx} cy="34" r="3" />
            <circle cx={32 + eyeDx} cy="34" r="3" />
            <circle cx={32 - eyeDx + 1.2} cy="32.4" r="1.3" fill="#ffffff" />
            <circle cx={32 + eyeDx + 1.2} cy="32.4" r="1.3" fill="#ffffff" />
          </>
        )}
        {eyeVariant === 2 && ( // happy (^ ^)
          <g stroke={outline} strokeWidth={2.6} fill="none" strokeLinecap="round">
            <path d={`M${32 - eyeDx - 4} 35 Q${32 - eyeDx} 28 ${32 - eyeDx + 4} 35`} />
            <path d={`M${32 + eyeDx - 4} 35 Q${32 + eyeDx} 28 ${32 + eyeDx + 4} 35`} />
          </g>
        )}
      </g>

      {/* ── mouth ── */}
      <g stroke={outline} strokeWidth={2.4} fill="none" strokeLinecap="round" strokeLinejoin="round">
        {mouthVariant === 0 && <path d="M26 44 Q32 51 38 44" />}
        {mouthVariant === 1 && <path d="M29 46 Q32 49 35 45" />}
        {mouthVariant === 2 && (
          <>
            <path d="M27 44 Q32 51 37 44 Z" fill={hsl(baseHue, 40, 28)} />
            <path d="M31 48 Q32 50 33 48" stroke={accentColour} strokeWidth={1.6} />
          </>
        )}
      </g>
    </svg>
  );
}

export default AgentAvatar;
