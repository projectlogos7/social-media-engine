/**
 * Types for a Claude Design System `tokens.json`. Every family but `type` is a
 * list of `{name, value, usage}`; colour values may be per theme and may be
 * aliases (`{other-token}`).
 */
export type ThemedValue = string | Record<string, string>;

export interface TokenEntry {
  name: string;
  value: ThemedValue;
  usage?: string;
}

export interface TypeStyle {
  name: string;
  family?: string;
  fontSize: string | number;
  lineHeight?: string | number;
  fontWeight?: string | number;
  fontStyle?: string;
  letterSpacing?: string | number;
  textTransform?: string;
  opticalSize?: number;
  sample?: string;
  usage?: string;
}

export interface FontFile {
  family: string;
  file: string;
  weight?: string;
  style?: string;
}

export interface TokensFile {
  name?: string;
  version?: number;
  color?: { themes?: { id: string; name?: string }[]; tokens: TokenEntry[] };
  type?: {
    fonts?: FontFile[];
    families?: Record<string, string>;
    groups?: { name: string; family?: string; styles: TypeStyle[] }[];
  };
  shadow?: { note?: string; tokens: TokenEntry[] };
  [family: string]: unknown;
}
