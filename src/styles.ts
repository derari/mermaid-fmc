// Mermaid injects this into a <style> scoped to the diagram's svg, calling it
// with the resolved theme variables (plus `svgId`). We read the palette from
// them so an unstyled diagram tracks the active Mermaid theme (including dark
// mode), falling back to the historical lavender values when a variable is
// missing.
//
// These are the *defaults*: every entity outline carries `fmc-entity` (plus
// `fmc-<subtype>` and, for containers, `fmc-container`), and every edge
// `fmc-edge`. The renderer overrides fill — and stroke, when a `style`/`tint`
// applies — with an inline `style`, which beats these rules; so `fill` is
// intentionally NOT set here.

interface ThemeOptions {
  nodeBorder?: string;
  primaryBorderColor?: string;
  lineColor?: string;
  textColor?: string;
  nodeTextColor?: string;
  fontFamily?: string;
  fontSize?: string | number;
}

const pick = (value: string | number | undefined, fallback: string): string =>
  value !== undefined && value !== '' ? String(value) : fallback;

// Scales a CSS length (`14px`, `1rem`, or a bare number) by a factor, preserving
// the unit (defaulting to px). Used to derive the queue label's slightly smaller
// font from the theme font size.
const scaleLength = (size: string, factor: number): string => {
  const m = /^([\d.]+)(.*)$/.exec(size.trim());
  if (!m) return size;
  return `${parseFloat(m[1]) * factor}${m[2] || 'px'}`;
};

// The invalid-line diagnostic is a fixed bold red by design (see README): it
// must stand out regardless of the active theme, so it is not theme-derived.
const INVALID = '#ff0000';

const styles = (options: ThemeOptions = {}): string => {
  const stroke = pick(options.nodeBorder ?? options.primaryBorderColor, '#333');
  const line = pick(options.lineColor, '#333');
  const text = pick(options.nodeTextColor ?? options.textColor, '#333');
  const font = pick(options.fontFamily, "'trebuchet ms', verdana, arial, sans-serif");
  const fontSize = pick(options.fontSize, '14px');
  return `
  .fmc-entity {
    stroke: ${stroke};
    stroke-width: 1.5px;
  }
  /* Variance: a storage drawn with a dashed outline. */
  .fmc-variance {
    stroke-dasharray: 10;
  }
  .fmc-label {
    fill: ${text};
    font-family: ${font};
    font-size: ${fontSize};
  }
  /* A queue's label is drawn one notch (10%) smaller than the diagram font.
     Same specificity as .fmc-label, so it wins by coming later. */
  .fmc-queue-label {
    font-size: ${scaleLength(fontSize, 0.9)};
  }
  /* A connector's caption sits beside the glyph; drawn one notch smaller so the
     small connector doesn't carry an oversized label. */
  .fmc-connector-label {
    font-size: ${scaleLength(fontSize, 0.9)};
  }
  /* Icons inherit the label text color through \`currentColor\` in their body, so
     monochrome packs (e.g. Lucide) match the caption; multicolor packs keep their
     own fills. */
  .fmc-icon {
    color: ${text};
  }
  /* A \`user\`'s default stick figure: outlined limbs, filled head, in text color. */
  .fmc-user-figure {
    stroke: ${text};
    stroke-width: 1.5px;
    stroke-linecap: round;
    fill: none;
  }
  .fmc-user-figure circle {
    fill: none;
  }
  /* Connections between entities. */
  .fmc-edge {
    fill: none;
    stroke: ${line};
    stroke-width: 1.5px;
  }
  .fmc-arrow {
    fill: ${line};
  }
  /* An invalid line (both endpoints the same primary type) is bold red. These
     rules come last so their equal-specificity selectors win over the base. */
  .fmc-edge-invalid {
    stroke: ${INVALID};
    stroke-width: 2.5px;
  }
  .fmc-arrow-invalid {
    fill: ${INVALID};
  }
`;
};

export default styles;
