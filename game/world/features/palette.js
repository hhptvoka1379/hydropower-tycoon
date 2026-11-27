/* Field Notes palette in LINEAR rgb (three treats vertex and instance colours as linear). No THREE import: runs in Node. */
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export const lin = (hex) => [s2l(((hex >> 16) & 255) / 255), s2l(((hex >> 8) & 255) / 255), s2l((hex & 255) / 255)];
export const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

export const PAL = {
  paper: lin(0xf1ead9), ink: lin(0x2b2a26), moss: lin(0x4f6b3a), clay: lin(0xa3472c), river: lin(0x2f6f86), ochre: lin(0xc08a2e),
  mossDark: lin(0x34502a), mossLight: lin(0x7c9a4e), bark: lin(0x4a3b2a), steel: lin(0x8c9296), steelDark: lin(0x4b5055),
  concrete: lin(0xb9b5a8), concreteDark: lin(0x8f8b80), panel: lin(0x1d3050), panelLine: lin(0x6f86a6), wood: lin(0x8a6034),
  white: lin(0xf4f2ea), gravel: lin(0xcdbf98), trodden: lin(0xd6c79c),
};
