// Mermaid's canonical layout directions. `TD` (top-down) is an alias for `TB`
// used by flowchart; we normalize it away on the way in.
export type Direction = 'TB' | 'BT' | 'LR' | 'RL';

// Every entity has a coarse `type` and a finer `subtype`. The type fixes the
// shape family — `actor` is drawn with sharp rectangular corners, `storage`
// with rounded ones — while the subtype selects the specific variant. `region`
// is its own family: a purely structural grouping box (no border, transparent
// fill) that is invisible to the depth-tinting model. `port` is its own family
// too: a named connection point pinned to one edge of its parent container,
// realised as an ELK port (see the renderer) rather than a drawn box.
export type EntityType = 'actor' | 'storage' | 'region' | 'port';
export type EntitySubtype =
  // actors
  | 'actor'
  | 'pipe'
  | 'user'
  // storages
  | 'storage'
  | 'variance'
  | 'channel'
  | 'request'
  | 'queue'
  // layout helpers
  | 'region'
  | 'port';

// Maps each subtype (which is also its keyword) onto its coarse type. This is
// the single source of truth for the actor/storage grouping.
export const SUBTYPE_TYPE: Record<EntitySubtype, EntityType> = {
  actor: 'actor',
  pipe: 'actor',
  user: 'actor',
  storage: 'storage',
  variance: 'storage',
  channel: 'storage',
  request: 'storage',
  queue: 'storage',
  region: 'region',
  port: 'port',
};

// Leaves that carry no drawn label and cannot contain nested entities (only
// lines): the connectors (pipe, channel, request) and ports. A `request` draws
// exactly like a channel plus a direction arrow inside it (see the renderer), so
// it shares every connector rule. A `port` additionally never becomes a box of
// its own — it is turned into an ELK port on its parent — but it shares the
// "childless, unlabelled" rules the parser and renderer key off this set.
export const CONNECTOR_SUBTYPES: ReadonlySet<EntitySubtype> = new Set<EntitySubtype>(
  ['pipe', 'channel', 'request', 'port'],
);

// Leaves that cannot contain nested boxes (only lines, and — since every one of
// these is still a drawn box — `port`s pinned to their edges). This is a superset
// of the connectors: a `queue` and a `user` are childless too, but — unlike a
// connector — each is a full box that prints its name, so they are deliberately
// kept OUT of CONNECTOR_SUBTYPES (which drives the unlabelled/glyph rules). The
// parser keys its nesting check off this broader set, allowing only `port`
// children through (and none at all under a `port`, which has no box to pin to).
export const CHILDLESS_SUBTYPES: ReadonlySet<EntitySubtype> = new Set<EntitySubtype>(
  [...CONNECTOR_SUBTYPES, 'queue', 'user'],
);

// Subtypes whose caption defaults to their reference name when no explicit label
// is given (`actor Bob` draws "Bob"). Everything else defaults to no caption: a
// connector (channel/pipe) and a region draw a label only when one is set
// explicitly, and a port never carries one.
export const NAME_AS_LABEL_SUBTYPES: ReadonlySet<EntitySubtype> = new Set<EntitySubtype>(
  ['actor', 'storage', 'variance', 'queue', 'user'],
);

// The two multiplicity markers a keyword may carry, both meaning "several
// instances": `star` (a trailing `*`) draws a small-offset shadow box; `dots`
// (a trailing `...`) draws three dots in the bottom-right corner — plus, on the
// shadow families below, a larger-offset shadow box behind them. See the renderer
// for the geometry.
export type MultiplicityKind = 'star' | 'dots';

// The full-box families that render a "shadow" box (offset diagonally behind the
// entity) for a multiplicity marker. `*` is ONLY valid on these; `...` is valid
// on every subtype except `port` but draws a shadow only here — elsewhere it is
// dots alone (the parser enforces the port exclusion, the renderer the shadow).
export const MULTIPLICITY_SUBTYPES: ReadonlySet<EntitySubtype> = new Set<EntitySubtype>(
  ['actor', 'storage', 'variance', 'user'],
);

// The style properties a `style`/`classDef` statement can carry. The colors
// (any whitespace-free CSS color): `fill` paints one node's background flat;
// `tint` is the base of a node's depth-graduated fill and cascades to
// descendants; `stroke` is the outline color and cascades to descendants and to
// lines written inside them; `shade` is the color a `tint` darkens toward as it
// nests (defaults to black on light themes, white on dark). `icon` is an
// Iconify-style `pack:name` reference drawn on the node; `iconSize` is its size as
// a factor of the line height (1 = one line height, 0/undefined = auto — the
// context-dependent default). Like `fill`, `icon`/`iconSize` apply to just that
// node and never cascade to children (see styleModel / icons.ts).
export interface StyleProps {
  fill?: string;
  tint?: string;
  stroke?: string;
  shade?: string;
  icon?: string;
  iconSize?: number;
}

// The StyleProps field names, used by the merge helpers (db / styleModel) to copy
// a value per property so later declarations win field-by-field.
export const STYLE_KEYS: ReadonlySet<keyof StyleProps> = new Set<keyof StyleProps>([
  'fill',
  'tint',
  'stroke',
  'shade',
  'icon',
  'iconSize',
]);

// The DSL prop tokens a `style`/`classDef` statement writes, mapped to the
// StyleProps field each fills. Most are identical; `icon-size` is the kebab token
// for the numeric `iconSize` field. The parser builds its `key:` matcher from these
// tokens and, for `iconSize`, parses the value into a number (see parseIconSize).
export const STYLE_PROP_KEYS: ReadonlyMap<string, keyof StyleProps> = new Map<
  string,
  keyof StyleProps
>([
  ['fill', 'fill'],
  ['tint', 'tint'],
  ['stroke', 'stroke'],
  ['shade', 'shade'],
  ['icon', 'icon'],
  ['icon-size', 'iconSize'],
]);

// A line is meaningful only across the two families: an actor connects to a
// storage. Connectors carry a family of their own (a channel is storage, a pipe
// an actor), so two actors talking through a channel — actor–channel–actor — is
// really two valid actor↔storage lines. A line whose endpoints share a coarse
// type — actor-to-actor or storage-to-storage — is invalid, and the renderer
// flags it. A `port` is its own coarse type, so a line touching one never
// collides with an actor or storage; the renderer additionally treats any
// port-involving line as valid outright (even port-to-port), since a port is a
// routing anchor rather than a modelled participant.
export function isInvalidConnection(a: EntityType, b: EntityType): boolean {
  return a === b;
}

export interface Entity {
  // The reference id — how the DSL picks this entity out (lines, `style`,
  // `class`, `:::`). May be empty: an entity declared with only a quoted label
  // (`actor "Alice"`) has no name and cannot be referenced.
  name: string;
  // The caption drawn on the diagram, when set explicitly with a quoted label
  // (`actor a "Alice"`). Undefined means "no explicit label", so the drawn
  // caption falls back to the subtype default — see `entityLabel`. An explicit
  // empty string (`actor a ""`) suppresses the caption entirely.
  label?: string;
  type: EntityType;
  subtype: EntitySubtype;
  children: Entity[];
  // Layout direction for THIS entity's children. Undefined means "inherit"
  // (from the enclosing container, ultimately the diagram default).
  direction?: Direction;
  // Styles declared directly on this entity by a bare `style` statement nested
  // under it. Left undefined when none, so entity equality in tests is unaffected.
  style?: StyleProps;
  // Class names attached via `:::` on the declaration. Undefined when none.
  classes?: string[];
  // For a `port` only: which edge of its parent container it pins to (the
  // required trailing compass direction of `port <name> <dir>`). Undefined on
  // every other subtype.
  portSide?: Side;
  // For a `request` only: the direction its inner arrow points, from the optional
  // trailing orientation token of `request <name> <dir>`. A concrete compass side
  // is fixed; `'back'` is resolved at render time to the OPPOSITE of the flow
  // direction (auto's opposite). Undefined means "auto" — the arrow follows the
  // container's flow direction downstream. Undefined on every other subtype.
  requestDir?: Side | 'back';
  // Set by a trailing multiplicity marker on the keyword — `*` (`actor* servers`)
  // or `...` (`actor... servers`) — meaning the entity stands for several
  // instances. Both draw a diagonal shadow box behind it (a smaller offset for
  // `*`, larger for `...`); `...` additionally draws three corner dots. Only the
  // MULTIPLICITY_SUBTYPES accept it (the parser rejects it elsewhere). Undefined
  // when absent, so entity equality in tests is unaffected.
  multiplicity?: MultiplicityKind;
}

// The caption text the renderer should draw for an entity — `''` meaning no
// caption at all. An explicit label (including an explicit empty string) always
// wins; otherwise name-as-label subtypes fall back to their name and everything
// else (connectors, regions, ports) to nothing. Ports never draw a caption.
export function entityLabel(entity: Entity): string {
  if (entity.subtype === 'port') return '';
  if (entity.label !== undefined) return entity.label;
  return NAME_AS_LABEL_SUBTYPES.has(entity.subtype) ? entity.name : '';
}

// A connection between two entities. `---` is undirected; `-->` points from the
// source to the target; `<--` points the other way (target to source).
export type LineType = '---' | '-->' | '<--';

// A box side, in compass terms: north/east/south/west.
export type Side = 'n' | 'e' | 's' | 'w';

// Explicit routing hints a `route` statement attaches to a line. Unlike `style`
// (a CSS-passthrough appearance bag), routing is about layout, so it lives in its
// own field with a validated vocabulary. Every knob is optional; the renderer
// fills in defaults (`exit:auto enter:auto depth:1 bend:z`) and only ever consults
// routing for a line that crosses a container boundary.
//
//  - `exit`  which side of the crossed container the line leaves; `auto` derives
//            the axis from the container's flow direction and the sign from the
//            target's position.
//  - `enter` which side of the crossed container the line enters on the target
//            side; `auto` faces the source's exit (the side opposite `exit`).
//  - `depth` how many nesting levels get an ELK-routed port (the port chain);
//            the remainder is hand-routed. `0` is fully hand-routed.
//  - `bend`  the hand-routed segment's shape: `z` = HVH, `n` = VHV; `auto`
//            picks the axis the endpoints are more separated along.
export interface RouteSpec {
  exit?: Side | 'auto';
  enter?: Side | 'auto';
  depth?: number | 'auto';
  bend?: 'z' | 'n' | 'auto';
}

// A line's endpoints are resolved to entities only at render time, since an
// absolute line may reference an entity declared later in the source.
//
// Each endpoint is either a name (absolute lines: `A --> B`) or a direct entity
// reference. The reference form is required whenever an endpoint is an unnamed
// connector that no name could pick out: the source of a relative line (`--> B`
// nested under it), and either endpoint of the lines a complex line generates
// around its auto-inserted connector.
export interface Line {
  source: Entity | string;
  target: Entity | string;
  type: LineType;
  // Styles declared on the line by a `style` statement nested under it. Only
  // `stroke` is meaningful for a drawn line; undefined when none.
  style?: StyleProps;
  // The entity a relative line was written inside, whose stroke it inherits.
  // Undefined marks an absolute line, which instead inherits from the lowest
  // common ancestor of its endpoints (computed at render time).
  container?: Entity | null;
  // Layout routing hints from a `route` statement — either nested directly under
  // the line, or an entity-wide default from a `route` in the entity this line was
  // declared in (the line's own keys win). Kept separate from `style` (routing is
  // layout, not appearance) and undefined when none, so line equality in tests is
  // unaffected.
  routing?: RouteSpec;
}

// Module-level state, mirroring how Mermaid's built-in diagrams keep their db.
// `clear()` is called at the start of every parse so renders don't leak into
// each other on a page with multiple diagrams.
//
// The diagram itself is modelled as a `root` container entity: the top-level
// entities are its children, and the diagram-wide direction and style are simply
// ITS OWN direction and style. This is what lets "diagram scope" stop being a
// special case — in the parser it is just the outermost entity (see the root
// frame there), so a diagram-wide `style`/`route`/`direction` reuses the ordinary
// entity machinery. It is a region (borderless, transparent, invisible to depth)
// and is never drawn; only its children are, so it stays out of the public API —
// `getEntities()` exposes its children, and `getDirection()`/`getRootStyle()` its
// own fields.
function makeRoot(): Entity {
  return { name: '', type: 'region', subtype: 'region', children: [] };
}
let root: Entity = makeRoot();
let lines: Line[] = [];
// When set (via the root-only `debug ports` directive), the renderer draws the
// otherwise-invisible routing ports as small red squares. Off by default. This is
// a diagram-level toggle, not an entity property, so it stays a plain flag.
let debugPorts = false;
// Named style bags from `classDef`, style set on entities by name via
// `style <name> …`, and class assignments from `class <names> <class>`. All are
// resolved against the entity tree at render time.
let classDefs: Map<string, StyleProps> = new Map();
let namedStyles: Map<string, StyleProps> = new Map();
let namedClasses: Map<string, string[]> = new Map();

// Copies one property from `next` onto `out` when set. A generic key keeps the
// value and target types tied to the same field, so a mixed string/number
// StyleProps assigns without a union-index write error.
function copyProp<K extends keyof StyleProps>(out: StyleProps, next: StyleProps, key: K): void {
  if (next[key] !== undefined) out[key] = next[key];
}

// Merges `next` over `base`, ignoring undefined props, so later declarations win
// per-property rather than wholesale.
function mergeStyle(base: StyleProps, next: StyleProps): StyleProps {
  const out: StyleProps = { ...base };
  for (const key of STYLE_KEYS) copyProp(out, next, key);
  return out;
}

export const db = {
  clear(): void {
    root = makeRoot();
    lines = [];
    debugPorts = false;
    classDefs = new Map();
    namedStyles = new Map();
    namedClasses = new Map();
  },

  // The root container entity. The parser uses it as the outermost nesting frame
  // so diagram-scoped statements attach to it like any other entity.
  getRoot(): Entity {
    return root;
  },

  // Adds an entity as a child of `parent`, or of the root when parent is null.
  // The coarse type is derived from the subtype. Returns the created node so the
  // parser can use it as a nesting anchor.
  addEntity(
    name: string,
    subtype: EntitySubtype,
    parent: Entity | null = null,
  ): Entity {
    const entity: Entity = {
      name,
      type: SUBTYPE_TYPE[subtype],
      subtype,
      children: [],
    };
    (parent ?? root).children.push(entity);
    return entity;
  },

  // Records a connection. Endpoints are stored verbatim and resolved to
  // entities by the renderer, so forward references (`A --> B` before `B` is
  // declared) and unnamed connector sources both work. Returns the stored line
  // so the parser can attach a nested `style` to it afterwards.
  addLine(
    source: Entity | string,
    target: Entity | string,
    type: LineType,
    container: Entity | null = null,
  ): Line {
    const line: Line = { source, target, type };
    // Only relative lines record a container; absolute lines (null) fall back to
    // the endpoints' common ancestor. Kept off the object when null so line
    // equality in tests is unaffected.
    if (container) line.container = container;
    lines.push(line);
    return line;
  },

  getLines(): Line[] {
    return lines;
  },

  // Records a `classDef <name> …`, merging over any earlier definition so a
  // repeated classDef refines rather than replaces.
  addClassDef(name: string, style: StyleProps): void {
    classDefs.set(name, mergeStyle(classDefs.get(name) ?? {}, style));
  },

  getClassDefs(): Map<string, StyleProps> {
    return classDefs;
  },

  // Records a `style <name> …`, merging so several statements for one name
  // accumulate (last value wins per property).
  addNamedStyle(name: string, style: StyleProps): void {
    namedStyles.set(name, mergeStyle(namedStyles.get(name) ?? {}, style));
  },

  getNamedStyles(): Map<string, StyleProps> {
    return namedStyles;
  },

  // Records a `class <names> <class>` assignment, accumulating class names per
  // entity name.
  addNamedClasses(name: string, classNames: string[]): void {
    const existing = namedClasses.get(name) ?? [];
    namedClasses.set(name, [...existing, ...classNames]);
  },

  getNamedClasses(): Map<string, string[]> {
    return namedClasses;
  },

  // The diagram-wide default style: the root entity's own style, set by a bare
  // `style` at the diagram root (the parser attaches it like any bare style). Its
  // inheritable props (tint/stroke/shade) seed every top-level entity — the
  // outermost layer, one notch more specific than the theme; `fill` has no root
  // box to paint and does not cascade, so it is inert here.
  getRootStyle(): StyleProps {
    return root.style ?? {};
  },

  // Sets the child-layout direction. `target === null` sets it on the root, which
  // IS the diagram default (top-level entities are the root's children).
  setDirection(direction: Direction, target: Entity | null = null): void {
    (target ?? root).direction = direction;
  },

  getEntities(): Entity[] {
    return root.children;
  },

  getDirection(): Direction {
    return root.direction ?? 'LR';
  },

  // Toggles the `debug ports` overlay (root-only directive).
  setDebugPorts(on: boolean): void {
    debugPorts = on;
  },

  getDebugPorts(): boolean {
    return debugPorts;
  },

  // Accessibility / title hooks Mermaid may call on any db. No-ops for now.
  setAccTitle(): void {},
  getAccTitle(): string {
    return '';
  },
  setAccDescription(): void {},
  getAccDescription(): string {
    return '';
  },
  setDiagramTitle(): void {},
  getDiagramTitle(): string {
    return '';
  },
};

export type FmcDb = typeof db;
