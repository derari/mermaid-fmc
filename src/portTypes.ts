import { type Entity, type Line, SUBTYPE_TYPE, isInvalidConnection } from './db.js';

// Line validation for ports, kept pure (no ELK, no DOM) so it can be unit-tested
// directly like geometry.ts / routePlan.ts / styleModel.ts. The renderer resolves
// its graph, calls `analysePorts` once, then asks `isInvalidLine` per connection.
//
// The model treats a port as a hole in its container's wall with two faces:
//   - `inner` — the face inside the container, reached by lines from within it;
//   - `outer` — the face outside, reached by lines from elsewhere.
// Each face has a TYPE — `actor`, `storage`, `mixed`, or `empty` — inferred from
// the entities wired to it. A meaningful port bridges the two families (FMC's
// actor↔storage rule) across the wall, so a port whose two faces carry the SAME
// type is a modelling error; and a face with nothing wired to it (`empty`) means
// the port doesn't bridge at all, which invalidates the lines on the other face.
// One exception: an INNER face with no lines of its own takes the family of its
// container (the wall the port sits in) — an actor/storage box lends its family,
// a region lends none (stays `empty`) — so a port on a plain box bridges outward
// without an explicit inner line (see faceType).

export type PortSideType = 'actor' | 'storage' | 'mixed' | 'empty';

// The two faces of a port. Named to avoid confusion with the compass `Side` a
// port pins to (n/e/s/w) — that is about geometry, this is about topology.
type Face = 'inner' | 'outer';

function opposite(face: Face): Face {
  return face === 'inner' ? 'outer' : 'inner';
}

// The consensus of the types wired to one face that HAS lines: a single distinct
// family wins, anything else (a clash, or nothing definite to go on) is `mixed`.
// The `empty` type is never produced here — it is reserved for a face carrying no
// lines at all (decided in `faceType`), so a face WITH lines is never `empty`.
function consensus(types: PortSideType[]): PortSideType {
  if (types.length === 0) return 'mixed';
  const first = types[0];
  return types.every((t) => t === first) ? first : 'mixed';
}

export interface PortValidation {
  // Whether a line is invalid and should be drawn bold red. Handles both the
  // plain actor↔storage rule (neither end a port) and the port face-type rules.
  // Unresolved or self-referential lines are never invalid (the renderer skips
  // them with a warning of their own).
  isInvalidLine(line: Line): boolean;
}

// Builds the validator over the whole entity tree and line list. Face types are
// computed lazily and memoised; a cycle (port → port → … → port) is broken by
// seeding each face with `mixed` before recursing into it, so a self-referential
// chain contributes `mixed` rather than looping forever.
export function analysePorts(roots: Entity[], lines: Line[]): PortValidation {
  // First-declaration-wins name index and a child→parent map, mirroring how the
  // renderer resolves endpoints (so validation and drawing agree on who is who).
  const byName = new Map<string, Entity>();
  const parent = new Map<Entity, Entity | null>();
  const visit = (e: Entity, p: Entity | null): void => {
    if (e.name && !byName.has(e.name)) byName.set(e.name, e);
    parent.set(e, p);
    e.children.forEach((c) => visit(c, e));
  };
  roots.forEach((r) => visit(r, null));

  const resolve = (ep: Entity | string): Entity | undefined =>
    typeof ep === 'string' ? byName.get(ep) : ep;
  const isPort = (e: Entity): boolean => e.subtype === 'port';

  // Whether `anc` encloses `node` (is a proper ancestor of it).
  const isAncestor = (anc: Entity, node: Entity): boolean => {
    let p = parent.get(node) ?? null;
    while (p) {
      if (p === anc) return true;
      p = parent.get(p) ?? null;
    }
    return false;
  };

  // Resolve every line once, keeping those whose endpoints both resolve to
  // distinct entities — the only ones that can carry or clash a type.
  const resolved: { line: Line; a: Entity; b: Entity }[] = [];
  for (const line of lines) {
    const a = resolve(line.source);
    const b = resolve(line.target);
    if (a && b && a !== b) resolved.push({ line, a, b });
  }

  // Which face of `port` a line to `other` touches: inner when `other` sits
  // inside the port's container, outer otherwise.
  const faceOf = (port: Entity, other: Entity): Face => {
    const container = parent.get(port) ?? null;
    if (container && (other === container || isAncestor(container, other))) return 'inner';
    return 'outer';
  };

  // The family a plain entity contributes: actor-family → actor, storage-family
  // → storage, anything else (a region) → nothing.
  const family = (e: Entity): PortSideType | undefined => {
    const t = SUBTYPE_TYPE[e.subtype];
    if (t === 'actor') return 'actor';
    if (t === 'storage') return 'storage';
    return undefined;
  };

  // Memoised face types, keyed by port then face.
  const faceTypes = new Map<Entity, Partial<Record<Face, PortSideType>>>();

  // The type the far end of a line presents to `port`. A plain entity presents
  // its own family; a port presents its OTHER face — the far side of the hole,
  // whose face is the one this line does not touch on it.
  const contribution = (other: Entity, port: Entity): PortSideType | undefined => {
    if (isPort(other)) return faceType(other, opposite(faceOf(other, port)));
    return family(other);
  };

  const faceType = (port: Entity, face: Face): PortSideType => {
    let rec = faceTypes.get(port);
    if (!rec) {
      rec = {};
      faceTypes.set(port, rec);
    }
    const cached = rec[face];
    if (cached !== undefined) return cached;
    // Seed with `mixed` so a cycle back into this face terminates.
    rec[face] = 'mixed';
    let hasLine = false;
    const contributions: PortSideType[] = [];
    for (const { a, b } of resolved) {
      const other = a === port ? b : b === port ? a : undefined;
      if (!other || faceOf(port, other) !== face) continue;
      hasLine = true;
      const t = contribution(other, port);
      // A dead-end chain (the far end's opposite face is `empty`) carries no clean
      // family — fold it into `mixed` rather than letting a lined face read `empty`.
      if (t !== undefined) contributions.push(t === 'empty' ? 'mixed' : t);
    }
    // A face with lines takes the consensus of its contributions. A face with no
    // lines is normally `empty` — but an INNER face with nothing wired to it falls
    // back to the family of the wall it is cut into (its container): an actor
    // container makes the inner face `actor`, a storage container `storage`. A
    // region (or root) has no family, so the face stays `empty` and the port still
    // bridges nothing there. This lets a port on a plain box bridge to the outside
    // without needing an explicit inner line.
    let result: PortSideType;
    if (hasLine) {
      result = consensus(contributions);
    } else if (face === 'inner') {
      const container = parent.get(port) ?? null;
      result = (container && family(container)) || 'empty';
    } else {
      result = 'empty';
    }
    rec[face] = result;
    return result;
  };

  // Whether `port` flags a line (to `other`, touching the port on `face`) invalid,
  // per the face-type rules:
  //  1. faces carry the same type    → every line on the port is invalid;
  //  2. the OPPOSITE face is `empty` → the port bridges nothing, so this line
  //                                     (and every other on this face) is invalid;
  //  3. THIS face is `mixed` and the opposite is definite → invalid when the far
  //                                     end's type equals that opposite type;
  //  4. otherwise                    → the port bridges cleanly here, valid.
  const portFlags = (port: Entity, other: Entity): boolean => {
    const inner = faceType(port, 'inner');
    const outer = faceType(port, 'outer');
    if (inner === outer) return true;
    const face = faceOf(port, other);
    const ownType = face === 'inner' ? inner : outer;
    const oppType = face === 'inner' ? outer : inner;
    if (oppType === 'empty') return true;
    if (ownType === 'mixed' && oppType !== 'mixed') return contribution(other, port) === oppType;
    return false;
  };

  const isInvalidLine = (line: Line): boolean => {
    const a = resolve(line.source);
    const b = resolve(line.target);
    if (!a || !b || a === b) return false;
    const aPort = isPort(a);
    const bPort = isPort(b);
    // An arrowhead is a destination marker, and a port is a pass-through, not a
    // destination — so any line whose head lands ON a port is invalid. `-->`
    // heads the target, `<--` heads the source.
    if (line.type === '-->' && bPort) return true;
    if (line.type === '<--' && aPort) return true;
    // Neither end a port: the ordinary same-family rule.
    if (!aPort && !bPort) return isInvalidConnection(a.type, b.type);
    // A line touching a port is invalid if either port endpoint flags it.
    if (aPort && portFlags(a, b)) return true;
    if (bPort && portFlags(b, a)) return true;
    return false;
  };

  return { isInvalidLine };
}
