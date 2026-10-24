// Local dashboard palettes from the seminar deck (palettes.json).
// The selection is stored in localStorage only; nothing is sent to Supabase.

export const PALETTE_IDS = ['A', 'B', 'C', 'D'];

export const PALETTES = {
  A: {
    name: 'Paynes & Pearl',
    dk1: '1E2A33',
    lt1: 'FBF8F0',
    dk2: '536878',
    lt2: 'EAE0C8',
    accent1: '536878',
    accent2: '2F4250',
    accent3: 'C98A2B',
    accent4: '7A6F50',
    accent5: '6B7F8C',
    accent6: 'A8452F',
    hlink: '2F4250',
    folHlink: '6B7F8C',
  },
  B: {
    name: 'Sand & Indigo',
    dk1: '262438',
    lt1: 'FAF6EE',
    dk2: '343148',
    lt2: 'D7C49E',
    accent1: '4A4668',
    accent2: '343148',
    accent3: 'C8A25A',
    accent4: '7C6F4E',
    accent5: '6A6788',
    accent6: 'A33F3F',
    hlink: '343148',
    folHlink: '6A6788',
  },
  C: {
    name: 'Navy & Orange',
    dk1: '142F43',
    lt1: 'FEFAF7',
    dk2: '142F43',
    lt2: 'FBEEE5',
    accent1: '2E566F',
    accent2: '142F43',
    accent3: 'E48844',
    accent4: '5F7080',
    accent5: '657784',
    accent6: 'B0412A',
    hlink: '142F43',
    folHlink: '657784',
  },
  D: {
    name: 'Plum & Tangerine',
    dk1: '2A1232',
    lt1: 'FDFAF5',
    dk2: '2A1232',
    lt2: 'FBEBDC',
    accent1: '6B3A78',
    accent2: '2A1232',
    accent3: 'F28C38',
    accent4: '8A6A7A',
    accent5: '7E5F8A',
    accent6: 'B0412A',
    hlink: '2A1232',
    folHlink: '7E5F8A',
  },
};

export function toHex(value) {
  const text = String(value || '').replace('#', '').trim();
  return /^[0-9a-f]{6}$/i.test(text) ? `#${text.toUpperCase()}` : '';
}

export function toRgba(value, alpha = 1) {
  const hex = toHex(value);
  if (!hex) return `rgba(0,0,0,${alpha})`;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function paletteCss(palette) {
  const p = palette || PALETTES.A;
  return {
    '--bg': toHex(p.lt2),
    '--panel': toHex(p.lt1),
    '--panel-2': toHex(p.lt1),
    '--ink': toHex(p.dk1),
    '--muted': toHex(p.dk2),
    '--dim': toHex(p.accent4),
    '--orange': toHex(p.accent3),
    '--orange-soft': toRgba(p.accent3, 0.14),
    '--line': toRgba(p.dk1, 0.14),
    '--line-strong': toRgba(p.dk1, 0.24),
    '--green': toHex(p.accent5),
    '--red': toHex(p.accent6),
  };
}
