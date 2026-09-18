import { baseCss } from './base.js';
import { cleanTheme } from './clean.js';
import { executiveTheme } from './executive.js';
import { academicTheme } from './academic.js';
import { technicalTheme } from './technical.js';
import { marketingTheme } from './marketing.js';
import { compileBrandKit, type BrandKit } from './brand-kit.js';

export type { BrandKit, FontStyle, Density } from './brand-kit.js';

export const THEMES = {
  clean: cleanTheme,
  executive: executiveTheme,
  academic: academicTheme,
  technical: technicalTheme,
  marketing: marketingTheme,
} as const;

export type ThemeName = keyof typeof THEMES;

export const THEME_NAMES = Object.keys(THEMES) as ThemeName[];

export function isThemeName(value: unknown): value is ThemeName {
  return typeof value === 'string' && value in THEMES;
}

export type ComposeOptions = {
  theme?: ThemeName;
  brandKit?: BrandKit;
  customCss?: string;
};

// Cascade order: base → theme → brand kit → user css.
// Later layers override earlier ones via CSS variable shadowing.
export function composeTheme(options: ComposeOptions = {}): string {
  const themeName = options.theme ?? 'clean';
  const layers: string[] = [
    baseCss,
    THEMES[themeName],
    options.brandKit ? compileBrandKit(options.brandKit) : '',
    options.customCss ?? '',
  ];
  return layers.filter((s) => s.trim().length > 0).join('\n\n');
}
