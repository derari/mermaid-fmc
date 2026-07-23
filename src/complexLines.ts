import {
  SUBTYPE_TYPE,
  type Entity,
  type EntitySubtype,
  type Line,
  type LineType,
  type RouteSpec,
  type Side,
  type StyleProps,
} from './db.js';

// A complex line is a chain — `node arrow node arrow node …` of any length —
// threaded through a mix of named entities and auto-inserted connectors. A
// `node` is either a reference to an entity (a name, or the enclosing entity
// when an endpoint was omitted in a relative line) or a connector glyph (`o` for
// a channel, `|` for a pipe, `q` for a queue, `r` for a request) that stands for
// a real entity created and placed for you. The chain expands to one segment (a
// simple line) per arrow.
//
// Each connector's home is found by climbing from the entity on its RIGHT toward
// the diagram root, stopping at the first ancestor that either shares the
// connector's own family (a channel is storage-family, a pipe actor-family) or
// already contains the entity on its LEFT. The connector is dropped into that
// ancestor just before that branch.
//
// A region has no family of its own, so it stands in for its nearest non-region
// ancestor: whenever that ancestor is where the connector would land — because
// it shares the connector's family (a region wrapping a storage's contents
// counts as storage-family), because it already holds both endpoints, or
// because that ancestor is the diagram root itself — the connector lands
// *inside* the region rather than beside it. (See resolvedContainer and
// findPlacement.)

// One position in a complex line's chain: either an entity reference (a name, or
// a direct Entity when an omitted endpoint was filled by the enclosing entity),
// or a connector glyph to be auto-created.
export type ChainNode =
  | { entity: Entity | string }
  // An auto-inserted connector entity ('channel' | 'pipe' | 'queue' | 'request').
  // A request carries its inner-arrow direction (undefined = auto); other subtypes
  // ignore it.
  | { connector: EntitySubtype; requestDir?: Side | 'back' };

export interface ComplexLineSpec {
  // The chain, interleaved with `arrows`: nodes[0] arrows[0] nodes[1] … nodes[n].
  // There are always at least three nodes (two arrows) with at least one interior
  // node, and the first and last node are always entity references.
  nodes: ChainNode[];
  arrows: LineType[]; // one per gap; arrows.length === nodes.length - 1
  // Styles from a `style` nested under the complex line: they paint every
  // auto-inserted connector and set the stroke of every generated segment.
  style?: StyleProps;
  // The enclosing entity for a relative complex line, inherited by the segments'
  // stroke (undefined for an absolute complex line — it uses the endpoints' LCA).
  container?: Entity | null;
  // Routing hints from a `route` statement nested under the complex line. Copied
  // onto every generated segment so a boundary-crossing segment can honor them.
  routing?: RouteSpec;
}

// First-declaration-wins name lookup, matching how the renderer resolves lines.
function nameIndex(roots: Entity[]): Map<string, Entity> {
  const index = new Map<string, Entity>();
  const visit = (e: Entity) => {
    if (e.name && !index.has(e.name)) index.set(e.name, e);
    e.children.forEach(visit);
  };
  roots.forEach(visit);
  return index;
}

// Child -> parent for every entity; a top-level entity maps to null.
function parentIndex(roots: Entity[]): Map<Entity, Entity | null> {
  const parent = new Map<Entity, Entity | null>();
  const visit = (e: Entity, p: Entity | null) => {
    parent.set(e, p);
    e.children.forEach((c) => visit(c, e));
  };
  roots.forEach((r) => visit(r, null));
  return parent;
}

function subtreeContains(root: Entity, target: Entity): boolean {
  if (root === target) return true;
  return root.children.some((c) => subtreeContains(c, target));
}

// The real container an entity resolves to for connector placement: the entity
// itself when it is not a region, otherwise its nearest non-region ancestor —
// regions are transparent, so a region stands in for the actual container
// around it. Null when the chain reaches diagram scope without a non-region
// ancestor (a top-level region).
function resolvedContainer(
  entity: Entity | null,
  parents: Map<Entity, Entity | null>,
): Entity | null {
  let e = entity;
  while (e && e.type === 'region') e = parents.get(e) ?? null;
  return e;
}

function insertBefore(siblings: Entity[], before: Entity, node: Entity): void {
  const i = siblings.indexOf(before);
  if (i < 0) siblings.push(node);
  else siblings.splice(i, 0, node);
}

// Where a connector goes: the child list to splice into, the branch to sit just
// before, and the containing entity (null = diagram scope) that identifies the
// spot for reuse.
interface Placement {
  parent: Entity | null;
  siblings: Entity[];
  before: Entity;
}

// Climbs from entity2 toward the root and reports where the connector belongs.
// A candidate stops the climb when the container it resolves to (itself, or a
// region's nearest non-region ancestor) is eligible to hold the connector —
// either it matches the connector's family, or it already contains entity1. So
// a region is a valid home whenever its non-region parent would have been: the
// connector then lands *inside* the region rather than beside it. `branch`
// stays the direct child of the stopping container on the path to entity2, so
// "before entity2's branch" is well-defined however far up we climb; the null
// parent (diagram scope) is the fallback and is treated as containing entity1.
function findPlacement(
  roots: Entity[],
  parents: Map<Entity, Entity | null>,
  entity1: Entity,
  entity2: Entity,
  connectorType: Entity['type'],
): Placement {
  let branch = entity2;
  let parent = parents.get(entity2) ?? null;
  while (parent !== null) {
    const home = resolvedContainer(parent, parents);
    // Eligible — and, when `parent` is a region, the connector then lands inside
    // it — when the resolved container matches the connector's family, already
    // holds entity1, or IS the diagram root (home === null, reached only for a
    // top-level region). The root is the ultimate home and is treated as holding
    // both endpoints, so a region whose next non-region parent is the root
    // qualifies too.
    if (home === null || home.type === connectorType || subtreeContains(home, entity1)) {
      break;
    }
    branch = parent;
    parent = parents.get(parent) ?? null;
  }
  return { parent, siblings: parent ? parent.children : roots, before: branch };
}

// A connector a complex line already created, remembered so a later line with
// the same family, container, and second segment can share it.
interface SharedConnector {
  subtype: EntitySubtype;
  requestDir?: Side | 'back'; // distinguishes requests pointing different ways
  parent: Entity | null;
  target: Entity; // entity2
  arrow2: LineType;
  connector: Entity;
}

// Expands every complex line into its auto-inserted connectors plus one simple
// line per arrow, mutating `roots` in place and returning the lines to record.
// Each connector is placed by findPlacement using the nearest named entity on
// either side. When a connector would match one an earlier line already placed —
// same family, same container, same outgoing segment (target + arrow) — that
// connector is reused and only the incoming segment is added, so several sources
// can feed one channel or pipe. A chain with an unresolvable named endpoint is
// skipped whole with a warning, mirroring how the renderer treats a simple line.
export function expandComplexLines(roots: Entity[], specs: ComplexLineSpec[]): Line[] {
  if (specs.length === 0) return [];
  const names = nameIndex(roots);
  const parents = parentIndex(roots);
  const lines: Line[] = [];
  const shared: SharedConnector[] = [];

  for (const spec of specs) {
    // Resolve every entity node up front; a connector node stays null until it is
    // created (or reused) below. A chain always begins and ends with an entity.
    const resolved: (Entity | null)[] = spec.nodes.map((node) =>
      'entity' in node
        ? (typeof node.entity === 'string' ? names.get(node.entity) ?? null : node.entity)
        : null,
    );
    const missing = spec.nodes.findIndex((node, i) => 'entity' in node && !resolved[i]);
    if (missing >= 0) {
      const ref = (spec.nodes[missing] as { entity: Entity | string }).entity;
      const label = typeof ref === 'string' ? ref : ref.name || '(unnamed)';
      console.warn(`fmc: could not expand a complex line at "${label}" (unknown endpoint)`);
      continue;
    }

    // Carries the complex line's own styling onto a generated segment: its
    // stroke, and the container it inherits stroke from. Kept off the object when
    // absent so generated-line equality (in tests) is unaffected.
    const seg = (source: Entity, target: Entity, type: LineType): Line => {
      const line: Line = { source, target, type };
      if (spec.style) line.style = spec.style;
      if (spec.container) line.container = spec.container;
      if (spec.routing) line.routing = spec.routing;
      return line;
    };

    // The nearest resolved named entity on either side of a connector node — the
    // entity1/entity2 the placement logic climbs between. Endpoints are always
    // entities, so both always exist for an interior connector.
    const entityLeft = (k: number): Entity => {
      for (let i = k - 1; i >= 0; i--) if ('entity' in spec.nodes[i]) return resolved[i] as Entity;
      throw new Error('fmc: complex line missing a left endpoint'); // unreachable
    };
    const entityRight = (k: number): Entity => {
      for (let i = k + 1; i < spec.nodes.length; i++)
        if ('entity' in spec.nodes[i]) return resolved[i] as Entity;
      throw new Error('fmc: complex line missing a right endpoint'); // unreachable
    };

    // Arrows leaving a reused connector already exist and must not be re-emitted.
    const reusedOut = new Set<number>();

    // Create (or reuse) each connector, left to right, so its incoming neighbour
    // is already resolved by the time we wire the segments below.
    spec.nodes.forEach((node, k) => {
      if (!('connector' in node)) return;
      const connectorType = SUBTYPE_TYPE[node.connector];
      const left = entityLeft(k);
      const right = entityRight(k);
      // Placement climbs from the target. A port, though, only pins the
      // connection to an edge of its container — so when the target is a port
      // reached from OUTSIDE that container, the connector belongs with the
      // container (placed as its sibling), not buried inside next to the port.
      // Climb from the container instead. A port reached from within its own
      // container keeps the ordinary port-based placement.
      const portContainer = right.type === 'port' ? parents.get(right) ?? null : null;
      const target = portContainer && !subtreeContains(portContainer, left) ? portContainer : right;
      const placement = findPlacement(roots, parents, left, target, connectorType);
      const arrow2 = spec.arrows[k]; // the arrow leaving this connector

      const reusable = shared.find(
        (s) =>
          s.subtype === node.connector &&
          s.requestDir === node.requestDir &&
          s.parent === placement.parent &&
          s.target === right &&
          s.arrow2 === arrow2,
      );
      if (reusable) {
        resolved[k] = reusable.connector;
        reusedOut.add(k);
        return;
      }

      const connector: Entity = {
        name: '',
        type: connectorType,
        subtype: node.connector,
        children: [],
      };
      // A request carries the inner-arrow direction the glyph asked for (auto when
      // omitted); other subtypes never set it.
      if (node.connector === 'request' && node.requestDir !== undefined) {
        connector.requestDir = node.requestDir;
      }
      // A `style` on the complex line that creates the connector paints it too.
      if (spec.style) connector.style = spec.style;
      insertBefore(placement.siblings, placement.before, connector);
      resolved[k] = connector;
      shared.push({
        subtype: node.connector,
        requestDir: node.requestDir,
        parent: placement.parent,
        target: right,
        arrow2,
        connector,
      });
    });

    // One segment per arrow, skipping a reused connector's outgoing arrow (arrow
    // `i` leaves node `i`, so it is the outgoing arrow of a connector at `i`).
    spec.arrows.forEach((type, i) => {
      if (reusedOut.has(i)) return;
      lines.push(seg(resolved[i] as Entity, resolved[i + 1] as Entity, type));
    });
  }
  return lines;
}
