import { useColorScheme } from 'react-native';

import {
  colors,
  fonts,
  groupAccents,
  minTapTarget,
  radii,
  shadows,
  space,
  typography,
  type ColorTokens,
} from './tokens';

export * from './tokens';

export type ColorScheme = 'light' | 'dark';

export type Theme = {
  scheme: ColorScheme;
  colors: ColorTokens;
  groupAccents: (typeof groupAccents)[ColorScheme];
  fonts: typeof fonts;
  typography: typeof typography;
  space: typeof space;
  radii: typeof radii;
  /** Shadows are `undefined` in dark mode, where a border hairline is used instead. */
  shadows: Record<keyof typeof shadows, string | undefined>;
  minTapTarget: number;
};

const noShadows = { shadow1: undefined, shadow2: undefined, shadow3: undefined };

export function getTheme(scheme: ColorScheme): Theme {
  return {
    scheme,
    colors: colors[scheme],
    groupAccents: groupAccents[scheme],
    fonts,
    typography,
    space,
    radii,
    shadows: scheme === 'dark' ? noShadows : shadows,
    minTapTarget,
  };
}

const themes = { light: getTheme('light'), dark: getTheme('dark') };

/** The current theme, following the system light/dark setting. */
export function useTheme(): Theme {
  return themes[useColorScheme() === 'dark' ? 'dark' : 'light'];
}
