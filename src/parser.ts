import { type ChainNode, type ComplexLineSpec, expandComplexLines } from './complexLines.js';
import {
  CHILDLESS_SUBTYPES,
  type Direction,
  type Entity,
  type EntitySubtype,
  type LineType,
  MULTIPLICITY_SUBTYPES,
  type RouteSpec,
  type Side,
  STYLE_PROP_KEYS,
  type StyleProps,
  db,
} from './db.js';

// Line-oriented parser. We split on newlines and dispatch each line by its
// leading keyword. Indentation is significant: it defines the entity tree, so a
// stack of (indent, entity) frames tracks the current nesting context.
//
// A hand-written line scanner is a deliberate choice over a parser generator:
// indentation-sensitive grammars are awkward in jison/Langium (they need
// synthetic INDENT/DEDENT tokens), whereas an indent stack models it directly.

const HEADER_RE = /^fmc(?:\s+(\S+))?$/;
// One keyword per subtype; the name is optional (connectors and bare regions
// are unnamed). A multiplicity marker glued to the keyword — `*` (`actor* servers`)
// or `...` (`actor... servers`) — is only meaningful on the full-box families (see
// MULTIPLICITY_SUBTYPES), which the handler enforces. A `*`/`...` elsewhere in a
// name is untouched: it only reads as the marker when it immediately follows the
// keyword.
const ENTITY_RE = /^(actor|storage|channel|request|queue|pipe|variance|region|port|user)(\*|\.\.\.)?(?:\s+(.+))?$/;
const DIRECTION_RE = /^direction\s+(\S+)$/;
// `debug ports` — a root-only directive that makes the renderer draw the
// otherwise-invisible routing ports as small red squares.
const DEBUG_PORTS_RE = /^debug\s+ports$/;
// `route <props>` — layout hints nested under a line (see parseRoute). Like a
// bare `style`, it must actually parse to be treated as a route statement, so a
// line whose first endpoint is literally named "route" still reads as a line.
const ROUTE_RE = /^route\s+(.+)$/;

// Color styling. `classDef <name> <props>` defines a reusable style bag;
// `class <names> <class>` attaches a class to comma-separated entity names (the
// class name is the final token); `style …` either targets entities by name
// (`style <name> <props>`) or, with no name, styles the entity or line it is
// nested under (`style <props>`). Props are `key:value` pairs separated by
// whitespace, commas, or semicolons (see splitStyleProps / parseProps).
const CLASSDEF_RE = /^classDef\s+(\S+)\s+(.+)$/;
const CLASS_RE = /^class\s+(.+)\s+(\S+)$/;
const STYLE_RE = /^style\s+(.+)$/;
// A single style token: one of the known DSL prop keys, then its value. The value
// may contain spaces and commas (e.g. `rgb(1, 2, 3)`); splitStyleProps keeps them
// together, so this matches everything after the colon. The key match is
// case-insensitive; parseProps lower-cases it before mapping to a field.
const PROP_RE = new RegExp(`^(${[...STYLE_PROP_KEYS.keys()].join('|')}):(.+)$`, 'i');

// Separator between style props: whitespace, comma, or semicolon — but only
// where the next non-separator run starts a fresh `key:` pair (or the string
// ends). The lookahead lets a separator that sits inside a value (a space or
// comma in `rgb(1, 2, 3)` or `linear-gradient(to right, red, blue)`) stay part
// of that value rather than splitting it. `[\w-]+` so a hyphenated key like
// `icon-size:` is recognised as the start of a fresh pair.
const STYLE_SPLIT_RE = /(?:\s+|\s*[,;]\s*)(?=$|[\w-]+\s*:)/;
// Breaks a props string into its `key:value` segments, dropping the empty
// pieces a leading/trailing separator would leave behind.
function splitStyleProps(props: string): string[] {
  return props.trim().split(STYLE_SPLIT_RE).filter(Boolean);
}
// Classes appended to an entity declaration: `actor Name:::a b`.
const INLINE_CLASS_SEP = /\s*:::\s*/;

// A quoted label on an entity declaration: `actor a "Alice"`. Double quotes fence
// the drawn caption, so the bareword(s) around it stay the reference name (and any
// trailing direction token for a region/port). The label runs until the next
// unescaped quote; `\"` and `\\` escape a literal quote/backslash inside it.
const LABEL_RE = /"((?:[^"\\]|\\.)*)"/;
// Splits an entity's argument string into its optional quoted label and the rest
// (the reference name plus any trailing direction token), with the label removed.
// Returns `label: undefined` when no quoted label is present, so the caller can
// tell "no label given" (default caption) from an explicit empty `""` (no caption).
function extractLabel(rest: string): { label?: string; rest: string } {
  const m = LABEL_RE.exec(rest);
  if (!m) return { rest };
  const label = m[1].replace(/\\(["\\])/g, '$1');
  const remainder = (rest.slice(0, m.index) + ' ' + rest.slice(m.index + m[0].length))
    .replace(/\s+/g, ' ')
    .trim();
  return { label, rest: remainder };
}

// Lines connect two entities by name. A connector is a run of one or more
// dashes carrying an optional direction: a leading `<` points at the first
// entity (`<--`), a trailing `>` at the second (`-->`), neither is plain
// (`---`). The dash run may be any length (`-`, `-->`, `<--------`), but `<`
// only ever leads and `>` only ever trails, so broken arrows like `-<` or `>-`
// (and the combined `<-->`) don't match. Whitespace must flank the connector so
// it never eats a hyphen from an entity name.
const ARROW = String.raw`(<-+|-+>|-+)`;

// Collapses a matched connector of any length to its canonical LineType.
function arrowType(arrow: string): LineType {
  if (arrow.startsWith('<')) return '<--';
  if (arrow.endsWith('>')) return '-->';
  return '---';
}

// Either endpoint may be omitted, and the enclosing entity fills the empty slot
// — a LEADING line drops the first entity (`--> B`, source = enclosing), a
// TRAILING line drops the second (`A -->`, target = enclosing). An ABSOLUTE line
// names both and may sit anywhere, regardless of nesting. Whitespace is REQUIRED
// between an arrow and an adjacent entity (`\s+`), so a hyphen inside a name
// (`foo-bar`) is never mistaken for a connector.
const LEAD_LINE_RE = new RegExp(String.raw`^${ARROW}\s+(\S.*)$`);
const TRAIL_LINE_RE = new RegExp(String.raw`^(\S.*?)\s+${ARROW}\s*$`);
const ABS_LINE_RE = new RegExp(String.raw`^(\S.*?)\s+${ARROW}\s+(\S.*)$`);

// A connector glyph resolved to the entity it stands for: its subtype and, for a
// `request`, the inner-arrow direction (undefined = auto). `raw` keeps the source
// text so a glyph sitting at a chain ENDPOINT can fall back to a literal name.
interface GlyphMatch {
  subtype: EntitySubtype;
  dir?: Side | 'back';
  raw: string;
}

// Recognises a connector glyph at position `j` of `s`, case-insensitively, or
// returns null. The glyphs: `o` (channel), `|` (pipe), `q` (queue), and `r`
// (request) — the request optionally carrying a one-character orientation from
// `nesw<>?` (`r`, `rn`, `r<`, `r?`, …), plus the alias `<r` for a `back` request.
// `end` is the index just past the matched glyph; the caller checks it lands on a
// real boundary so a name like `router` is not read as the glyph `r` + `outer`.
function matchGlyph(s: string, j: number): { end: number; glyph: GlyphMatch } | null {
  const c0 = s[j];
  const lc0 = c0.toLowerCase();
  if (c0 === '|') return { end: j + 1, glyph: { subtype: 'pipe', raw: c0 } };
  if (lc0 === 'o') return { end: j + 1, glyph: { subtype: 'channel', raw: c0 } };
  if (lc0 === 'q') return { end: j + 1, glyph: { subtype: 'queue', raw: c0 } };
  if (lc0 === 'r') {
    // `r` optionally followed by a single orientation char (n/e/s/w/</>/?).
    const next = s[j + 1];
    const o = next !== undefined ? parseOrientation(next) : null;
    if (o !== null) {
      return {
        end: j + 2,
        glyph: { subtype: 'request', dir: o === 'auto' ? undefined : o, raw: s.slice(j, j + 2) },
      };
    }
    return { end: j + 1, glyph: { subtype: 'request', raw: c0 } };
  }
  // `<r` — a leading `<` (the `back` alias) before the request glyph.
  if (c0 === '<' && s[j + 1] !== undefined && s[j + 1].toLowerCase() === 'r') {
    return { end: j + 2, glyph: { subtype: 'request', dir: 'back', raw: s.slice(j, j + 2) } };
  }
  return null;
}

// A complex line is a chain of any length — `node arrow node arrow node …` —
// threaded through a mix of named entities and connector glyphs (`o`/`|`/`q`/`r`;
// see matchGlyph). It is tokenised by scanChain rather than a fixed regex, since
// the number of segments is unbounded; a chain with two or more arrows is treated
// as complex, while a single-arrow line falls through to the plain-line patterns
// below.
//
// A scanned node is a name, a connector glyph, or empty (an omitted endpoint of
// a relative line, only ever first or last). Whitespace between an arrow and a
// NAME is required (as for plain lines, so a hyphen inside a name is never eaten
// as a connector), but the whitespace flanking a connector GLYPH stays OPTIONAL
// — `A -->o--> B` reads the same as `A --> o --> B` — since the glyph and arrows
// are pure syntax with no name for a stray dash to eat into.
type ScanNode =
  | { kind: 'empty' }
  | { kind: 'glyph'; glyph: GlyphMatch }
  | { kind: 'name'; name: string };

const ARROW_AT_RE = new RegExp(String.raw`^${ARROW}`);

// Tokenises a line into alternating nodes and arrows, or returns null when it is
// not a well-formed chain (so the caller falls through to plain-line parsing).
function scanChain(s: string): { nodes: ScanNode[]; arrows: LineType[] } | null {
  const N = s.length;
  const isWs = (c: string): boolean => c === ' ' || c === '\t';
  const isArrowChar = (c: string): boolean => c === '<' || c === '-' || c === '>';
  const arrowAt = (i: number): { type: LineType; end: number } | null => {
    const m = ARROW_AT_RE.exec(s.slice(i));
    return m ? { type: arrowType(m[1]), end: i + m[1].length } : null;
  };
  // A valid right boundary for an arrow: end of string, whitespace, or a glyph
  // that may hug it (see matchGlyph) — never a glued name character. Delegating to
  // matchGlyph keeps this in step with every glyph, including multi-char ones like
  // `rn` and `<r`, and — since `<` alone is not a glyph — still rejects `A <--> B`.
  const arrowBoundary = (end: number): boolean =>
    end >= N || isWs(s[end]) || matchGlyph(s, end) !== null;

  // Reads one node from `i` (skipping leading whitespace) and reports where the
  // next arrow begins (or N). An arrow encountered immediately is an omitted
  // (empty) node and is left unconsumed for the caller.
  const readNode = (i: number): { node: ScanNode; next: number } => {
    let j = i;
    while (j < N && isWs(s[j])) j++;
    if (j >= N) return { node: { kind: 'empty' }, next: N };
    if (isArrowChar(s[j]) && arrowAt(j)) return { node: { kind: 'empty' }, next: j };
    // A lone glyph (see matchGlyph), bounded on the right by end, whitespace, or
    // an arrow char — so `router` is read as a name, not the glyph `r` glued to a
    // name it can't eat into.
    const g = matchGlyph(s, j);
    if (g && (g.end >= N || isWs(s[g.end]) || isArrowChar(s[g.end]))) {
      return { node: { kind: 'glyph', glyph: g.glyph }, next: g.end };
    }
    // Otherwise a name, running to the next whitespace-flanked arrow (or end).
    for (let k = j; k < N; k++) {
      if (!isWs(s[k])) continue;
      let p = k;
      while (p < N && isWs(s[p])) p++;
      const ar = arrowAt(p);
      if (ar && arrowBoundary(ar.end)) return { node: { kind: 'name', name: s.slice(j, k) }, next: p };
    }
    return { node: { kind: 'name', name: s.slice(j).trimEnd() }, next: N };
  };

  const nodes: ScanNode[] = [];
  const arrows: LineType[] = [];
  let cur = readNode(0);
  nodes.push(cur.node);
  let i = cur.next;
  while (i < N) {
    while (i < N && isWs(s[i])) i++;
    if (i >= N) break;
    const ar = arrowAt(i);
    if (!ar || !arrowBoundary(ar.end)) return null;
    arrows.push(ar.type);
    cur = readNode(ar.end);
    nodes.push(cur.node);
    i = cur.next;
  }
  return { nodes, arrows };
}

// Parses an `icon-size` value into a numeric factor of the line height (1 = one
// line height). `auto`/`?` mean "size from context" and are stored as 0 (which,
// like undefined, reads as auto). `s`/`m`/`l` are 1/2/3, and each leading `x` on
// `l` adds one (`xl`=4, `xxl`=5, …); a bare number (`1.5`, `.7`) is taken verbatim.
// Anything else is dropped with a warning (returns undefined), like a bad route key.
function parseIconSize(value: string): number | undefined {
  const v = value.toLowerCase();
  if (v === 'auto' || v === '?') return 0;
  if (v === 's') return 1;
  if (v === 'm') return 2;
  const xl = /^(x*)l$/.exec(v);
  if (xl) return 3 + xl[1].length;
  if (/^\d*\.?\d+$/.test(v)) return parseFloat(v);
  console.warn(
    `fmc: ignoring icon-size:${value} (expected auto/?, s/m/l with leading x's, or a number)`,
  );
  return undefined;
}

// Reads `key:value` tokens into a StyleProps, mapping each DSL key to its field.
// Color/icon values pass through verbatim; `icon-size` is parsed to a number.
// Tokens that aren't a known `key:value` are skipped; returns null when no valid
// prop was found, so callers can tell a real props run from e.g. a stray word.
function parseProps(tokens: string[]): StyleProps | null {
  const style: StyleProps = {};
  let found = false;
  for (const token of tokens) {
    const m = PROP_RE.exec(token);
    if (!m) continue;
    const field = STYLE_PROP_KEYS.get(m[1].toLowerCase());
    if (!field) continue; // unreachable: PROP_RE is built from the same keys
    const value = m[2].trim();
    if (field === 'iconSize') {
      const factor = parseIconSize(value);
      if (factor === undefined) continue; // invalid value already warned
      style.iconSize = factor;
    } else {
      style[field] = value;
    }
    found = true;
  }
  return found ? style : null;
}

// Splits `style …`'s remainder into a (possibly multi-word) name and a trailing
// run of style props: props are peeled off the end while they parse, and the
// rest is the name. An empty name means the bare, self-targeting form.
function splitNameAndProps(rest: string): { name: string; style: StyleProps } | null {
  const segments = splitStyleProps(rest);
  const propSegments: string[] = [];
  while (segments.length > 0 && PROP_RE.test(segments[segments.length - 1])) {
    propSegments.unshift(segments.pop() as string);
  }
  const style = parseProps(propSegments);
  if (!style) return null; // no trailing props -> not a style statement
  return { name: segments.join(' '), style };
}

// Anything a bare `style` can attach to carries an optional `style` bag; this
// merges new props in, later values winning per property.
interface Styleable {
  style?: StyleProps;
}
function applyStyle(target: Styleable, props: StyleProps): void {
  target.style = { ...(target.style ?? {}), ...props };
}

// Anything a `route` statement can attach to (a line or complex-line spec)
// carries an optional routing bag; this merges new keys in, later values winning.
interface Routable {
  routing?: RouteSpec;
}
function applyRoute(target: Routable, spec: RouteSpec): void {
  target.routing = { ...(target.routing ?? {}), ...spec };
}

// Route `exit`/`enter` sides accept the single-letter compass form and the full word.
const ROUTE_SIDES: ReadonlyMap<string, Side> = new Map<string, Side>([
  ['n', 'n'],
  ['north', 'n'],
  ['e', 'e'],
  ['east', 'e'],
  ['s', 's'],
  ['south', 's'],
  ['w', 'w'],
  ['west', 'w'],
]);

// A `request`'s optional trailing orientation token: a compass side (single
// letter or full word, case-insensitive) for a fixed arrow direction; `auto`,
// `?`, or `>` for "follow the container flow"; or `back`, `<` for the opposite
// of the flow. Returns the resolved side, the literal `'auto'`/`'back'`, or null
// when the token is not an orientation at all (so the caller keeps it as part of
// the name).
function parseOrientation(token: string): Side | 'auto' | 'back' | null {
  const v = token.toLowerCase();
  if (v === 'auto' || v === '?' || v === '>') return 'auto';
  if (v === 'back' || v === '<') return 'back';
  return ROUTE_SIDES.get(v) ?? null;
}

// Parses a `route`'s props (`exit:s enter:n depth:2 bend:z`) into a validated RouteSpec,
// splitting on the same separators as style props. Each key has its own small
// vocabulary; an unknown key, or a value outside its vocabulary, is dropped with
// a warning (mirroring how unknown style props are ignored) rather than failing
// the parse. Returns null when nothing valid was found, so the caller can fall
// through to line parsing (e.g. a line from an entity literally named "route").
function parseRoute(rest: string): RouteSpec | null {
  const spec: RouteSpec = {};
  let found = false;
  for (const token of splitStyleProps(rest)) {
    const colon = token.indexOf(':');
    // Keys and values are case-insensitive, so normalise both to lower case;
    // `?` is an alias for `auto` wherever `auto` is accepted.
    const key = (colon < 0 ? token : token.slice(0, colon)).toLowerCase();
    const value = (colon < 0 ? '' : token.slice(colon + 1)).trim().toLowerCase();
    switch (key) {
      case 'exit': {
        const side = ROUTE_SIDES.get(value);
        if (value === 'auto' || value === '?') {
          spec.exit = 'auto';
          found = true;
        } else if (side) {
          spec.exit = side;
          found = true;
        } else {
          console.warn(`fmc: ignoring route exit:${value} (expected n/e/s/w, a compass word, or auto)`);
        }
        break;
      }
      case 'enter': {
        const side = ROUTE_SIDES.get(value);
        if (value === 'auto' || value === '?') {
          spec.enter = 'auto';
          found = true;
        } else if (side) {
          spec.enter = side;
          found = true;
        } else {
          console.warn(`fmc: ignoring route enter:${value} (expected n/e/s/w, a compass word, or auto)`);
        }
        break;
      }
      case 'depth': {
        if (value === 'auto' || value === '?') {
          spec.depth = 'auto';
          found = true;
          break;
        }
        const n = Number(value);
        if (Number.isInteger(n) && n >= 0) {
          spec.depth = n;
          found = true;
        } else {
          console.warn(`fmc: ignoring route depth:${value} (expected an integer >= 0 or auto)`);
        }
        break;
      }
      case 'bend':
        // `hvh`/`vhv` are spelled-out aliases for `z`/`n`; `?` for `auto`.
        if (value === 'z' || value === 'hvh') {
          spec.bend = 'z';
          found = true;
        } else if (value === 'n' || value === 'vhv') {
          spec.bend = 'n';
          found = true;
        } else if (value === 'auto' || value === '?') {
          spec.bend = 'auto';
          found = true;
        } else {
          console.warn(`fmc: ignoring route bend:${value} (expected z/hvh, n/vhv, or auto)`);
        }
        break;
      default:
        console.warn(`fmc: ignoring unknown route key "${token}"`);
    }
  }
  return found ? spec : null;
}

// Accepts Mermaid's canonical tokens plus friendly aliases. Returns null for
// anything unrecognized so callers can decide how loudly to fail.
function normalizeDirection(token: string): Direction | null {
  switch (token.toLowerCase()) {
    case 'tb':
    case 'td':
    case 'vertical':
      return 'TB';
    case 'bt':
      return 'BT';
    case 'lr':
    case 'horizontal':
      return 'LR';
    case 'rl':
      return 'RL';
    default:
      return null;
  }
}

interface Frame {
  indent: number;
  // The container these lines nest under. The root frame's entity is the diagram
  // root, so every frame has one — "diagram scope" is just the outermost entity.
  entity: Entity;
  // What a bare `style` nested directly here applies to: the enclosing entity,
  // or a line/complex-line when the frame was pushed for one. A line frame keeps
  // `entity` pointing at the line's own enclosing container, so deeper nesting
  // and relative-line resolution are unchanged.
  styleTarget?: Styleable;
  // What a `route` nested directly under a LINE applies to: the line/complex-line
  // itself. Only line frames set this.
  routeTarget?: Routable;
  // A `route` nested directly under an ENTITY (the diagram root included) sets a
  // default applied to every line anywhere in that subtree (`entityLines`) when
  // the frame is popped/flushed. A line's own `route`, and any closer entity's
  // (the root's being outermost of all), win per key — frames flush deepest-first
  // and the default is merged UNDER what's there.
  entityRoute?: RouteSpec;
  entityLines?: Routable[];
}

export const parser = {
  parse(text: string): void {
    db.clear();

    // The root frame: indent -1 is shallower than any real line, and its entity is
    // the diagram root. Diagram-scoped statements (bare `style`, `route`,
    // `direction`) then attach to it exactly like they would to any entity.
    const root = db.getRoot();
    const stack: Frame[] = [{ indent: -1, entity: root, styleTarget: root }];

    // Complex lines are collected and expanded after the tree is fully built,
    // since placing their connector needs the whole ancestry (and, for absolute
    // lines, entities that may be declared further down).
    const complexSpecs: ComplexLineSpec[] = [];

    // Popping an entity frame is where its entity-wide `route` (if any) lands on
    // the lines anywhere in its subtree. The default is merged UNDER whatever the
    // line already carries, so a line's own `route` — and any closer entity's,
    // which flushed earlier (deeper frames pop first) — wins per key.
    const flushFrame = (frame: Frame): void => {
      if (!frame.entityRoute || !frame.entityLines) return;
      for (const target of frame.entityLines) {
        target.routing = { ...frame.entityRoute, ...(target.routing ?? {}) };
      }
    };

    for (const raw of text.split(/\r?\n/)) {
      const indent = raw.length - raw.trimStart().length;
      const line = raw.trim();

      // Skip blanks and comments.
      if (line === '' || line.startsWith('%%') || line.startsWith('#')) {
        continue;
      }

      // The `fmc` header sits at the root and may carry a diagram direction,
      // mirroring flowchart's `flowchart LR`. It never nests entities itself.
      const header = HEADER_RE.exec(line);
      if (header) {
        if (header[1]) {
          const dir = normalizeDirection(header[1]);
          if (dir) db.setDirection(dir);
        }
        continue;
      }

      // Pop frames until the top is strictly shallower than this line; that
      // frame is our enclosing container. Flush each popped frame so an entity's
      // `route` reaches the lines in its subtree.
      while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
        flushFrame(stack.pop() as Frame);
      }
      const parent = stack[stack.length - 1].entity;

      const entity = ENTITY_RE.exec(line);
      if (entity) {
        const subtype = entity[1] as EntitySubtype;
        // A marker glued to the keyword marks multiplicity. `*` (a shadow box) is
        // only meaningful on the full-box families; `...` (corner dots, plus a
        // shadow on those same families) is allowed on every subtype but `port`.
        const marker = entity[2];
        const multiplicity = marker === '*' ? 'star' : marker === '...' ? 'dots' : undefined;
        if (marker === '*' && !MULTIPLICITY_SUBTYPES.has(subtype)) {
          throw new Error(`fmc: a ${subtype} cannot carry a "*" marker (found "${line}")`);
        }
        if (marker === '...' && subtype === 'port') {
          throw new Error(`fmc: a port cannot carry a "..." marker (found "${line}")`);
        }
        // A trailing `:::class …` on the declaration peels off as inline classes.
        const [rawName, classPart] = (entity[3] ?? '').split(INLINE_CLASS_SEP, 2);
        // A quoted `"label"` is the drawn caption; peel it off first so what
        // remains is just the reference name (plus any trailing direction token).
        const { label, rest: nameRest } = extractLabel((rawName ?? '').trim());
        let name = nameRest;
        const classes = classPart ? classPart.trim().split(/\s+/) : [];

        // A region takes an optional inline layout direction as its last token
        // (`region LR`, `region My Group LR`); whatever precedes it is the name.
        // Only regions do this — an actor named "A LR" keeps its whole name.
        let inlineDir: Direction | null = null;
        if (subtype === 'region' && name) {
          const tokens = name.split(/\s+/);
          const dir = normalizeDirection(tokens[tokens.length - 1]);
          if (dir) {
            inlineDir = dir;
            name = tokens.slice(0, -1).join(' ');
          }
        }

        // A port pins to one edge of its parent container: its syntax is
        // `port <optional name> <direction>`, the direction being a REQUIRED
        // trailing compass side (`n`/`north`/… , case-insensitive). It never
        // stands alone at the diagram root — there is no container edge to pin to.
        let portSide: Side | undefined;
        if (subtype === 'port') {
          if (label !== undefined) {
            throw new Error(`fmc: a port cannot have a label (found "${line}")`);
          }
          if (parent === root) {
            throw new Error(`fmc: a port cannot be declared at the diagram root (found "${line}")`);
          }
          const tokens = name ? name.split(/\s+/) : [];
          const side = tokens.length
            ? ROUTE_SIDES.get(tokens[tokens.length - 1].toLowerCase())
            : undefined;
          if (!side) {
            throw new Error(
              `fmc: a port needs a trailing direction (n/e/s/w or a compass word) (found "${line}")`,
            );
          }
          portSide = side;
          name = tokens.slice(0, -1).join(' ');
        }

        // A request carries an OPTIONAL trailing orientation for its inner arrow:
        // `request <optional name> <optional dir>`, the direction being a compass
        // side/word, `auto`/`?`/`>`, or `back`/`<`. It is resolved off the end of
        // the name tokens, and — since it is optional — the rule is "when the last
        // token reads as an orientation, it IS the orientation" (so `request wild
        // wild west` is name "wild wild" pointing west); a last token that is not
        // an orientation stays part of the name and the arrow defaults to auto. An
        // explicit `auto`/`?`/`>` is stored as undefined, same as omitting it.
        let requestDir: Side | 'back' | undefined;
        if (subtype === 'request' && name) {
          const tokens = name.split(/\s+/);
          const dir = parseOrientation(tokens[tokens.length - 1]);
          if (dir) {
            if (dir !== 'auto') requestDir = dir;
            name = tokens.slice(0, -1).join(' ');
          }
        }

        // Connectors (channel, pipe), ports, and queues are leaves: rejecting a
        // nested child here gives a clear error rather than silently drawing
        // something invalid. (The root is a region, so it never trips this.)
        if (CHILDLESS_SUBTYPES.has(parent.subtype)) {
          throw new Error(
            `fmc: a ${parent.subtype} cannot contain nested entities (found "${line}")`,
          );
        }

        const node = db.addEntity(name, subtype, parent);
        if (label !== undefined) node.label = label;
        if (classes.length > 0) node.classes = classes;
        if (inlineDir) node.direction = inlineDir;
        if (portSide) node.portSide = portSide;
        if (requestDir) node.requestDir = requestDir;
        if (multiplicity) node.multiplicity = multiplicity;
        stack.push({ indent, entity: node, styleTarget: node });
        continue;
      }

      // `debug ports` toggles the port overlay. It only makes sense at the
      // diagram root (directly under `fmc`); nested it is dropped with a warning.
      if (DEBUG_PORTS_RE.test(line)) {
        if (parent !== root) {
          console.warn(`fmc: "debug ports" is only allowed at the diagram root ("${line}")`);
        } else {
          db.setDebugPorts(true);
        }
        continue;
      }

      const direction = DIRECTION_RE.exec(line);
      if (direction) {
        const dir = normalizeDirection(direction[1]);
        // A `direction` statement applies to the container it is nested in
        // (parent), or the diagram default when at the top level.
        if (dir) db.setDirection(dir, parent);
        continue;
      }

      // `classDef <name> <props>` — a reusable named style bag.
      const classDef = CLASSDEF_RE.exec(line);
      if (classDef) {
        const props = parseProps(splitStyleProps(classDef[2]));
        if (props) {
          db.addClassDef(classDef[1], props);
          continue;
        }
      }

      // `class <names> <class>` — attach one class to comma-separated names.
      const classStmt = CLASS_RE.exec(line);
      if (classStmt) {
        const targets = classStmt[1].split(',').map((s) => s.trim()).filter(Boolean);
        for (const target of targets) db.addNamedClasses(target, [classStmt[2]]);
        continue;
      }

      // `style …` — by name (`style <name> <props>`) or, with no name, the
      // entity/line this statement is nested under.
      const styleStmt = STYLE_RE.exec(line);
      if (styleStmt) {
        const parsed = splitNameAndProps(styleStmt[1]);
        if (parsed) {
          if (parsed.name) {
            db.addNamedStyle(parsed.name, parsed.style);
          } else {
            // A bare `style` attaches to the entity or line it is nested under —
            // the top frame's styleTarget. At the diagram root that target is the
            // root entity, so a root-level bare `style` sets the diagram-wide
            // default with no special case (every frame carries a styleTarget).
            const target = stack[stack.length - 1].styleTarget;
            if (target) applyStyle(target, parsed.style);
          }
          continue;
        }
        // No trailing props: not a style statement — fall through to line parsing
        // (e.g. a line whose first endpoint is literally named "style").
      }

      // `route <props>` — layout hints. Nested directly under a line it tunes that
      // one line; nested directly under an entity it sets a default for every line
      // declared in that entity; at the diagram root it sets a diagram-wide default
      // for every line (both applied on flush, see flushFrame). Parsed before line
      // patterns so it isn't mistaken for a line; if it doesn't parse to any valid
      // key it falls through (a line from an entity named "route").
      const routeStmt = ROUTE_RE.exec(line);
      if (routeStmt) {
        const spec = parseRoute(routeStmt[1]);
        if (spec) {
          const frame = stack[stack.length - 1];
          if (frame.routeTarget) {
            // A `route` nested under a line tunes that one line.
            applyRoute(frame.routeTarget, spec);
          } else {
            // Otherwise the top frame is an entity (the diagram root included), so
            // it sets a subtree-wide — or, at the root, diagram-wide — default.
            frame.entityRoute = { ...(frame.entityRoute ?? {}), ...spec };
          }
          continue;
        }
        // No valid route key: fall through to line parsing.
      }

      // A line that omits an endpoint borrows the enclosing entity for it, so it
      // has to be nested inside a real entity — the root (a structural region) is
      // not a valid endpoint.
      const enclosing = (): Entity => {
        if (parent === root) {
          throw new Error(`fmc: a relative line ("${line}") needs an enclosing entity`);
        }
        return parent;
      };

      // Each line pushes a frame so a `style` nested under it can attach: the
      // frame keeps `entity` at the line's own enclosing container (so relative
      // resolution and deeper nesting are unchanged) and points `styleTarget` at
      // the line/spec. A relative line records its enclosing container so it can
      // inherit that container's stroke; an absolute line records none and later
      // inherits from its endpoints' common ancestor. The line is also registered
      // with every ancestor entity frame so an entity-wide `route` anywhere above
      // reaches it; frames flush deepest-first, so a closer entity's route wins.
      const pushLineFrame = (target: Styleable & Routable): void => {
        // Register the line with every enclosing frame so an entity-wide `route`
        // — or the diagram-wide one on the root frame — reaches it on flush. Line
        // frames never carry an entityRoute, so registering with them is inert.
        for (const frame of stack) (frame.entityLines ??= []).push(target);
        stack.push({ indent, entity: parent, styleTarget: target, routeTarget: target });
      };

      // Complex lines are chains of two or more arrows, threaded through named
      // entities and/or connector glyphs. They must be matched before the
      // plain-line patterns, whose greedy tail would otherwise swallow later
      // arrows as part of an entity name. A single-arrow line, or one that does
      // not tokenise cleanly, falls through to the plain-line trio below.
      const chain = scanChain(line);
      if (chain && chain.arrows.length >= 2) {
        const last = chain.nodes.length - 1;
        // An empty node is an omitted endpoint (relative line); it may only sit
        // at an end. An interior empty means malformed input — not a complex
        // line, so fall through rather than error.
        const interiorEmpty = chain.nodes.some(
          (n, i) => n.kind === 'empty' && i !== 0 && i !== last,
        );
        if (!interiorEmpty) {
          const relative = chain.nodes[0].kind === 'empty' || chain.nodes[last].kind === 'empty';
          // A connector glyph is a connector only in an interior position; at an
          // endpoint a glyph is a literal entity name (its raw source text).
          const toNode = (n: ScanNode, i: number): ChainNode => {
            if (n.kind === 'empty') return { entity: enclosing() };
            if (n.kind === 'glyph' && i !== 0 && i !== last) {
              const node: ChainNode = { connector: n.glyph.subtype };
              if (n.glyph.subtype === 'request' && n.glyph.dir !== undefined) {
                node.requestDir = n.glyph.dir;
              }
              return node;
            }
            return { entity: n.kind === 'glyph' ? n.glyph.raw : n.name };
          };
          const spec: ComplexLineSpec = {
            nodes: chain.nodes.map(toNode),
            arrows: chain.arrows,
          };
          // A relative chain inherits its enclosing container's stroke; an
          // absolute one falls back to the endpoints' common ancestor.
          if (relative) spec.container = parent;
          complexSpecs.push(spec);
          pushLineFrame(spec);
          continue;
        }
      }

      // Plain lines, in the same leading / trailing / absolute trio.
      const leadLine = LEAD_LINE_RE.exec(line);
      if (leadLine) {
        pushLineFrame(
          db.addLine(enclosing(), leadLine[2].trim(), arrowType(leadLine[1]), parent),
        );
        continue;
      }

      const trailLine = TRAIL_LINE_RE.exec(line);
      if (trailLine) {
        pushLineFrame(
          db.addLine(trailLine[1].trim(), enclosing(), arrowType(trailLine[2]), parent),
        );
        continue;
      }

      const absLine = ABS_LINE_RE.exec(line);
      if (absLine) {
        pushLineFrame(
          db.addLine(absLine[1].trim(), absLine[3].trim(), arrowType(absLine[2])),
        );
        continue;
      }

      // Unknown line: ignore for now. A stricter mode can throw here later.
    }

    // Flush any frames still open at EOF (deepest first) so their entity-wide
    // routes land — including on complex-line specs, whose routing must be set
    // before expansion propagates it onto the generated segments below. The root
    // frame is flushed last (it is never popped), so a diagram-wide `route` is
    // merged UNDER everything a closer frame already set.
    while (stack.length > 1) flushFrame(stack.pop() as Frame);
    flushFrame(stack[0]);

    // Tree is complete: insert each complex line's connector and record the two
    // simple lines that wire it up, carrying over any stroke/container the
    // complex line's own `style` set on its segments.
    for (const generated of expandComplexLines(db.getEntities(), complexSpecs)) {
      const line = db.addLine(
        generated.source,
        generated.target,
        generated.type,
        generated.container ?? null,
      );
      if (generated.style) line.style = generated.style;
      if (generated.routing) line.routing = generated.routing;
    }
  },
};
