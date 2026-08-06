// LinkedIn Auto-Connector — single source of truth for colors.
// Both surfaces consume this:
//   • content.js  reads LI_PALETTE directly (loaded before it in the manifest).
//   • popup.html  mirrors the values as CSS variables (kept in sync manually).
//
// Semantic tokens (dark UI):
//   ok      green — success / connected / seen
//   warn    amber — in-progress, pending, skipped
//   danger  red   — failures / stop
//   info    blue  — accents on dark backgrounds
//   infoOnWhite — blue with >= 4.5:1 contrast on LinkedIn's white feed
const LI_PALETTE = {
  // Base hues (kept for back-compat)
  inkBlack: '#0d1321',
  deepSpaceBlue: '#1d2d44',
  blueSlate: '#3e5c76',
  dustyDenim: '#748cab',
  eggshell: '#f0ebd8',

  // === Semantic tokens ===
  ok: '#22c55e',            // success green (9.2:1 on black)
  okText: '#4ade80',        // brighter green for text on dark
  warn: '#fbbf24',          // amber — in progress / pending / skipped (12.6:1 on black)
  danger: '#f87171',        // red — failures / stop (7.6:1 on black)
  info: '#60a5fa',          // blue accent on dark (8.3:1 on black)
  infoOnWhite: '#2563eb',   // blue for outlines on LinkedIn's white feed (5.1:1 on white)
  focus: '#60a5fa',         // focus rings

  // === Neutrals / surfaces ===
  cardBg: '#141414',        // raised card surface
  borderSoft: '#444444',    // visible but quiet borders (~2.6:1 on cardBg)
  borderStrong: '#666666',  // panel borders on black (~3.5:1)
  muted: '#bbbbbb',         // secondary text on dark (10.9:1)

  // === Seen-state chip ===
  seenChipBg: 'rgba(34,197,94,.15)',
  seenRowTint: 'rgba(34,197,94,.06)',
  seenBorder: '#22c55e'
};
