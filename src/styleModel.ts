import { type Entity, STYLE_KEYS, type StyleProps } from './db.js';
import { tintFill, treeDepth } from './geometry.js';

// Resolves the declared styling (classDef / class / :::, `style <name>`, bare
// `style`, and inheritance) into a concrete fill and outline color per entity.
// Kept free of DOM and ELK so it is unit-tested directly, like geometry.ts; the
// renderer supplies the theme colors and applies the results.

// The theme-derived fallbacks a diagram starts from. `tint` is the base leaf
// color, `stroke` the default outline, `shade` the color a tint darkens toward
// as it nests (black on light themes, white on dark).
export interface ThemeDefaults {
  tint: string;
  stroke: string;
  shade: string;
}

// The drawing values for one entity. `strokeExplicit` is the inherited-or-own
// user stroke, if any — separate from `border` (which folds in the theme
// default) because a line only inherits an *explicit* stroke, otherwise using
// its own theme line color.
export interface Resolved {
  fill: string;
  border: string;
  strokeExplicit?: string;
  // The resolved `icon:pack:name` reference, if any. Like `fill` it is a per-node
  // property — taken from the entity's own style bag and never inherited — so a
  // parent's icon doesn't stamp itself on every child. The renderer resolves it to
  // SVG (see icons.ts) and draws it.
  icon?: string;
  // The `icon-size` factor of the line height (0/undefined = auto). Per-node like
  // `icon`; the renderer turns it into a pixel size against the context default.
  iconSize?: number;
}

// Copies one property from `next` onto `out` when set. A generic key ties the
// value and target to the same field, so a mixed string/number StyleProps assigns
// without a union-index write error.
function copyProp<K extends keyof StyleProps>(out: StyleProps, next: StyleProps, key: K): void {
  if (next[key] !== undefined) out[key] = next[key];
}

// Merges `next` over `base`, ignoring undefined props so later layers win
// per-property.
function merge(base: StyleProps, next: StyleProps | undefined): StyleProps {
  if (!next) return base;
  const out: StyleProps = { ...base };
  for (const key of STYLE_KEYS) copyProp(out, next, key);
  return out;
}

// The style an entity declares on itself, lowest-to-highest precedence:
// classes (each class's classDef, in listed order) < `style <name>` < bare
// `style`. Classes come from both `:::` on the declaration and `class`
// statements targeting the name.
function ownStyle(
  entity: Entity,
  classDefs: Map<string, StyleProps>,
  namedStyles: Map<string, StyleProps>,
  namedClasses: Map<string, string[]>,
): StyleProps {
  let bag: StyleProps = {};
  const classes = [
    ...(entity.classes ?? []),
    ...(entity.name ? namedClasses.get(entity.name) ?? [] : []),
  ];
  for (const cls of classes) {
    bag = merge(bag, classDefs.get(cls));
  }
  if (entity.name) bag = merge(bag, namedStyles.get(entity.name));
  bag = merge(bag, entity.style);
  return bag;
}

// Walks the tree top-down, threading the inherited tint/stroke/shade, and
// records each entity's drawing values. `fill` is a flat `fill:` when given,
// else the tint graduated by the entity's own subtree height.
export function resolveStyles(
  roots: Entity[],
  classDefs: Map<string, StyleProps>,
  namedStyles: Map<string, StyleProps>,
  namedClasses: Map<string, string[]>,
  theme: ThemeDefaults,
  // Diagram-wide defaults from a root-level bare `style` (see db.addRootStyle).
  // They seed the top-level inheritance base — more specific than the theme, less
  // than any entity's own style. `fill` never cascades, so it is inert here.
  rootStyle: StyleProps = {},
): Map<Entity, Resolved> {
  const resolved = new Map<Entity, Resolved>();

  const visit = (
    entity: Entity,
    inherited: { tint: string; stroke?: string; shade: string },
  ): void => {
    const own = ownStyle(entity, classDefs, namedStyles, namedClasses);
    const tint = own.tint ?? inherited.tint;
    const shade = own.shade ?? inherited.shade;
    const strokeExplicit = own.stroke ?? inherited.stroke;
    // A region is never tinted/shaded: it is transparent unless a `fill` is set,
    // and paints flat. It still threads the inherited tint/shade/stroke down to
    // its children unchanged, so it stays invisible to their styling too.
    const fill =
      entity.subtype === 'region'
        ? own.fill ?? 'transparent'
        : own.fill ?? tintFill(tint, shade, treeDepth(entity));

    resolved.set(entity, {
      fill,
      border: strokeExplicit ?? theme.stroke,
      strokeExplicit,
      // Non-inheriting, like `fill`: the entity's own resolved icon only (the
      // inherited base is never threaded down, so children start clean).
      icon: own.icon,
      iconSize: own.iconSize,
    });

    for (const child of entity.children) {
      visit(child, { tint, stroke: strokeExplicit, shade });
    }
  };

  // The outermost inheritance layer: the root style's tint/stroke/shade over the
  // theme's. Every top-level entity starts here, so a root `style tint:red` tints
  // the whole diagram unless a nearer declaration overrides it.
  const base = {
    tint: rootStyle.tint ?? theme.tint,
    stroke: rootStyle.stroke,
    shade: rootStyle.shade ?? theme.shade,
  };
  for (const root of roots) {
    visit(root, base);
  }
  return resolved;
}
