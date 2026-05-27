/**
 * KickStock design tokens — TypeScript export for runtime consumers.
 * Use apps/web/styles/tokens.css for styling; use this file when you need
 * to read a token value from JS (animation libs, dynamic inline styles, e2e tests).
 */
export const tokens = {
  color: {
    bg:        '#0A0A0A',
    surface1:  '#111111',
    surface2:  '#181818',
    surface3:  '#1F1F1F',
    text:      '#FFFFFF',
    muted:     '#A3A3A3',
    dim:       '#6E6E6E',
    disabled:  '#444444',
    border:    '#222222',
    borderHi:  '#2E2E2E',
    gold:      '#FFDB00',
    goldDk:    '#B89800',
    gain:      '#00FF87',
    gainBg:    'rgba(0,255,135,0.08)',
    gainDk:    '#00662F',
    loss:      '#FF3B5C',
    lossBg:    'rgba(255,59,92,0.09)',
    lossDk:    '#7A1B2C',
    upset:     '#FF8800',
  },
  font: {
    display: `'Bebas Neue', sans-serif`,
    mono:    `'JetBrains Mono', ui-monospace, monospace`,
    body:    `'Inter Tight', system-ui, sans-serif`,
  },
  fontSize: {
    eyebrow: 12,
    label:   14,
    body:    16,
    hero:    24,
    section: 28,
    display: 48,
  },
  radius: { sm: 4, md: 8, lg: 12, xl: 16, pill: 9999 },
  space:  { 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32, 7: 48 },
  tap:    44,
  anim: {
    play:       9000,
    et:         5000,
    stinger:    1500,
    penKick:     900,
    penDecided:  300,
    resultIn:    400,
  },
  z: { shell: 10, overlay: 100, modal: 200, anim: 300, toast: 400 },
} as const;

export type Tokens = typeof tokens;
