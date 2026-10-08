export const SAGE_LIGHT = {
  paper: '#ECF1EE',
  surface: '#FFFFFF',
  frame: '#F4F7F5',
  ink: '#12201B',
  muted: '#55655F',
  line: '#D3DDD8',
  accent: '#0F6B54',
  'accent-ink': '#FFFFFF',
  mark: '#FFC83D',
  'mark-ink': '#12201B',
} as const;

export const SAGE_DARK = {
  paper: '#0E1512',
  surface: '#16201B',
  frame: '#1C2823',
  ink: '#E8F0EC',
  muted: '#9BADA5',
  line: '#26352E',
  accent: '#4CC9A0',
  'accent-ink': '#08251B',
  mark: '#FFC83D',
  'mark-ink': '#12201B',
} as const;

function sRGBtoLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const num = parseInt(clean, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * sRGBtoLinear(r) + 0.7152 * sRGBtoLinear(g) + 0.0722 * sRGBtoLinear(b);
}

export function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}
