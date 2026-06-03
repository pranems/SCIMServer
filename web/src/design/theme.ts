/**
 * Fluent UI v9 design theme configuration.
 *
 * Defines custom brand color ramp and creates light/dark themes
 * based on Microsoft Fluent design system.
 *
 * @see docs/UI_REDESIGN_ARCHITECTURE_AND_PLAN.md D5
 */
import {
  createLightTheme,
  createDarkTheme,
  type BrandVariants,
  type Theme,
} from '@fluentui/react-components';

/**
 * SCIMServer brand color ramp (blue-based, Azure-aligned).
 * Generated using Fluent UI Theme Designer for #0078D4 (Azure blue).
 */
const scimBrand: BrandVariants = {
  10: '#020305',
  20: '#111723',
  30: '#16253D',
  40: '#193254',
  50: '#1B3F6C',
  60: '#1B4C85',
  70: '#195A9F',
  80: '#0F69B7',
  90: '#0078D4',
  100: '#2B88D8',
  110: '#4B97DC',
  120: '#65A6E0',
  130: '#7CB5E4',
  140: '#93C4E8',
  150: '#A9D3EC',
  160: '#BFE2F0',
};

/** Light theme for default/light mode */
export const lightTheme: Theme = {
  ...createLightTheme(scimBrand),
};

/** Dark theme for dark mode */
export const darkTheme: Theme = {
  ...createDarkTheme(scimBrand),
};

// Override the foreground on brand background for better contrast in dark mode
darkTheme.colorBrandForeground1 = scimBrand[110];
darkTheme.colorBrandForeground2 = scimBrand[120];
