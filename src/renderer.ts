import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js';
import {
  CONNECTOR_SUBTYPES,
  SUBTYPE_TYPE,
  type Direction,
  type Entity,
  type EntitySubtype,
  type Line,
  MULTIPLICITY_SUBTYPES,
  type MultiplicityKind,
  type Side,
  db,
  entityLabel,
} from './db.js';
import { type PortValidation, analysePorts } from './portTypes.js';
import {
  type Rect,
  capInset,
  childHalfExtent,
  commonAncestorId,
  partitionRegions,
  regionsStackVertically,
} from './geometry.js';
import {
  type Anchor,
  type ArrowEnd,
  type ChainPlan,
  type JoinPlan,
  type PortSpec,
  planRoute,
  subtreeDirectionsUniform,
} from './routePlan.js';
import { type Resolved, resolveStyles } from './styleModel.js';
import { type IconSvg, resolveIcons } from './icons.js';
import { renderTheme } from './theme.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Layout tuning. Leaf boxes size to their label; containers reserve a band at
// the top for their own label above their children.
const LEAF_MIN_W = 80;
const LEAF_H = 44; // the "default actor height" the other shapes derive from
const LABEL_PAD_X = 20; // horizontal breathing room around a leaf label
const CONTAINER_LABEL_BAND = 30; // top padding reserved for a container's label
const CONTAINER_PAD = 12; // left/right/bottom padding inside a container
const NODE_SPACING = 24; // gap between sibling boxes

// A multiplicity marker signals several instances with content offset diagonally
// past the entity's bottom-right corner (down and to the right): a same-size,
// same-color "shadow" box on the shadow families, and/or a three-dot ellipsis.
// The entity's own box keeps its size, so edges and ports still attach to its
// true border; the protruding footprint is reserved during layout by two
// invisible OUTSIDE node labels (see shadowReservation) so neighbours clear it
// and it is never clipped at the diagram edge. `*` uses a smaller offset than the
// dots of `...`; a region's dots are double-size (see multiplicityDots) so they
// take a doubled offset to sit clear of its (large) box.
const MULTIPLICITY_SHADOW_STAR = LEAF_H / 6;
const MULTIPLICITY_SHADOW_DOTS = LEAF_H / 3;
function multiplicityOffset(kind: MultiplicityKind, subtype: EntitySubtype): number {
  if (kind === 'star') return MULTIPLICITY_SHADOW_STAR;
  return subtype === 'region' ? MULTIPLICITY_SHADOW_DOTS * 2 : MULTIPLICITY_SHADOW_DOTS;
}

// The `...` marker's three dots are evenly spaced along the 45° diagonal off the
// bottom-right corner (an "and more" ellipsis). The nearest dot is pulled far
// enough in from the (virtual, offset) corner to clear a rounded shape's cap (see
// multiplicityDots).
const ELLIPSIS_DOT_R = 1.5; // dot radius (px)
const ELLIPSIS_GAP = 4; // between dot centres along the diagonal (px, per axis)
const ELLIPSIS_PAD = 2; // clearance between a dot and the shape edge

// Connector geometry, all derived from the default actor height. A channel is a
// square storage box; full corner-rounding (rx = half the side) makes it a
// circle, so it needs no special-cased shape.
const CHANNEL_D = LEAF_H / 3; // channel diameter (square side); shared by `request`
// A `request` draws a channel circle with a direction arrow inside it. The arrow
// is a triangle sized to sit clear of the ~14.7px circle rim, so its back corners
// (its widest points) don't touch the outline. `REQUEST_ARROW_NOTCH` bows the
// back edge inward, matching the standalone arrowheads. It is nudged
// `REQUEST_ARROW_OFFSET` px toward the tip: bounding-box-centred, the wide back
// crowds the rim while the single tip has room to spare, so a small shift toward
// the tip reads as better centred.
const REQUEST_ARROW_L = 10; // length, tip to back
const REQUEST_ARROW_H = 7; // full height across the back
const REQUEST_ARROW_NOTCH = REQUEST_ARROW_H * 0.28;
const REQUEST_ARROW_OFFSET = 0.5;
// The rotation (degrees, SVG clockwise with y pointing down) that turns an
// east-pointing arrow to face each compass side.
const REQUEST_ARROW_ANGLE: Record<Side, number> = { e: 0, s: 90, w: 180, n: 270 };
// The arrow direction `auto` resolves to from the container's flow: it follows
// the flow downstream — TB points south, BT north, LR east, RL west. `back`
// resolves to the opposite (upstream).
const AUTO_ARROW_SIDE: Record<Direction, Side> = { TB: 's', BT: 'n', LR: 'e', RL: 'w' };
const OPPOSITE_SIDE: Record<Side, Side> = { n: 's', s: 'n', e: 'w', w: 'e' };

// Resolves a request's stored direction to a concrete compass side, given the
// flow direction it sits in: a fixed side is used as-is, `back` is the flow's
// opposite, and undefined (auto) is downstream of the flow.
function requestArrowSide(dir: Side | 'back' | undefined, flow: Direction): Side {
  if (dir === undefined) return AUTO_ARROW_SIDE[flow];
  if (dir === 'back') return OPPOSITE_SIDE[AUTO_ARROW_SIDE[flow]];
  return dir;
}
const PIPE_H = LEAF_H / 2; // pipe height
const PIPE_W = PIPE_H / 3; // pipe width (a third of its own height)
// A queue is a thin, labelled storage bar: its thickness (short side) is a third
// of the default actor height, its long side sizes to the label. It runs along
// the flow axis — horizontal under LR/RL, rotated a quarter turn under TB/BT.
// Its label is drawn one notch smaller than the diagram font (see QUEUE_FONT_SCALE
// / the .fmc-queue-label rule), so it is measured at that size too.
const QUEUE_THICKNESS = LEAF_H / 3;
// A queue's inline icon is sized to the bar's thickness so it sits in the bar with
// the (smaller) label beside it, the whole group turned to run along the bar.
const QUEUE_ICON_SIZE = QUEUE_THICKNESS;
// A queue stays at least three times as long as it is thick, so a short-labelled
// one still reads as a bar rather than a near-square.
const QUEUE_MIN_LONG = QUEUE_THICKNESS * 3;
// Extra CSS class on a queue's label, carrying the reduced font (styles.ts). Used
// both to tag the drawn label and to measure the box at the same size.
const QUEUE_LABEL_CLASS = 'fmc-label fmc-queue-label';

// A connector's caption is drawn beside the glyph (see connectorLabelSpec). The class
// carries the reduced font (styles.ts); the gap sits between glyph and caption;
// the line height is an approximation used only to reserve vertical space for the
// caption via node margins (the browser has no cheap text-height measure here).
const CONNECTOR_LABEL_CLASS = 'fmc-label fmc-connector-label';
const CONNECTOR_LABEL_GAP = 4;
const CONNECTOR_LABEL_LINE_H = 16;

// Icons (see icons.ts). An inline icon is drawn at one line height, before the
// label; a box with neither label nor children draws its icon alone at twice that
// (an icon-only glyph). `ICON_GAP` sits between an inline icon and its label.
const ICON_SIZE = 18; // one line height — the inline icon size
const ICON_SIZE_LARGE = ICON_SIZE * 2; // the label-less, childless box's big icon
const ICON_GAP = 6;

// A `user` is a childless actor-family box drawn like a UML actor: a stick figure
// (or, given an icon, that icon at double size) above a bottom caption. It is at
// least the default actor height wide and half again as tall, with a bottom band
// reserved for the label; the glyph fills the space above it.
const USER_MIN_W = LEAF_H;
const USER_MIN_H = LEAF_H * 1.5;
const USER_LABEL_BAND = 20;
const USER_GLYPH = ICON_SIZE_LARGE; // stick figure / double-size icon slot

const elk = new ELK();

// Maps our direction vocabulary onto ELK's.
const ELK_DIRECTION: Record<Direction, string> = {
  TB: 'DOWN',
  BT: 'UP',
  LR: 'RIGHT',
  RL: 'LEFT',
};

// Maps a compass side onto ELK's port-side vocabulary.
const ELK_PORT_SIDE: Record<Side, string> = {
  n: 'NORTH',
  e: 'EAST',
  s: 'SOUTH',
  w: 'WEST',
};

// A connector (channel/pipe/request) draws its caption OUTSIDE the glyph, to the
// side; a port never draws one. Everything else draws its caption INSIDE the box —
// centred in a leaf, or in the top label band of a container (a region heading
// included). Whether a caption exists at all is decided per entity by
// `entityLabel`; this only says where a present caption goes.
function isConnector(subtype: EntitySubtype): boolean {
  return subtype === 'channel' || subtype === 'pipe' || subtype === 'request';
}
function drawsInternalLabel(subtype: EntitySubtype): boolean {
  return !isConnector(subtype) && subtype !== 'port';
}

// The CSS class a subtype's caption is drawn with — connectors and queues use a
// reduced font. Used both to measure a label (so its box sizes to the text as
// drawn) and to draw it. The draw pass reads back the same width via labelWidths.
function labelClassFor(subtype: EntitySubtype): string {
  if (isConnector(subtype)) return CONNECTOR_LABEL_CLASS;
  if (subtype === 'queue') return QUEUE_LABEL_CLASS;
  return 'fmc-label';
}

// Every label-capable subtype may carry an `icon:` — i.e. everything but `port`,
// which draws nothing at all. Placement varies by subtype (see drawNode):
// actor/storage/variance/region draw it before the label (or big and alone when a
// label-less, childless box); a `user` draws it double size above its bottom
// caption; a connector draws it beside the glyph in the OUTSIDE label; a `queue`
// draws it inline in the bar, turned with the label.
function canHaveIcon(subtype: EntitySubtype): boolean {
  return subtype !== 'port';
}

// Turns an `icon-size` factor (of the line height, see StyleProps.iconSize) into a
// pixel size. A falsy factor (0/undefined = auto) falls back to `auto`, the size
// the context would use on its own; a positive factor scales the line height.
function iconPx(factor: number | undefined, auto: number): number {
  return factor && factor > 0 ? factor * ICON_SIZE : auto;
}

// Storage-family entities are drawn with rounded corners (radius = half the
// shorter side). For a box that is longer than it is square this produces a
// stadium whose two short edges are semicircular caps eating into the content
// area — which is why storage/variance containers need cap-clearance padding.
function isRounded(subtype: EntitySubtype): boolean {
  return SUBTYPE_TYPE[subtype] === 'storage';
}

function svgEl<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, String(value));
  }
  return node;
}

// Measures rendered label width using a throwaway <text> in the target svg, so
// box sizing matches the actual font/metrics the browser will use. The caller
// must invoke the returned `done()` to remove the probe once measuring is over.
function makeMeasurer(svg: SVGSVGElement): {
  measure: (text: string, className?: string) => number;
  done: () => void;
} {
  const probe = svgEl('text', { class: 'fmc-label', x: -9999, y: -9999 });
  svg.appendChild(probe);
  return {
    // `className` lets a caller measure with a variant label style (a queue's
    // smaller font) so its box sizes to the text as actually drawn.
    measure(text: string, className = 'fmc-label') {
      probe.setAttribute('class', className);
      probe.textContent = text;
      return probe.getComputedTextLength();
    },
    done() {
      probe.remove();
    },
  };
}

// A storage/variance container whose padding we adjust between layout passes to
// clear its stadium caps (see relayoutForStadiums).
interface Stadium {
  node: ElkNode;
  labelHalf: number; // half the rendered label width (matters for the top cap)
  topBand: number; // the top padding the container reserves (label band, or plain pad when unlabelled)
}

// Build-time indexes threaded through the recursive node build. Beyond sizing
// each node they record the maps the connection pass needs: entity -> node id
// (and its inverse for the draw pass), a first-wins name lookup for resolving
// absolute-line endpoints, and the rounded containers needing cap padding.
interface BuildCtx {
  measure: (text: string, className?: string) => number;
  subtypes: Map<string, EntitySubtype>;
  stadiums: Stadium[];
  // Pre-resolved styling per entity (fills, strokes, and the per-node `icon`), so
  // the build pass can size a box to reserve room for its icon.
  resolved: Map<Entity, Resolved>;
  // Rendered caption width per node id, recorded while measuring, so the draw pass
  // can lay out an icon-plus-label group centred without re-measuring.
  labelWidths: Map<string, number>;
  // The top band each container reserves for its heading (caption/icon), by node
  // id — normally CONTAINER_LABEL_BAND, but grown for a large `icon-size`. The draw
  // pass reads it back to centre the heading and keep region fills below it.
  topBandById: Map<string, number>;
  idOf: Map<Entity, string>;
  nodeById: Map<string, ElkNode>;
  entityById: Map<string, Entity>;
  byName: Map<string, Entity>;
  // Effective flow direction each container lays its children out along, by node
  // id. The connection pass reads it to decide whether flattening a subtree with
  // INCLUDE_CHILDREN would clobber a differing direction.
  dirById: Map<string, Direction>;
  // Declared `port` entities, resolved to the ELK port they became: its id, the
  // container node it hangs off, and the edge it pins to. A line whose endpoint is
  // a port connects to `portId` (the edge lives in the LCA of the two containers).
  ports: Map<Entity, { portId: string; containerId: string; side: Side }>;
  // Every declared port's id, so the debug overlay can tint them apart from the
  // (red) routing ports.
  declaredPortIds: Set<string>;
  // The resolved inner-arrow direction of each `request` node, by node id: a fixed
  // `requestDir`, or the side derived from the flow it sits in for auto/back (see
  // requestArrowSide). The draw pass reads it to point the arrow.
  requestArrows: Map<string, Side>;
  // The multiplicity kind of each marked entity, by node id, so the draw pass
  // knows to paint a shadow box behind it (and, for `dots`, a corner ellipsis).
  // The reservation labels are added at build time.
  multiplicity: Map<string, MultiplicityKind>;
}

// The two invisible OUTSIDE node labels that reserve a multiplicity entity's
// shadow footprint (of size `offset`) during layout WITHOUT moving the node's own
// border (which is what keeps every edge and port attaching to the real box).
// elkjs reserves each label's perpendicular gap independently of its along-side
// size, so a right strip (widening the box's east side by the offset) and a
// bottom strip (its south side) between them fold the whole diagonal shadow into
// the graph — the along-side dimension is left 0 since the box's laid-out size is
// unknown here. A single space is used as text (elkjs drops an empty-text label);
// the draw pass never renders these.
function shadowReservation(offset: number): { text: string; width: number; height: number; layoutOptions: Record<string, string> }[] {
  return [
    {
      text: ' ',
      width: offset,
      height: 0,
      layoutOptions: { 'org.eclipse.elk.nodeLabels.placement': 'OUTSIDE H_RIGHT V_CENTER' },
    },
    {
      text: ' ',
      width: 0,
      height: offset,
      layoutOptions: { 'org.eclipse.elk.nodeLabels.placement': 'OUTSIDE H_CENTER V_BOTTOM' },
    },
  ];
}

// One zero-size ELK port, pinned to a side. Shared by declared ports (below) and
// the router's own ports (see applyManualRoute).
interface ElkPortSpec {
  id: string;
  width: number;
  height: number;
  layoutOptions: Record<string, string>;
}

// Builds the ELK ports for an entity's `port` children — zero-size anchors pinned
// (FIXED_SIDE, see attachPorts) to the side each declared, and registered in ctx
// so lines can resolve to them. Shared by the leaf and container branches of
// toElkNode, so an entity whose ONLY children are ports still gets its ports — and
// is built as a leaf box rather than an empty compound node (which ELK collapses
// to zero size). The declaration index is kept in the port id so ordering stays
// stable across mixed port/box children.
function declaredPorts(entity: Entity, id: string, ctx: BuildCtx): ElkPortSpec[] {
  const ports: ElkPortSpec[] = [];
  entity.children.forEach((child, i) => {
    if (child.subtype !== 'port') return;
    const portId = `${id}.port${i}`;
    const side = child.portSide ?? 'n';
    ports.push({ id: portId, width: 0, height: 0, layoutOptions: { 'elk.port.side': ELK_PORT_SIDE[side] } });
    ctx.ports.set(child, { portId, containerId: id, side });
    ctx.declaredPortIds.add(portId);
    // First declaration wins a name, matching the node branch in toElkNode.
    if (child.name && !ctx.byName.has(child.name)) ctx.byName.set(child.name, child);
  });
  return ports;
}

// Pins a built set of ports onto a node (leaf or container) and fixes their sides,
// so consecutive segments meet exactly and each port stays where it was declared.
function attachPorts(node: ElkNode, ports: ElkPortSpec[]): void {
  if (ports.length === 0) return;
  (node as { ports?: unknown[] }).ports = ports;
  ((node.layoutOptions ??= {}) as Record<string, string>)['elk.portConstraints'] = 'FIXED_SIDE';
}

// A leaf entity becomes a fixed-size ELK node; a container becomes a compound
// node whose own layoutOptions carry its children's flow direction. ELK ignores
// `elk.direction` when a node has no edges, so we chain siblings with invisible
// ordering edges — never drawn, and sharing the `edges` array that real FMC
// connections are later appended to. An entity whose only children are `port`s
// counts as a leaf: ports are border anchors, not boxes.
function toElkNode(
  entity: Entity,
  id: string,
  inherited: Direction,
  ctx: BuildCtx,
  atRoot: boolean,
): ElkNode {
  ctx.subtypes.set(id, entity.subtype);
  ctx.idOf.set(entity, id);
  ctx.entityById.set(id, entity);
  // A request's inner arrow points its own fixed way, or resolves against the flow
  // it sits in — auto downstream, back upstream (`inherited` is that container's
  // direction for this leaf).
  if (entity.subtype === 'request') {
    ctx.requestArrows.set(id, requestArrowSide(entity.requestDir, inherited));
  }
  // First declaration wins a name, so absolute lines resolve deterministically.
  if (entity.name && !ctx.byName.has(entity.name)) {
    ctx.byName.set(entity.name, entity);
  }

  // The per-node icon (any label-capable subtype may carry one) and its size
  // factor, threaded into sizing so the box reserves room, and stashed for the draw
  // pass via labelWidths below (measured with the caption's own font so it reads
  // back true).
  const resolvedStyle = canHaveIcon(entity.subtype) ? ctx.resolved.get(entity) : undefined;
  const icon = resolvedStyle?.icon;
  const iconFactor = resolvedStyle?.iconSize;
  const caption = entityLabel(entity);
  if (caption) ctx.labelWidths.set(id, ctx.measure(caption, labelClassFor(entity.subtype)));

  // Declared `port` children become zero-size ELK ports on this node, not child
  // boxes. Build them up front so BOTH a leaf and a container carry them — an
  // entity whose only children are ports is a leaf (below), which would otherwise
  // become an empty compound node and lose both its ports and its size.
  const ports = declaredPorts(entity, id, ctx);
  const hasBoxChildren = entity.children.some((c) => c.subtype !== 'port');

  let node: ElkNode;
  if (!hasBoxChildren) {
    node = { id, ...leafSize(entity, ctx.measure, inherited, icon, iconFactor) };
    attachPorts(node, ports);
  } else {
    const direction = entity.direction ?? inherited;
    ctx.dirById.set(id, direction);
    // Everything but a `port` becomes a child node (the ports were built above).
    // The declaration index is kept in the node id even across skipped ports, so
    // branch ordering stays stable.
    const children: ElkNode[] = [];
    entity.children.forEach((child, i) => {
      if (child.subtype === 'port') return;
      children.push(toElkNode(child, `${id}.${i}`, direction, ctx, false));
    });
    // A region carries no label band or border. A NESTED region also takes no
    // padding, so its children sit exactly where they would without the wrapper
    // (the two forms in the README render identically) and its fill is expanded
    // to the parent's interior at draw time. A ROOT region has no parent to
    // expand into, so it pads around its own children like a normal container —
    // giving a styled root region a visible frame. A captioned container reserves
    // a top label band; an uncaptioned one only needs the plain inner padding.
    const isRegion = entity.subtype === 'region';
    const regionPad = atRoot ? CONTAINER_PAD : 0;
    // A captioned container reserves a top label band; so does an uncaptioned one
    // that carries an icon, which is drawn where the caption would be. (A childless
    // box handles its icon differently — the big icon-only case — but that path is
    // a leaf, so it never reaches here.)
    const wantsBand = !!caption || !!icon;
    // The top band each kind of container reserves. Any container that wants a band
    // (it has a caption or an icon, both drawn where the heading goes) reserves the
    // full label band — grown to clear a large `icon-size` — otherwise a region
    // falls back to its own padding and every other container to the plain inner
    // padding, reserving no room for a heading it won't draw.
    const bandIconPx = icon ? iconPx(iconFactor, ICON_SIZE) : 0;
    const topBand = wantsBand
      ? Math.max(CONTAINER_LABEL_BAND, bandIconPx ? bandIconPx + ICON_GAP * 2 : 0)
      : isRegion
        ? regionPad
        : CONTAINER_PAD;
    ctx.topBandById.set(id, topBand);
    const sidePad = isRegion ? regionPad : CONTAINER_PAD;
    node = {
      id,
      layoutOptions: containerOptions(direction, topBand, sidePad),
      children,
      edges: chainEdges(id, children),
    };
    if (caption) node.labels = [{ text: caption }];
    // Pin any declared ports to this container's sides (like the routing ports do).
    attachPorts(node, ports);
    if (isRounded(entity.subtype)) {
      ctx.stadiums.push({ node, labelHalf: caption ? ctx.measure(caption) / 2 : 0, topBand });
    }
  }

  // Multiplicity: reserve the shadow's footprint (sized to the kind's offset).
  // The caption stays at labels[0] (the draw pass keys off it; an empty one is
  // inert), with the two reservation strips appended. Works for a leaf and a
  // container alike — the border is not touched, so children, edges, and ports
  // are all unaffected.
  if (entity.multiplicity) {
    ctx.multiplicity.set(id, entity.multiplicity);
    // Reserve the marker's protruding footprint (the shadow box on a shadow
    // family, else the outside dots) so neighbours clear it and it never clips at
    // the diagram edge — without moving the node's own border. The two strips are
    // APPENDED to whatever labels the node already carries (a caption, or a
    // connector's own outside-caption spec), keeping the real caption at index 0
    // for the draw pass; an empty caption there is inert (elkjs drops it).
    const head = node.labels && node.labels.length > 0 ? node.labels : [{ text: caption }];
    node.labels = [...head, ...shadowReservation(multiplicityOffset(entity.multiplicity, entity.subtype))];
  }

  ctx.nodeById.set(id, node);
  return node;
}

// The layout footprint a leaf reports to ELK: its box, its caption, and — for a
// captioned connector — the label's own size and placement so ELK reserves room
// for it. A connector label carries width/height and an OUTSIDE placement; every
// other leaf label is text-only (positioned by us at draw time).
interface LeafLabel {
  text: string;
  width?: number;
  height?: number;
  layoutOptions?: Record<string, string>;
}
interface LeafSize {
  width: number;
  height: number;
  labels?: LeafLabel[];
  layoutOptions?: Record<string, string>;
}

// A connector's caption — and its icon, if any — are drawn beside its fixed-size
// glyph, so the box stays glyph-sized (edges still meet the glyph) while their
// footprint is reserved as an ELK OUTSIDE node label. ELK keeps that clear of
// neighbours and folds it into the graph size (plain node margins are ignored by
// elkjs here). The label box goes below the glyph in a horizontal flow (LR/RL) and
// to its right in a vertical one (TB/BT), and holds `[icon] caption` — either part
// optional. Neither caption nor icon means no label, so complex-line connectors are
// unaffected. The laid-out box is read back at draw time (see drawNode).
function connectorLabelSpec(
  caption: string,
  measure: (text: string, className?: string) => number,
  vertical: boolean,
  iconW: number,
): Pick<LeafSize, 'labels' | 'layoutOptions'> {
  if (!caption && !iconW) return {};
  const gap = iconW && caption ? ICON_GAP : 0;
  const textW = caption ? measure(caption, CONNECTOR_LABEL_CLASS) : 0;
  const placement = vertical ? 'OUTSIDE H_RIGHT V_CENTER' : 'OUTSIDE H_CENTER V_BOTTOM';
  // elkjs skips a node label whose text is empty — it would collapse onto the node
  // origin instead of being placed OUTSIDE. An icon-only connector still needs the
  // box placed where the caption would go, so give it a single-space placeholder
  // (its own width is ignored — the box is sized by `width` below). The draw pass
  // treats a whitespace-only caption as none (see drawNode).
  return {
    labels: [
      {
        text: caption || ' ',
        width: iconW + gap + textW,
        height: Math.max(CONNECTOR_LABEL_LINE_H, iconW),
        layoutOptions: { 'org.eclipse.elk.nodeLabels.placement': placement },
      },
    ],
    layoutOptions: { 'org.eclipse.elk.spacing.labelNode': String(CONNECTOR_LABEL_GAP) },
  };
}

// Fixed dimensions (and a label, for named types) for a leaf entity. `direction`
// is the flow the leaf sits in — a `queue` reads it to orient along that axis, and
// a connector to place its caption below (horizontal) or to the right (vertical).
// `icon`, when set (only ever on a box subtype — see canHaveIcon), reserves room:
// a labelled box widens for a line-height icon before its caption; a label-less one
// sizes to a big icon it draws alone.
function leafSize(
  entity: Entity,
  measure: (text: string, className?: string) => number,
  direction: Direction,
  icon?: string,
  iconFactor?: number,
): LeafSize {
  const vertical = direction === 'TB' || direction === 'BT';
  // The drawn caption (see entityLabel): the name for a plain actor/storage, an
  // explicit label when given, and '' when there is none.
  const caption = entityLabel(entity);
  switch (entity.subtype) {
    case 'channel':
    // A request is a channel circle with an arrow inside — identical footprint.
    case 'request':
      return {
        width: CHANNEL_D,
        height: CHANNEL_D,
        ...connectorLabelSpec(caption, measure, vertical, icon ? iconPx(iconFactor, ICON_SIZE) : 0),
      };
    case 'pipe': {
      // A pipe is a thin bar drawn across the flow — a vertical `|` under LR/RL,
      // turned a quarter turn to a horizontal bar under TB/BT.
      const w = vertical ? PIPE_H : PIPE_W;
      const h = vertical ? PIPE_W : PIPE_H;
      return {
        width: w,
        height: h,
        ...connectorLabelSpec(caption, measure, vertical, icon ? iconPx(iconFactor, ICON_SIZE) : 0),
      };
    }
    case 'queue': {
      // Long side hugs the (rotated) label — plus, when set, an inline icon and its
      // gap — but never drops below QUEUE_MIN_LONG, so the bar keeps its shape; the
      // content is drawn turned a quarter turn in a vertical flow (see drawNode).
      // Half the usual leaf padding on each end (LABEL_PAD_X total) still clears the
      // stadium caps this thin box rounds to. Measured with the queue label class so
      // the reduced font is accounted for. (The bar's thickness is fixed, so a large
      // `icon-size` overflows it — that is the author's call.)
      const iconSize = icon ? iconPx(iconFactor, QUEUE_ICON_SIZE) : 0;
      const iconExtra = iconSize + (iconSize && caption ? ICON_GAP : 0);
      const textW = caption ? measure(caption, QUEUE_LABEL_CLASS) : 0;
      const long = Math.max(textW + iconExtra + LABEL_PAD_X, QUEUE_MIN_LONG);
      return vertical
        ? { width: QUEUE_THICKNESS, height: long, labels: [{ text: caption }] }
        : { width: long, height: QUEUE_THICKNESS, labels: [{ text: caption }] };
    }
    case 'user': {
      // A UML-style actor: min default-actor-height wide, half again as tall, and
      // widened/heightened to fit the caption and the glyph (stick figure, or an
      // icon whose size follows `icon-size`). drawNode places the glyph and the
      // bottom label; sizing just reserves room.
      const glyph = icon ? iconPx(iconFactor, USER_GLYPH) : USER_GLYPH;
      // Half the usual side padding around the caption, so a `user` sits narrower.
      const labelW = caption ? measure(caption) + LABEL_PAD_X * 0.75 : 0;
      return {
        width: Math.max(USER_MIN_W, labelW, glyph + LABEL_PAD_X * 0.75),
        height: Math.max(USER_MIN_H, glyph + (caption ? USER_LABEL_BAND : 0) + LABEL_PAD_X / 2),
        labels: caption ? [{ text: caption }] : undefined,
      };
    }
    default: {
      // A label-less box carrying an icon has no children either (it is a leaf), so
      // it draws the icon alone (twice line height by default) — size to clear it.
      if (icon && caption === '') {
        const size = iconPx(iconFactor, ICON_SIZE_LARGE);
        return {
          width: Math.max(LEAF_MIN_W, size + LABEL_PAD_X * 2),
          height: Math.max(LEAF_H, size + LABEL_PAD_X),
        };
      }
      // Otherwise reserve the caption's width plus, when present, the icon and its
      // gap drawn before the label; the box grows taller for a large icon so the
      // label (vertically centred to it) still fits.
      const size = icon ? iconPx(iconFactor, ICON_SIZE) : 0;
      const iconExtra = size ? size + ICON_GAP : 0;
      return {
        width: Math.max(LEAF_MIN_W, measure(caption) + LABEL_PAD_X * 2 + iconExtra),
        height: Math.max(LEAF_H, size ? size + LABEL_PAD_X : 0),
        labels: [{ text: caption }],
      };
    }
  }
}

function containerOptions(
  direction: Direction,
  topPad: number,
  sidePad: number = CONTAINER_PAD,
): Record<string, string> {
  return {
    'elk.algorithm': 'layered',
    'elk.direction': ELK_DIRECTION[direction],
    'elk.spacing.nodeNode': String(NODE_SPACING),
    'elk.layered.spacing.nodeNodeBetweenLayers': String(NODE_SPACING),
    'elk.padding': padding(topPad, sidePad, sidePad, sidePad),
  };
}

function padding(top: number, left: number, bottom: number, right: number): string {
  return `[top=${top},left=${left},bottom=${bottom},right=${right}]`;
}

// Invisible edges A->B->C to force reading order along the flow direction.
function chainEdges(prefix: string, children: ElkNode[]) {
  const edges = [];
  for (let i = 1; i < children.length; i++) {
    edges.push({
      id: `${prefix}.e${i}`,
      sources: [children[i - 1].id],
      targets: [children[i].id],
    });
  }
  return edges;
}

// How to draw a resolved connection: its arrowhead end, whether it breaks the
// actor↔storage rule (drawn bold red when it does), and its resolved stroke
// color (undefined = fall back to the theme line color via CSS).
interface ConnStyle {
  arrow: ArrowEnd;
  invalid: boolean;
  stroke?: string;
}

function arrowFor(type: Line['type']): ArrowEnd {
  if (type === '-->') return 'end';
  if (type === '<--') return 'start';
  return 'none';
}

function endpointName(endpoint: Entity | string): string {
  if (typeof endpoint === 'string') return endpoint;
  return endpoint.name || '(unnamed)';
}

function describeLine(line: Line): string {
  return `"${endpointName(line.source)} ${line.type} ${endpointName(line.target)}"`;
}

// The hand-drawn bridge for a boundary-crossing line whose LCA mixes directions,
// when the port chains (see planRoute) stop short of a common parent. It connects
// the two outermost anchors — `from` on the source side, `to` on the target side.
// `style.arrow` is already resolved (it only carries a head when the bridge itself
// touches an endpoint — that side had no port chain). `bend` shapes it.
interface ManualEdge {
  from: Anchor;
  to: Anchor;
  style: ConnStyle;
  bend?: 'z' | 'n' | 'auto';
}

// What the connection pass hands back: how to draw each ELK-routed edge (keyed
// by edge id), the set of node ids that ended up with at least one such edge,
// the containers that should flatten via INCLUDE_CHILDREN (boundary-crossing
// edges whose subtree has a single direction — flattening is invisible there),
// and the edges we must route ourselves (see ManualEdge).
interface Connections {
  styles: Map<string, ConnStyle>;
  connected: Set<string>;
  hierarchyContainers: Set<ElkNode>;
  manualEdges: ManualEdge[];
}

// One resolved line endpoint. `elk` is what an ELK edge attaches to (a node id, or
// a port id for a declared port); `owner` is the node id that governs the edge's
// LCA (the node itself, or a port's container). `entity` carries the coarse type
// for the validity check.
interface EndpointRef {
  elk: string;
  owner: string;
  isPort: boolean;
  entity: Entity;
}

// Resolves a line endpoint entity to its ELK/owner ids, or null when it is
// unknown (undefined entity) or was never built into a node (e.g. an entity with
// no id). A declared port resolves to its ELK port; anything else to its node.
function resolveEndpoint(entity: Entity | undefined, ctx: BuildCtx): EndpointRef | null {
  if (!entity) return null;
  const port = ctx.ports.get(entity);
  if (port) {
    return { elk: port.portId, owner: port.containerId, isPort: true, entity };
  }
  const id = ctx.idOf.get(entity);
  if (!id) return null;
  return { elk: id, owner: id, isPort: false, entity };
}

// Turns each FMC line into a real ELK edge. An edge must live in the lowest
// common ancestor of its endpoints (ELK's rule for hierarchical edges), which
// the dot-path ids make a cheap prefix computation. Endpoints that resolve to
// the same node, or to no node at all, are dropped with a warning so one bad
// reference never sinks the whole render.
function addConnections(
  graph: ElkNode,
  lines: Line[],
  ctx: BuildCtx,
  resolved: Map<Entity, Resolved>,
  diagramDirection: Direction,
  validation: PortValidation,
): Connections {
  const styles = new Map<string, ConnStyle>();
  const connected = new Set<string>();
  const hierarchyContainers = new Set<ElkNode>();
  const manualEdges: ManualEdge[] = [];
  lines.forEach((line, i) => {
    const sourceEntity =
      typeof line.source === 'string' ? ctx.byName.get(line.source) : line.source;
    const targetEntity =
      typeof line.target === 'string' ? ctx.byName.get(line.target) : line.target;
    // Each endpoint resolves to the ELK thing an edge connects to and the node id
    // that governs where the edge lives (its LCA). For a normal entity both are
    // its node id; for a declared `port` the edge attaches to the port id while the
    // LCA is computed from the port's container.
    const source = resolveEndpoint(sourceEntity, ctx);
    const target = resolveEndpoint(targetEntity, ctx);
    if (!source || !target || source.elk === target.elk) {
      console.warn(`fmc: could not draw connection ${describeLine(line)}`);
      return;
    }

    const lca = commonAncestorId(source.owner, target.owner);
    const container = lca === '' ? graph : ctx.nodeById.get(lca);
    if (!container) return;

    // Validity spans the whole graph for ports (a port's faces take their type
    // from every line wired to them), so it is decided once by the port analyser
    // — which also applies the plain actor↔storage rule when neither end is a port.
    const invalid = validation.isInvalidLine(line);
    const id = `conn${i}`;
    const style: ConnStyle = {
      arrow: arrowFor(line.type),
      invalid,
      // Invalid lines are always bold red — styling is ignored. Otherwise the
      // stroke is the line's own `style`, else the stroke inherited from its
      // container (a relative line) or its endpoints' common ancestor (an
      // absolute line); undefined leaves the theme line color to CSS.
      stroke: invalid ? undefined : lineStroke(line, lca, ctx, resolved),
    };

    const sourceId = source.elk;
    const targetId = target.elk;

    // Classify the line (plain sibling edge / flatten via INCLUDE_CHILDREN /
    // hand-routed port chains) — all the decision logic lives in planRoute, which
    // only needs whether the LCA subtree is direction-uniform. See docs/routing.md.
    // A declared `port` endpoint is fed in as a fixed anchor (its ELK id is the
    // port, its OWNER the port's container): planRoute treats it as an endpoint
    // pinned at depth 0 and chains the other side to it, so port lines take the
    // same path as node lines — no separate case.
    const lcaDir = lca === '' ? diagramDirection : ctx.dirById.get(lca) ?? diagramDirection;
    const uniform = subtreeDirectionsUniform(container, lcaDir, ctx.dirById);
    const plan = planRoute({
      sourceId,
      targetId,
      sourceOwner: source.owner,
      targetOwner: target.owner,
      sourceFixed: source.isPort,
      targetFixed: target.isPort,
      lca,
      lcaDir,
      lineType: line.type,
      routing: line.routing,
      uniform,
      connId: id,
    });

    if (plan.kind === 'manual') {
      // Kept SEPARATE (its endpoints stay out of `connected` so their ordering
      // edges survive); planRoute already fixed the port sides, depths, join, and
      // arrow placement.
      applyManualRoute(plan, style, ctx, container, styles, manualEdges);
      return;
    }

    if (plan.kind === 'plain' && plan.warnRoute) {
      console.warn(`fmc: route on ${describeLine(line)} does nothing (it crosses no boundary)`);
    }
    if (plan.kind === 'flatten') hierarchyContainers.add(container);

    (container.edges ??= []).push({ id, sources: [sourceId], targets: [targetId] });
    styles.set(id, style);
    connected.add(sourceId);
    connected.add(targetId);
  });
  return { styles, connected, hierarchyContainers, manualEdges };
}

// Applies a `manual` RoutePlan to the ELK graph: creates each planned port on its
// container (zero-size, so consecutive segments meet exactly; FIXED_SIDE pins the
// side), adds each planned segment as an ELK edge in its container with the
// planned arrowhead, then either adds the ELK join edge in the LCA or records the
// hand-drawn bridge. All the decisions were made by planRoute — this only mutates.
function applyManualRoute(
  plan: { source: ChainPlan; target: ChainPlan; join: JoinPlan },
  style: ConnStyle,
  ctx: BuildCtx,
  lcaContainer: ElkNode,
  styles: Map<string, ConnStyle>,
  manualEdges: ManualEdge[],
): void {
  const addPort = (p: PortSpec): void => {
    const container = ctx.nodeById.get(p.containerId);
    if (!container) return;
    (container.ports ??= []).push({
      id: p.portId,
      width: 0,
      height: 0,
      layoutOptions: { 'elk.port.side': ELK_PORT_SIDE[p.side] },
    });
    (container.layoutOptions ??= {})['elk.portConstraints'] = 'FIXED_SIDE';
  };
  const addSegment = (s: { id: string; from: string; to: string; container: string; arrow: ArrowEnd }): void => {
    const container = ctx.nodeById.get(s.container);
    if (!container) return;
    (container.edges ??= []).push({ id: s.id, sources: [s.from], targets: [s.to] });
    styles.set(s.id, { arrow: s.arrow, invalid: style.invalid, stroke: style.stroke });
  };

  for (const p of plan.source.ports) addPort(p);
  for (const p of plan.target.ports) addPort(p);
  for (const s of plan.source.segments) addSegment(s);
  for (const s of plan.target.segments) addSegment(s);

  if (plan.join.kind === 'elk') {
    // The join lives in the LCA (`plan.join.container` === the LCA id, which is
    // `lcaContainer` — the root graph when that id is '').
    (lcaContainer.edges ??= []).push({
      id: plan.join.id,
      sources: [plan.join.from],
      targets: [plan.join.to],
    });
    styles.set(plan.join.id, { arrow: plan.join.arrow, invalid: style.invalid, stroke: style.stroke });
  } else {
    manualEdges.push({
      from: plan.join.from,
      to: plan.join.to,
      style: { arrow: plan.join.arrow, invalid: style.invalid, stroke: style.stroke },
      bend: plan.join.bend,
    });
  }
}

// The explicit stroke a line should draw with, or undefined for the theme
// default. A relative line inherits from the entity it was written inside; an
// absolute line from the entity at the endpoints' lowest common ancestor.
function lineStroke(
  line: Line,
  lca: string,
  ctx: BuildCtx,
  resolved: Map<Entity, Resolved>,
): string | undefined {
  if (line.style?.stroke) return line.style.stroke;
  const containerEntity =
    line.container ?? (lca === '' ? null : ctx.entityById.get(lca) ?? null);
  return containerEntity ? resolved.get(containerEntity)?.strokeExplicit : undefined;
}

// Drops the invisible ordering edges (see chainEdges) that touch a node with a
// real connection: that node is already anchored by its line, so the ordering
// edge is redundant and only risks fighting the real routing. Real connection
// edges (id `conn…`) are always kept.
function pruneOrderingEdges(node: ElkNode, connected: Set<string>): void {
  if (node.edges) {
    node.edges = node.edges.filter(
      (edge) =>
        edge.id.startsWith('conn') ||
        (!connected.has(edge.sources[0]) && !connected.has(edge.targets[0])),
    );
  }
  for (const child of node.children ?? []) pruneOrderingEdges(child, connected);
}

// The subset of ELK's laid-out edge shape the draw pass reads. A layered,
// orthogonally-routed edge reports a single section: start point, optional bend
// points, end point — all relative to the edge's container node.
interface ElkEdgeSection {
  startPoint: { x: number; y: number };
  endPoint: { x: number; y: number };
  bendPoints?: { x: number; y: number }[];
}
interface LaidEdge {
  id: string;
  sections?: ElkEdgeSection[];
}

// The arrowhead markers for one diagram. `valid` and `invalid` are the shared
// CSS-colored defaults; `forColor` mints (and caches) a marker filled with a
// specific stroke color, since a marker can't inherit the referencing line's
// color cross-browser. All ids are scoped by the svg id so diagrams on one page
// don't collide.
interface Markers {
  valid: string;
  invalid: string;
  forColor(color: string): string;
}

// Creates the <defs>, the two default markers, and a color-marker factory.
function createMarkers(svg: SVGSVGElement, id: string): Markers {
  const defs = svgEl('defs', {});
  svg.appendChild(defs);
  const valid = `fmc-arrow-${id}`;
  const invalid = `fmc-arrow-invalid-${id}`;
  defs.appendChild(arrowMarker(valid, 'fmc-arrow'));
  defs.appendChild(arrowMarker(invalid, 'fmc-arrow fmc-arrow-invalid'));

  const cache = new Map<string, string>();
  let n = 0;
  return {
    valid,
    invalid,
    forColor(color: string): string {
      const hit = cache.get(color);
      if (hit) return hit;
      const markerId = `${valid}-c${n++}`;
      const marker = arrowMarker(markerId, 'fmc-arrow');
      // Override the CSS fill so the arrowhead matches the custom line color.
      (marker.firstChild as SVGElement).setAttribute('style', `fill:${color}`);
      defs.appendChild(marker);
      cache.set(color, markerId);
      return markerId;
    },
  };
}

// Draws the connection polylines, threading the same accumulated (ox, oy) the
// node pass uses so an edge's container-relative points land in absolute space.
// Only edges present in `styles` are real connections; the invisible ordering
// edges share the same arrays and are skipped. Invalid lines get the
// `fmc-edge-invalid` class and the red arrowhead; a line with a resolved stroke
// color is drawn inline with a matching arrowhead.
function drawEdges(
  svg: SVGSVGElement,
  node: ElkNode,
  ox: number,
  oy: number,
  styles: Map<string, ConnStyle>,
  markers: Markers,
): void {
  const originX = ox + (node.x ?? 0);
  const originY = oy + (node.y ?? 0);

  for (const edge of (node.edges ?? []) as LaidEdge[]) {
    const style = styles.get(edge.id);
    if (!style) continue;
    const section = edge.sections?.[0];
    if (!section) continue;

    const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint]
      .map((p) => `${originX + p.x},${originY + p.y}`)
      .join(' ');
    drawEdgePolyline(svg, points, style, markers);
  }

  for (const child of node.children ?? []) {
    drawEdges(svg, child, originX, originY, styles, markers);
  }
}

// Draws one connection polyline: the `fmc-edge` (plus `-invalid`) class, an
// inline stroke override when the line carries a color, and the matching
// arrowhead marker on the head end. Shared by ELK-routed and hand-routed edges.
function drawEdgePolyline(
  svg: SVGSVGElement,
  points: string,
  style: ConnStyle,
  markers: Markers,
): void {
  const cls = style.invalid ? 'fmc-edge fmc-edge-invalid' : 'fmc-edge';
  const line = svgEl('polyline', { points, class: cls });
  if (style.stroke) line.setAttribute('style', `stroke:${style.stroke}`);

  const markerId = style.invalid
    ? markers.invalid
    : style.stroke
      ? markers.forColor(style.stroke)
      : markers.valid;
  if (style.arrow === 'end') line.setAttribute('marker-end', `url(#${markerId})`);
  if (style.arrow === 'start') line.setAttribute('marker-start', `url(#${markerId})`);
  svg.appendChild(line);
}

// An axis-aligned rectangle in absolute diagram coordinates.
interface AbsRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Records every node's absolute box by threading the accumulated offset down the
// laid-out tree, so hand-routed edges can find their endpoints' positions. Port
// positions (relative to their owning node) are resolved to absolute points in
// the same walk, so a bridge can start from a laid-out port.
function collectAbsRects(
  node: ElkNode,
  ox: number,
  oy: number,
  out: Map<string, AbsRect>,
  ports: Map<string, { x: number; y: number }>,
): void {
  const x = ox + (node.x ?? 0);
  const y = oy + (node.y ?? 0);
  out.set(node.id, { x, y, w: node.width ?? 0, h: node.height ?? 0 });
  for (const port of (node as { ports?: { id: string; x?: number; y?: number }[] }).ports ?? []) {
    ports.set(port.id, { x: x + (port.x ?? 0), y: y + (port.y ?? 0) });
  }
  for (const child of node.children ?? []) collectAbsRects(child, x, y, out, ports);
}

type Pt = { x: number; y: number };

// A simple orthogonal route between two boxes for an edge ELK didn't route: exit
// the source and enter the target on the facing sides, with the turn taken at
// the midpoint of the gap. `bend` fixes the shape — `n` = VHV (leave top/bottom),
// `z` = HVH (leave left/right); `auto` (or omitted) picks the axis the boxes are
// more separated along, which keeps the run mostly straight. A zero-size source
// box routes from a single point (used for a port anchor).
function orthogonalPoints(s: AbsRect, t: AbsRect, bend?: 'z' | 'n' | 'auto'): Pt[] {
  const scx = s.x + s.w / 2;
  const scy = s.y + s.h / 2;
  const tcx = t.x + t.w / 2;
  const tcy = t.y + t.h / 2;
  const verticalFirst =
    bend === 'n' ? true : bend === 'z' ? false : Math.abs(tcy - scy) >= Math.abs(tcx - scx);
  if (verticalFirst) {
    const sy = tcy >= scy ? s.y + s.h : s.y;
    const ty = tcy >= scy ? t.y : t.y + t.h;
    const midY = (sy + ty) / 2;
    return [{ x: scx, y: sy }, { x: scx, y: midY }, { x: tcx, y: midY }, { x: tcx, y: ty }];
  }
  const sx = tcx >= scx ? s.x + s.w : s.x;
  const tx = tcx >= scx ? t.x : t.x + t.w;
  const midX = (sx + tx) / 2;
  return [{ x: sx, y: scy }, { x: midX, y: scy }, { x: midX, y: tcy }, { x: tx, y: tcy }];
}

function toPolyline(pts: Pt[]): string {
  return pts.map((p) => `${p.x},${p.y}`).join(' ');
}

function arrowMarker(id: string, className: string): SVGMarkerElement {
  const marker = svgEl('marker', {
    id,
    viewBox: '0 0 10 10',
    refX: 9,
    refY: 5,
    markerWidth: 7,
    markerHeight: 7,
    orient: 'auto-start-reverse',
  });
  // Triangle with tip at (10,5); the base (backside) curves inward toward the
  // tip rather than running straight, giving the head a slightly notched look.
  marker.appendChild(svgEl('path', { d: 'M0,0 L10,5 L0,10 Q3,5 0,0 z', class: className }));
  return marker;
}

// Lays out the graph, then grows each stadium container's padding on its two
// short (capped) edges by just enough to clear the caps, and re-lays out.
// Padding is added only on the axis parallel to the caps (the longer side),
// which leaves the shorter side — and thus the radius — fixed, so the insets are
// stable and a couple of passes converge (extra passes settle nested stadiums
// whose parents resize as they grow). Returns the per-node top-label offset so
// the draw pass can drop a vertical stadium's label below its top cap.
async function relayoutForStadiums(
  graph: ElkNode,
  stadiums: Stadium[],
): Promise<{ laid: ElkNode; labelOffsets: Map<string, number> }> {
  const labelOffsets = new Map<string, number>();
  let laid = await elk.layout(graph);
  if (stadiums.length === 0) return { laid, labelOffsets };

  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    for (const { node, labelHalf, topBand } of stadiums) {
      const w = node.width ?? 0;
      const h = node.height ?? 0;
      const r = Math.min(w, h) / 2;
      // Caps sit on the short edges: top/bottom when taller than wide, else
      // left/right.
      const vertical = w <= h;
      const childHw = childHalfExtent(node, vertical);

      let want: string;
      let topOffset = 0;
      if (vertical) {
        // Top cap must also clear the label; the bottom cap only the children.
        const topClr = capInset(r, Math.max(childHw, labelHalf));
        const botClr = capInset(r, childHw);
        topOffset = topClr;
        want = padding(
          topBand + topClr,
          CONTAINER_PAD,
          CONTAINER_PAD + botClr,
          CONTAINER_PAD,
        );
      } else {
        // Horizontal stadium: top edge is straight, so the label needs no
        // allowance; only the left/right caps clear the children.
        const clr = capInset(r, childHw);
        want = padding(
          topBand,
          CONTAINER_PAD + clr,
          CONTAINER_PAD,
          CONTAINER_PAD + clr,
        );
      }
      labelOffsets.set(node.id as string, topOffset);

      const opts = node.layoutOptions as Record<string, string>;
      if (opts['elk.padding'] !== want) {
        opts['elk.padding'] = want;
        changed = true;
      }
    }
    if (!changed) break;
    laid = await elk.layout(graph);
  }
  return { laid, labelOffsets };
}

// Read-only indexes the draw pass needs, plus `regionRects` — a scratch map it
// fills top-down with each region's interior-tiling fill rect (keyed by node
// id) so a region draws with the expanded box its parent computed for it.
interface DrawCtx {
  subtypes: Map<string, EntitySubtype>;
  resolvedById: Map<string, Resolved>;
  labelOffsets: Map<string, number>;
  regionRects: Map<string, Rect>;
  // Resolved icon SVG by `pack:name` spec, and rendered caption width by node id —
  // both used to draw and position an entity's icon (see drawNode).
  icons: Map<string, IconSvg>;
  labelWidths: Map<string, number>;
  // The top band each container reserved for its heading (see BuildCtx), by node
  // id — so the heading is centred in it and region fills stay below it.
  topBandById: Map<string, number>;
  // When true (the root-only `debug ports` directive), draw routing ports as
  // small red squares; otherwise they stay invisible.
  debugPorts: boolean;
  // Ids of the ports that came from a declared `port` entity (rather than the
  // line router). Under the debug overlay these draw green, to tell them apart
  // from the red routing ports.
  declaredPortIds: Set<string>;
  // The resolved inner-arrow direction of each `request` node, by node id (see
  // BuildCtx) — read to point the arrow drawn inside the circle.
  requestArrows: Map<string, Side>;
  // The multiplicity kind of each marked node, by id (see BuildCtx).
  multiplicity: Map<string, MultiplicityKind>;
}

// Orders a sibling list so region subtrees come first. SVG has no z-index —
// paint order is document order — so drawing regions before their siblings is
// what keeps a region's fill beneath the connectors, actors, and storages that
// share its container. Stable: order within each group is preserved, and a list
// with no mix is returned untouched.
function regionsFirst(
  nodes: ElkNode[],
  subtypes: Map<string, EntitySubtype>,
): ElkNode[] {
  const isRegion = (n: ElkNode) => subtypes.get(n.id) === 'region';
  const regions = nodes.filter(isRegion);
  if (regions.length === 0 || regions.length === nodes.length) return nodes;
  return [...regions, ...nodes.filter((n) => !isRegion(n))];
}

// Builds a nested <svg> holding one resolved icon, positioned at (x, y) at the
// given size. The icon's own viewBox scales its body to fit, and the default
// xMidYMid aspect ratio centres it; `currentColor` in the body picks up the
// `.fmc-icon` text color (styles.ts).
function iconEl(icon: IconSvg, x: number, y: number, size: number): SVGElement {
  const el = svgEl('svg', {
    x,
    y,
    width: size,
    height: size,
    viewBox: icon.viewBox,
    class: 'fmc-icon',
  });
  el.innerHTML = icon.body;
  return el;
}

// Draws a UML-style stick figure inside a `size`-square box centred on (cx, cy) —
// the default glyph for a `user` that carries no icon. Head, torso, arms, and
// splayed legs, all as `.fmc-user-figure` elements colored by CSS (styles.ts).
function userFigure(cx: number, cy: number, size: number): SVGElement {
  const g = svgEl('g', { class: 'fmc-user-figure' });
  const top = cy - size / 2;
  const headR = size * 0.15;
  const headCy = top + headR;
  // The head is an unfilled ring (stroke 1.5px). Start the torso a hair below the
  // ring's outer edge — clearing the stroke and the line's round cap — so it never
  // reaches into the hollow head.
  const neck = headCy + headR + 2;
  const hip = top + size * 0.62;
  const bottom = cy + size / 2;
  const armY = neck + size * 0.08; // shoulders, sitting on the torso just below the neck
  const armHalf = size * 0.28;
  const legHalf = size * 0.22;
  g.appendChild(svgEl('circle', { cx, cy: headCy, r: headR }));
  g.appendChild(svgEl('line', { x1: cx, y1: neck, x2: cx, y2: hip })); // torso
  g.appendChild(svgEl('line', { x1: cx - armHalf, y1: armY, x2: cx + armHalf, y2: armY })); // arms
  g.appendChild(svgEl('line', { x1: cx, y1: hip, x2: cx - legHalf, y2: bottom })); // left leg
  g.appendChild(svgEl('line', { x1: cx, y1: hip, x2: cx + legHalf, y2: bottom })); // right leg
  return g;
}

// The direction arrow a `request` draws centred in its circle, pointing at the
// given compass side. The triangle is built pointing east about the origin and
// rotated into place; it is filled with `stroke` — the request's own resolved
// outline color — so the arrow matches the glyph's border rather than the lines.
function requestArrow(cx: number, cy: number, side: Side, stroke: string): SVGElement {
  const hx = REQUEST_ARROW_L / 2;
  const hy = REQUEST_ARROW_H / 2;
  const d = `M${-hx},${-hy} L${hx},0 L${-hx},${hy} Q${-hx + REQUEST_ARROW_NOTCH},0 ${-hx},${-hy} z`;
  const g = svgEl('g', {
    transform: `translate(${cx} ${cy}) rotate(${REQUEST_ARROW_ANGLE[side]}) translate(${REQUEST_ARROW_OFFSET} 0)`,
  });
  g.appendChild(svgEl('path', { d, class: 'fmc-request-arrow', style: `fill:${stroke}` }));
  return g;
}

// Builds a centred `[icon] caption` group whose overall centre is the local origin
// (0, 0); the caller positions (and, for a queue, rotates) it with a transform on
// the returned <g>. Either part may be absent: icon-only, or text-only. `iconSize`
// is the icon's side; `labelWidth` is the caption's pre-measured width in the
// class it is drawn with, so the two sit side by side without re-measuring.
function iconLabelContent(
  iconSvg: IconSvg | undefined,
  iconSize: number,
  caption: string,
  labelClass: string,
  labelWidth: number,
): SVGGElement {
  const g = svgEl('g', {});
  const iconW = iconSvg ? iconSize : 0;
  const gap = iconSvg && caption ? ICON_GAP : 0;
  const left = -(iconW + gap + labelWidth) / 2;
  if (iconSvg) g.appendChild(iconEl(iconSvg, left, -iconSize / 2, iconSize));
  if (caption) {
    const text = svgEl('text', {
      x: left + iconW + gap + labelWidth / 2,
      y: 0,
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      class: labelClass,
    });
    text.textContent = caption;
    g.appendChild(text);
  }
  return g;
}

// Three dots in a box's bottom-right corner, evenly spaced along its 45° diagonal
// — the `actor...` "and more" ellipsis. Each dot centre sits at (corner - t) on
// both axes, so they lie on the diagonal; the nearest is offset by `t0` from the
// sharp corner. For a rounded box that base clears the corner arc: a point on the
// diagonal is inside the cap once (r - t)·√2 ≤ r, i.e. t ≥ r·(1 - 1/√2); we add
// the dot radius and a little padding on top. `stroke` is the box's outline color.
function multiplicityDots(
  box: { x: number; y: number; w: number; h: number },
  cornerR: number,
  stroke: string,
  scale = 1,
): SVGElement {
  const g = svgEl('g', { class: 'fmc-multiplicity-dots' });
  const r = ELLIPSIS_DOT_R * scale;
  const gap = ELLIPSIS_GAP * scale;
  const t0 = cornerR * (1 - Math.SQRT1_2) + r + ELLIPSIS_PAD;
  for (let i = 0; i < 3; i++) {
    const t = t0 + i * gap;
    g.appendChild(
      svgEl('circle', {
        cx: box.x + box.w - t,
        cy: box.y + box.h - t,
        r,
        style: `fill:${stroke}`,
      }),
    );
  }
  return g;
}

// Recursively draws laid-out nodes. ELK reports child coordinates relative to
// their parent, so we thread an accumulated (ox, oy) offset down the tree. Each
// node's fill and outline come pre-resolved (tint graduated by subtree height,
// user overrides folded in) keyed by node id.
function drawNode(
  svg: SVGSVGElement,
  node: ElkNode,
  ox: number,
  oy: number,
  ctx: DrawCtx,
): void {
  const x = ox + (node.x ?? 0);
  const y = oy + (node.y ?? 0);
  const w = node.width ?? 0;
  const h = node.height ?? 0;
  const subtype = ctx.subtypes.get(node.id) ?? 'actor';
  const isContainer = (node.children?.length ?? 0) > 0;
  const resolved = ctx.resolvedById.get(node.id);

  // A region's box is expanded to tile its parent's interior (see the child
  // pass below); every other node draws at its laid-out box. Children are still
  // positioned from the laid-out (x, y), so the expansion only grows the fill.
  const box = ctx.regionRects.get(node.id) ?? { x, y, w, h };
  // Multiplicity: a same-size, same-color box offset diagonally BEHIND this one,
  // drawn first so the real box paints over it. The layout already reserved room
  // for the protruding part (see shadowReservation), so it never overlaps a
  // neighbour or clips at the diagram edge. `*` uses a smaller offset than `...`.
  const multKind = ctx.multiplicity.get(node.id as string);
  // The diagonal offset of the marker's content past this box's corner. Only the
  // shadow families draw the shadow box itself; every other `...` subtype places
  // its dots at the same outside offset but with no box behind them.
  const multOff = multKind ? multiplicityOffset(multKind, subtype) : 0;
  const drawsShadow = !!multKind && MULTIPLICITY_SUBTYPES.has(subtype);
  if (drawsShadow) {
    svg.appendChild(
      shapeFor(subtype, box.x + multOff, box.y + multOff, box.w, box.h, resolved, isContainer),
    );
  }
  svg.appendChild(shapeFor(subtype, box.x, box.y, box.w, box.h, resolved, isContainer));
  // The `...` marker adds a three-dot ellipsis off the bottom-right corner, drawn
  // last so it sits on top and filled with the box's outline color. It anchors to
  // the offset corner — the shadow box's on a shadow family, else a virtual box
  // the same distance out — so the dots always sit OUTSIDE the entity. A region
  // gets a double-size line.
  if (multKind === 'dots') {
    const cornerR = isRounded(subtype) ? Math.min(box.w, box.h) / 2 : 0;
    const dotsBox = { x: box.x + multOff, y: box.y + multOff, w: box.w, h: box.h };
    const scale = subtype === 'region' ? 2 : 1;
    svg.appendChild(multiplicityDots(dotsBox, cornerR, resolved?.border ?? 'currentColor', scale));
  }

  // A request draws the channel circle above, then a direction arrow centred in
  // it (its caption, like any connector's, is drawn in the OUTSIDE-label branch
  // below). The side was resolved during the build pass; the arrow is filled with
  // the request's own outline color (`border` = its explicit stroke, else the
  // theme default), so it tracks the glyph's border.
  if (subtype === 'request') {
    const side = ctx.requestArrows.get(node.id as string) ?? 'e';
    const stroke = resolved?.border ?? 'currentColor';
    svg.appendChild(requestArrow(box.x + box.w / 2, box.y + box.h / 2, side, stroke));
  }

  // Ports are created zero-size for routing (see applyManualRoute) and so are
  // otherwise invisible. Under the `debug ports` directive, draw each as a small
  // square centred on its point so the anchors are visible: declared ports in
  // green, the router's own ports in red.
  if (ctx.debugPorts) {
    const PORT_MARK = 6;
    for (const port of (node as { ports?: { id: string; x?: number; y?: number }[] }).ports ?? []) {
      const px = x + (port.x ?? 0);
      const py = y + (port.y ?? 0);
      const declared = ctx.declaredPortIds.has(port.id);
      svg.appendChild(
        svgEl('rect', {
          x: px - PORT_MARK / 2,
          y: py - PORT_MARK / 2,
          width: PORT_MARK,
          height: PORT_MARK,
          style: `fill:${declared ? '#00c853' : '#ff0000'};stroke:none`,
          class: declared ? 'fmc-port fmc-port-declared' : 'fmc-port',
        }),
      );
    }
  }

  // The caption to draw (empty for a node without one — a port, a plain
  // connector, or an entity given an explicit `""`) and the per-node icon (only
  // the box subtypes carry one). A connector draws its caption beside the glyph;
  // everything else draws caption and/or icon inside the box.
  const caption = node.labels?.[0]?.text ?? '';
  const iconSpec = canHaveIcon(subtype) ? resolved?.icon : undefined;
  const iconSvg = iconSpec ? ctx.icons.get(iconSpec) : undefined;
  const iconFactor = canHaveIcon(subtype) ? resolved?.iconSize : undefined;

  if (isConnector(subtype)) {
    // Caption and/or icon sit in the OUTSIDE label box ELK laid out beside the
    // glyph (see connectorLabelSpec); draw the `[icon] caption` group centred in it.
    // A whitespace-only caption is the icon-only placeholder — treat it as none.
    const lbl = node.labels?.[0] as { x?: number; y?: number; width?: number; height?: number } | undefined;
    const connCaption = caption.trim() ? caption : '';
    if (lbl && (connCaption || iconSvg)) {
      const boxW = lbl.width ?? 0;
      const iconSize = iconSvg ? iconPx(iconFactor, ICON_SIZE) : 0;
      const gap = iconSvg && connCaption ? ICON_GAP : 0;
      // Split the laid-out box back into icon + caption; the width ELK reserved is
      // exactly iconSize + gap + captionWidth, so the caption's share is the remainder.
      const labelW = Math.max(0, boxW - iconSize - gap);
      const g = iconLabelContent(iconSvg, iconSize, connCaption, CONNECTOR_LABEL_CLASS, labelW);
      g.setAttribute(
        'transform',
        `translate(${x + (lbl.x ?? 0) + boxW / 2} ${y + (lbl.y ?? 0) + (lbl.height ?? 0) / 2})`,
      );
      svg.appendChild(g);
    }
  } else if (subtype === 'queue') {
    // Caption and/or icon inside the bar, drawn as one group and — when the queue
    // is taller than wide (a vertical flow) — turned a quarter turn so it reads
    // along the bar. The trailing 1px nudge is applied in the group's own rotated
    // frame (its up-axis) for optical balance, exactly as the plain label was.
    if (caption || iconSvg) {
      const cx = x + w / 2;
      const cy = y + h / 2;
      const labelW = caption ? ctx.labelWidths.get(node.id as string) ?? 0 : 0;
      const iconSize = iconSvg ? iconPx(iconFactor, QUEUE_ICON_SIZE) : 0;
      const g = iconLabelContent(iconSvg, iconSize, caption, QUEUE_LABEL_CLASS, labelW);
      const rot = h > w ? 'rotate(-90) ' : '';
      g.setAttribute('transform', `translate(${cx} ${cy}) ${rot}translate(0 -1)`);
      svg.appendChild(g);
    }
  } else if (subtype === 'user') {
    // A UML-style actor: caption along the bottom, and above it — filling the rest
    // of the box with either the icon at double size or a drawn stick figure.
    const cx = x + w / 2;
    const glyphCenterY = caption ? y + (h - USER_LABEL_BAND) / 2 : y + h / 2;
    if (iconSvg) {
      const glyph = iconPx(iconFactor, USER_GLYPH);
      svg.appendChild(iconEl(iconSvg, cx - glyph / 2, glyphCenterY - glyph / 2, glyph));
    } else {
      svg.appendChild(userFigure(cx, glyphCenterY, USER_GLYPH));
    }
    if (caption) {
      const label = svgEl('text', {
        x: cx,
        y: y + h - USER_LABEL_BAND / 2,
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        class: 'fmc-label',
      });
      label.textContent = caption;
      svg.appendChild(label);
    }
  } else if (drawsInternalLabel(subtype) && (caption || iconSvg)) {
    // actor / storage / variance / region. A vertical stadium's label band sits
    // just below its top cap; the offset was computed during layout. Other
    // containers centre the heading in their reserved band; a leaf on its own middle.
    const capOffset = ctx.labelOffsets.get(node.id as string) ?? 0;
    const bandH = ctx.topBandById.get(node.id as string) ?? CONTAINER_LABEL_BAND;
    const centerY = isContainer ? y + capOffset + bandH / 2 : y + h / 2;

    if (iconSvg && !caption && !isContainer) {
      // No label and no children: the icon is the whole content, centred in the box
      // (twice line height by default, or the `icon-size` factor).
      const size = iconPx(iconFactor, ICON_SIZE_LARGE);
      svg.appendChild(iconEl(iconSvg, x + w / 2 - size / 2, centerY - size / 2, size));
    } else {
      // The icon before the label (or, with no caption, on its own where the label
      // would be); the two are centred together as one group, so the label sits at
      // the icon's vertical centre however large `icon-size` makes it.
      const labelWidth = caption ? ctx.labelWidths.get(node.id as string) ?? 0 : 0;
      const size = iconPx(iconFactor, ICON_SIZE);
      const g = iconLabelContent(iconSvg, size, caption, 'fmc-label', labelWidth);
      g.setAttribute('transform', `translate(${x + w / 2} ${centerY})`);
      svg.appendChild(g);
    }
  }

  // Regions share out their parent's interior so their fill reaches every
  // border — stepped back 1px so it never paints over the parent's own outline
  // (below the label band, where there is one). Only regions claim space;
  // connectors auto-inserted by complex lines may sit alongside and are simply
  // covered. A bare (non-region, non-connector) sibling disables the expansion,
  // so a region never paints over a real neighbour — it then draws at its snug
  // laid-out box. Record each region child's rect before recursing so it draws
  // with it.
  const kids = node.children ?? [];
  const regionKids = kids.filter((k) => ctx.subtypes.get(k.id) === 'region');
  const onlyRegionsAndConnectors = kids.every((k) => {
    const st = ctx.subtypes.get(k.id) ?? 'actor';
    return st === 'region' || CONNECTOR_SUBTYPES.has(st);
  });
  if (regionKids.length > 0 && onlyRegionsAndConnectors) {
    // The top band the parent reserved and whose area a region fill must not
    // paint over: a region's own heading band only when it has a caption, else
    // the normal container label band (plus any stadium-cap offset).
    const bandH = ctx.topBandById.get(node.id as string) ?? CONTAINER_LABEL_BAND;
    const band =
      subtype === 'region'
        ? caption || iconSpec
          ? bandH
          : 0
        : (caption || iconSpec ? bandH : CONTAINER_PAD) +
          (ctx.labelOffsets.get(node.id as string) ?? 0);
    // Inset by 1px on the sides that meet the parent's border (left/right/bottom;
    // the top sits under the label band, not on a border).
    const interior: Rect = {
      x: box.x + 1,
      y: box.y + band,
      w: box.w - 2,
      h: box.h - band - 1,
    };
    const boxes: Rect[] = regionKids.map((k) => ({
      x: x + (k.x ?? 0),
      y: y + (k.y ?? 0),
      w: k.width ?? 0,
      h: k.height ?? 0,
    }));
    const rects = partitionRegions(interior, boxes, regionsStackVertically(boxes));
    regionKids.forEach((k, i) => ctx.regionRects.set(k.id as string, rects[i]));
  }

  for (const child of regionsFirst(kids, ctx.subtypes)) {
    drawNode(svg, child, x, y, ctx);
  }
}

// Every entity gets a `fmc-<subtype>` class for variant-specific styling and,
// when it is a container, `fmc-container`. Everything but a region also shares
// `fmc-entity`, which carries the common stroke — a region is borderless, so it
// is deliberately left out of that rule. Styling can target all entities, one
// subtype, or all containers.
function classFor(subtype: EntitySubtype, isContainer: boolean): string {
  const classes = subtype === 'region' ? ['fmc-region'] : ['fmc-entity', `fmc-${subtype}`];
  if (isContainer) classes.push('fmc-container');
  return classes.join(' ');
}

// Builds the outline element for an entity. Every entity is a rect: storage-
// family types round their corners by half the shorter side, which yields a
// stadium for oblong boxes and a full circle for the square channel. Fill (and
// an explicit stroke, when the entity or its ancestors set one) is applied via
// an inline `style` so it wins over the CSS defaults; a `color-mix()` fill also
// needs to be a CSS value, not a presentation attribute.
function shapeFor(
  subtype: EntitySubtype,
  x: number,
  y: number,
  w: number,
  h: number,
  resolved: Resolved | undefined,
  isContainer: boolean,
): SVGElement {
  let inline = `fill:${resolved?.fill ?? 'transparent'}`;
  // A region never renders a border, whatever stroke it might inherit.
  if (subtype === 'region') inline += ';stroke:none';
  else if (resolved?.strokeExplicit) inline += `;stroke:${resolved.strokeExplicit}`;
  const attrs: Record<string, string | number> = {
    x,
    y,
    width: w,
    height: h,
    style: inline,
    class: classFor(subtype, isContainer),
  };
  if (isRounded(subtype)) {
    const r = Math.min(w, h) / 2;
    attrs.rx = r;
    attrs.ry = r;
  }
  return svgEl('rect', attrs);
}

// Renders straight to the DOM (elkjs computes geometry; we own the SVG). Mermaid
// awaits an async draw, so we can await ELK's promise-based layout here.
export const renderer = {
  async draw(_text: string, id: string): Promise<void> {
    const svg = document.getElementById(id) as unknown as SVGSVGElement | null;
    if (!svg) {
      throw new Error(`fmc: could not find svg element #${id}`);
    }

    const entities = db.getEntities();
    const direction = db.getDirection();
    const { measure, done } = makeMeasurer(svg);

    // Resolve every entity's fill/outline/icon once (classes, `style`, tint
    // inheritance, theme fallbacks) up front, since the build pass reads each
    // entity's icon to reserve room for it. Indexed by node id for the draw pass below.
    const theme = renderTheme();
    const resolved = resolveStyles(
      entities,
      db.getClassDefs(),
      db.getNamedStyles(),
      db.getNamedClasses(),
      theme,
      db.getRootStyle(),
    );

    const ctx: BuildCtx = {
      measure,
      subtypes: new Map(),
      stadiums: [],
      resolved,
      labelWidths: new Map(),
      topBandById: new Map(),
      idOf: new Map(),
      nodeById: new Map(),
      entityById: new Map(),
      byName: new Map(),
      dirById: new Map(),
      ports: new Map(),
      declaredPortIds: new Set(),
      requestArrows: new Map(),
      multiplicity: new Map(),
    };

    const graph: ElkNode = {
      id: 'root',
      layoutOptions: containerOptions(direction, CONTAINER_PAD),
      children: entities.map((entity, i) => toElkNode(entity, `n${i}`, direction, ctx, true)),
      edges: [],
    };
    // Root ordering edges live alongside the top-level children.
    (graph as { edges: unknown[] }).edges = chainEdges('root', graph.children ?? []);
    // Whole-graph port line validation (also applies the plain actor↔storage
    // rule), decided up front so every connection can ask about itself.
    const validation = analysePorts(entities, db.getLines());
    // Append the real FMC connections now that every node id is known, then
    // drop the ordering edges that a real connection has made redundant.
    const { styles: connStyles, connected, hierarchyContainers, manualEdges } = addConnections(
      graph,
      db.getLines(),
      ctx,
      resolved,
      direction,
      validation,
    );
    // INCLUDE_CHILDREN lets ELK route an edge across subtree boundaries, but it
    // forces one flow direction across that node's whole subtree. It is a
    // per-node option (descendants inherit it), and addConnections only chose
    // these containers when flattening them is invisible — every container
    // inside already flows the LCA's way. Subtrees with a differing direction
    // were kept SEPARATE and their crossing edges hand-routed (manualEdges), so
    // both the directions and the connections survive.
    for (const container of hierarchyContainers) {
      const opts = (container.layoutOptions ??= {}) as Record<string, string>;
      opts['elk.hierarchyHandling'] = 'INCLUDE_CHILDREN';
    }
    pruneOrderingEdges(graph, connected);
    // All measuring is done synchronously above; drop the probe before layout.
    done();

    // Index the resolved styles by the node ids the draw pass works with.
    const resolvedById = new Map<string, Resolved>();
    for (const [nodeId, entity] of ctx.entityById) {
      const r = resolved.get(entity);
      if (r) resolvedById.set(nodeId, r);
    }

    const { laid, labelOffsets } = await relayoutForStadiums(graph, ctx.stadiums);

    // Resolve the icons any entity referenced to inline SVG (loading lazy packs on
    // the way). Skipped entirely when the diagram uses none, so `@iconify/utils`
    // and the packs are never touched by an icon-free render.
    const iconSpecs = new Set<string>();
    for (const r of resolved.values()) if (r.icon) iconSpecs.add(r.icon);
    const icons = iconSpecs.size > 0 ? await resolveIcons(iconSpecs) : new Map<string, IconSvg>();

    const markers = createMarkers(svg, id);
    const drawCtx: DrawCtx = {
      subtypes: ctx.subtypes,
      resolvedById,
      labelOffsets,
      regionRects: new Map(),
      icons,
      labelWidths: ctx.labelWidths,
      topBandById: ctx.topBandById,
      debugPorts: db.getDebugPorts(),
      declaredPortIds: ctx.declaredPortIds,
      requestArrows: ctx.requestArrows,
      multiplicity: ctx.multiplicity,
    };
    for (const node of regionsFirst(laid.children ?? [], ctx.subtypes)) {
      drawNode(svg, node, 0, 0, drawCtx);
    }
    drawEdges(svg, laid, 0, 0, connStyles, markers);

    // Hand-draw the bridge for each boundary-crossing line whose port chains
    // stopped short of the LCA (the ELK-routed chain segments were already drawn
    // above). Each anchor resolves to a box or a laid-out port point.
    if (manualEdges.length > 0) {
      const absRects = new Map<string, AbsRect>();
      const portPoints = new Map<string, { x: number; y: number }>();
      for (const node of laid.children ?? []) collectAbsRects(node, 0, 0, absRects, portPoints);
      const resolve = (a: Anchor): AbsRect | undefined => {
        if (a.kind === 'box') return absRects.get(a.id);
        const p = portPoints.get(a.portId);
        return p && { x: p.x, y: p.y, w: 0, h: 0 };
      };
      for (const edge of manualEdges) {
        const from = resolve(edge.from);
        const to = resolve(edge.to);
        if (from && to) {
          drawEdgePolyline(svg, toPolyline(orthogonalPoints(from, to, edge.bend)), edge.style, markers);
        }
      }
    }

    const width = Math.max(laid.width ?? 0, LEAF_MIN_W);
    const height = Math.max(laid.height ?? 0, LEAF_H);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
  },
};
