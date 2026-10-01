import React, { createContext, useContext, useMemo } from 'react';

export interface ILNTheme {
  colorPrimary: string;
  colorSuccess: string;
  colorWarning: string;
  colorDanger: string;
  colorText: string;
  colorTextMuted: string;
  colorBg: string;
  colorBorder: string;
  borderRadius: string;
  fontFamily: string;
}

const DEFAULT_THEME: ILNTheme = {
  colorPrimary: '#2563EB',
  colorSuccess: '#16A34A',
  colorWarning: '#D97706',
  colorDanger: '#DC2626',
  colorText: '#111827',
  colorTextMuted: '#6B7280',
  colorBg: '#FFFFFF',
  colorBorder: '#E5E7EB',
  borderRadius: '8px',
  fontFamily: 'system-ui, -apple-system, sans-serif',
};

const ThemeContext = createContext<ILNTheme>(DEFAULT_THEME);

export interface ThemeProviderProps {
  theme?: Partial<ILNTheme>;
  children: React.ReactNode;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ theme, children }) => {
  const merged = useMemo<ILNTheme>(() => ({ ...DEFAULT_THEME, ...theme }), [theme]);

  const cssVars = useMemo(
    () =>
      ({
        '--iln-color-primary': merged.colorPrimary,
        '--iln-color-success': merged.colorSuccess,
        '--iln-color-warning': merged.colorWarning,
        '--iln-color-danger': merged.colorDanger,
        '--iln-color-text': merged.colorText,
        '--iln-color-text-muted': merged.colorTextMuted,
        '--iln-color-bg': merged.colorBg,
        '--iln-color-border': merged.colorBorder,
        '--iln-border-radius': merged.borderRadius,
        '--iln-font-family': merged.fontFamily,
      } as React.CSSProperties),
    [merged]
  );

  return (
    <ThemeContext.Provider value={merged}>
      <div style={cssVars}>{children}</div>
    </ThemeContext.Provider>
  );
};

export function useILNTheme(): ILNTheme {
  return useContext(ThemeContext);
}
