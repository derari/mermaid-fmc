import type { ThemeDefaults } from './styleModel.js';

// Bridges Mermaid's theme into the renderer. Mermaid hands each diagram a config
// getter through `injectUtils` (see diagram.ts); we stash it here so the
// renderer — which draws fills inline and therefore needs the palette in JS, not
// just CSS — can read the resolved theme variables at draw time.

type ConfigGetter = () => { themeVariables?: Record<string, unknown> } | undefined;

let getConfig: ConfigGetter | null = null;

export function setConfigGetter(fn: ConfigGetter): void {
  getConfig = fn;
}

// The renderer's palette: the entity styling fallbacks (ThemeDefaults) plus the
// default line color, which differs from the entity outline (Mermaid keeps
// `lineColor` separate from `nodeBorder`).
export interface RenderTheme extends ThemeDefaults {
  line: string;
}

// Reads the theme variables into the renderer's palette.
//
// `shade` is the color a tint darkens toward as it nests, so nested fills stay
// legible: it must contrast the background and flip between light and dark
// themes. The theme's text/foreground color is exactly that — near-black on
// light themes, near-white on dark — so we read `primaryTextColor` (then
// `textColor`). This works for any theme, unlike keying off `darkMode`, which
// Mermaid's built-in themes don't even expose in `themeVariables`; that boolean
// is kept only as a last-resort fallback.
export function renderTheme(): RenderTheme {
  const vars = getConfig?.()?.themeVariables ?? {};
  const str = (key: string, fallback: string): string => {
    const v = vars[key];
    return typeof v === 'string' && v ? v : fallback;
  };
  return {
    tint: str('mainBkg', str('primaryColor', '#fff')),
    stroke: str('nodeBorder', str('primaryBorderColor', '#333')),
    line: str('lineColor', '#333'),
    shade: str('primaryTextColor', str('textColor', vars.darkMode === true ? 'white' : 'black')),
  };
}
