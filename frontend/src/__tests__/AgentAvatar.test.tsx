import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { AgentAvatar } from '../components/AgentAvatar';

describe('AgentAvatar', () => {
  it('renders an svg of the requested size', () => {
    const { container } = render(<AgentAvatar seed="agent-1" size={48} />);
    const svg = container.querySelector('svg')!;
    expect(svg).toBeTruthy();
    expect(svg.getAttribute('width')).toBe('48');
    expect(svg.getAttribute('height')).toBe('48');
  });

  it('is deterministic — the same seed produces identical markup', () => {
    const a = render(<AgentAvatar seed="stable-seed" />).container.innerHTML;
    const b = render(<AgentAvatar seed="stable-seed" />).container.innerHTML;
    expect(a).toBe(b);
  });

  it('produces different creatures for different seeds', () => {
    const a = render(<AgentAvatar seed="alpha" />).container.innerHTML;
    const b = render(<AgentAvatar seed="beta" />).container.innerHTML;
    expect(a).not.toBe(b);
  });

  it('uses a valid accent colour to drive the body hue (changes the output)', () => {
    const plain = render(<AgentAvatar seed="same" />).container.innerHTML;
    const tinted = render(<AgentAvatar seed="same" color="#FF0000" />).container.innerHTML;
    expect(tinted).not.toBe(plain);
    // feature geometry is identical (same seed) — only fills differ
    expect(tinted).toContain('hsl(0'); // red hue
  });

  it('ignores an invalid colour and falls back to the seed palette', () => {
    const fallback = render(<AgentAvatar seed="same" />).container.innerHTML;
    const invalid = render(<AgentAvatar seed="same" color="not-a-color" />).container.innerHTML;
    expect(invalid).toBe(fallback);
  });

  it('is decorative (aria-hidden) by default', () => {
    const { container } = render(<AgentAvatar seed="x" />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('role')).toBe('presentation');
  });

  it('becomes a labelled image when a label is provided', () => {
    const { getByRole } = render(<AgentAvatar seed="x" label="Avatar for Hunter" />);
    const img = getByRole('img', { name: 'Avatar for Hunter' });
    expect(img).toBeTruthy();
    expect(img.getAttribute('aria-hidden')).toBeNull();
  });
});
