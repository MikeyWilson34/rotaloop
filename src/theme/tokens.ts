/**
 * Design tokens ported 1:1 from design/design-system.md (draft v0.1).
 * Keep names in sync with that document.
 */

export type ColorTokens = {
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  borderStrong: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  navy: string;
  /** Text/icons drawn on `navy` (hero card). */
  onNavy: string;
  primary: string;
  /** Text/icons drawn on a filled `primary`, `success` or `danger` surface. */
  onPrimary: string;
  primaryTint: string;
  success: string;
  successText: string;
  successTint: string;
  warning: string;
  warningText: string;
  warningTint: string;
  danger: string;
  dangerText: string;
  dangerTint: string;
  neutralTint: string;
  /** Bottom-sheet scrim. */
  scrim: string;
  /** Active tab colour: navy in light mode, `text` in dark mode. */
  tabActive: string;
  /** Selected chip fill and its label: navy in light mode, `primary` in dark mode. */
  chipOn: string;
  onChipOn: string;
};

const light: ColorTokens = {
  bg: '#FAF7F2',
  surface: '#FFFFFF',
  surfaceAlt: '#F3EEE6',
  border: '#E8E1D6',
  borderStrong: '#D8CFC1',
  text: '#1F2D45',
  textSecondary: '#5F6673',
  textTertiary: '#686E79',
  navy: '#1F2D45',
  onNavy: '#FFFFFF',
  primary: '#3A6894',
  onPrimary: '#FFFFFF',
  primaryTint: '#E5EDF5',
  success: '#4E7D5B',
  successText: '#3D6B4A',
  successTint: '#E4EEE6',
  warning: '#C98A2B',
  warningText: '#8A5A0F',
  warningTint: '#FBEED6',
  danger: '#A9483F',
  dangerText: '#9C3F37',
  dangerTint: '#F7E2DE',
  neutralTint: '#ECEAE6',
  scrim: 'rgba(17,22,31,0.45)',
  tabActive: '#1F2D45',
  chipOn: '#1F2D45',
  onChipOn: '#FFFFFF',
};

const dark: ColorTokens = {
  bg: '#11161F',
  surface: '#1A212C',
  surfaceAlt: '#232C3A',
  border: '#2C3646',
  borderStrong: '#3B475A',
  text: '#EEF1F6',
  textSecondary: '#A7B0BE',
  textTertiary: '#7F8999',
  navy: '#22324D',
  onNavy: '#FFFFFF',
  primary: '#86AEDB',
  onPrimary: '#0F1A2A',
  primaryTint: '#1F2E42',
  success: '#93C4A0',
  successText: '#93C4A0',
  successTint: '#1E3326',
  warning: '#E6B567',
  warningText: '#E6B567',
  warningTint: '#3A2E17',
  danger: '#EE958B',
  dangerText: '#EE958B',
  dangerTint: '#3D2220',
  neutralTint: '#262D38',
  scrim: 'rgba(17,22,31,0.45)',
  tabActive: '#EEF1F6',
  chipOn: '#86AEDB',
  onChipOn: '#0F1A2A',
};

export const colors = { light, dark } as const;

/** Group identity accents (never used for status). */
export const groupAccents = {
  light: {
    blue: { icon: '#3A6894', tile: '#E5EDF5' },
    plum: { icon: '#7A5A8C', tile: '#EFE7F3' },
    clay: { icon: '#A0603E', tile: '#F6E8DF' },
    teal: { icon: '#2F7C7A', tile: '#DFF0EE' },
  },
  dark: {
    blue: { icon: '#86AEDB', tile: '#1F2E42' },
    plum: { icon: '#C3A6D3', tile: '#2E2436' },
    clay: { icon: '#E3A88A', tile: '#382820' },
    teal: { icon: '#86CBC8', tile: '#1A3332' },
  },
} as const;

export type GroupAccent = keyof typeof groupAccents.light;

/**
 * Nunito Sans font families, one per loaded weight. On native, custom fonts are
 * selected by family name, so we never set `fontWeight` alongside these.
 */
export const fonts = {
  regular: 'NunitoSans_400Regular',
  semibold: 'NunitoSans_600SemiBold',
  bold: 'NunitoSans_700Bold',
  extrabold: 'NunitoSans_800ExtraBold',
} as const;

export type TypeStyle = {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing?: number;
  textTransform?: 'uppercase';
};

export const typography = {
  display: { fontFamily: fonts.extrabold, fontSize: 30, lineHeight: 36 },
  title1: { fontFamily: fonts.extrabold, fontSize: 28, lineHeight: 34 },
  // The design calls for weight 750; static font files stop at 700/800, so 800 is used.
  title2: { fontFamily: fonts.extrabold, fontSize: 22, lineHeight: 28 },
  title3: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 24 },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24 },
  bodyStrong: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 24 },
  callout: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 22 },
  subhead: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  caption: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18 },
  overline: {
    fontFamily: fonts.bold,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 12 * 0.06,
    textTransform: 'uppercase',
  },
} as const satisfies Record<string, TypeStyle>;

export type TypeVariant = keyof typeof typography;

/** 4-pt spacing scale. */
export const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

/**
 * Elevation, as CSS box-shadow strings (supported by React Native's New
 * Architecture and by react-native-web). Navy-tinted, warm and low.
 * In dark mode shadows are replaced by a `border` hairline (see Card).
 */
export const shadows = {
  shadow1: '0px 1px 2px rgba(31,45,69,0.06), 0px 2px 8px rgba(31,45,69,0.05)',
  shadow2: '0px 4px 12px rgba(31,45,69,0.08), 0px 12px 32px rgba(31,45,69,0.08)',
  shadow3: '0px -8px 32px rgba(31,45,69,0.16)',
} as const;

export type ShadowToken = keyof typeof shadows;

/** Minimum hit area for anything tappable. */
export const minTapTarget = 48;

/**
 * The app's column width on wide screens (web on a desktop or tablet): the app stays a
 * phone-like column, centred on the page, instead of stretching across the window.
 */
export const appColumnMaxWidth = 600;
