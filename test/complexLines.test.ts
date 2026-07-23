import { describe, expect, it, vi } from 'vitest';
import { type ComplexLineSpec, expandComplexLines } from '../src/complexLines.js';
import { SUBTYPE_TYPE, type Entity, type EntitySubtype, type LineType } from '../src/db.js';

const ent = (name: string, subtype: EntitySubtype, children: Entity[] = []): Entity => ({
  name,
  type: SUBTYPE_TYPE[subtype],
  subtype,
  children,
});

// Builds the three-node chain `source arrow1 connector arrow2 target` — the
// smallest complex line. The connector's placement is found by climbing from the
// right entity to the first ancestor that matches the connector's family or
// already contains the left entity.
interface SpecParams {
  source?: Entity | string;
  target?: Entity | string;
  connector?: EntitySubtype;
  arrow1?: LineType;
  arrow2?: LineType;
}
const spec = (over: SpecParams = {}): ComplexLineSpec => {
  const { source = 'A', target = 'B', connector = 'channel', arrow1 = '-->', arrow2 = '-->' } = over;
  return {
    nodes: [{ entity: source }, { connector }, { entity: target }],
    arrows: [arrow1, arrow2],
  };
};

const names = (children: Entity[]): string[] => children.map((c) => c.name);
const subtypes = (children: Entity[]): EntitySubtype[] => children.map((c) => c.subtype);

describe('expandComplexLines', () => {
  it('inserts the connector between two top-level siblings', () => {
    const a = ent('A', 'actor');
    const s = ent('S', 'storage');
    const roots = [a, s];

    const lines = expandComplexLines(roots, [spec({ target: 'S' })]);

    expect(names(roots)).toEqual(['A', '', 'S']);
    const connector = roots[1];
    expect(connector.subtype).toBe('channel');
    expect(lines).toEqual([
      { source: a, target: connector, type: '-->' },
      { source: connector, target: s, type: '-->' },
    ]);
  });

  it('drops the connector into an ancestor of its own family', () => {
    // A channel (storage-family) stops at the storage container holding Inner.
    const inner = ent('Inner', 'storage');
    const outer = ent('Outer', 'storage', [inner]);
    const roots = [ent('A', 'actor'), outer];

    expandComplexLines(roots, [spec({ target: 'Inner' })]);

    expect(subtypes(outer.children)).toEqual(['channel', 'storage']);
    expect(names(roots)).toEqual(['A', 'Outer']); // nothing inserted at top level
  });

  it('climbs past a mismatched family to a same-family ancestor', () => {
    const inner = ent('Inner', 'actor');
    const box = ent('Box', 'storage', [ent('Mid', 'actor', [inner])]);
    const roots = [ent('A', 'actor'), box];

    // A channel (storage) skips the actor Mid and lands in the storage Box,
    // before Mid's branch.
    expandComplexLines(roots, [spec({ target: 'Inner' })]);

    expect(subtypes(box.children)).toEqual(['channel', 'actor']);
  });

  it('stops at the container that already holds entity1, whatever its family', () => {
    // Group is actor-family, not the channel's family, but it holds both A and
    // B, so the channel goes there rather than climbing further.
    const a = ent('A', 'actor');
    const b = ent('B', 'actor');
    const group = ent('Group', 'actor', [a, b]);
    const roots = [group];

    expandComplexLines(roots, [spec({ source: 'A', target: 'B' })]);

    expect(names(group.children)).toEqual(['A', '', 'B']);
    expect(group.children[1].subtype).toBe('channel');
  });

  it('climbs to the diagram scope when nothing matches sooner', () => {
    const inner = ent('Inner', 'storage');
    const outer = ent('Outer', 'storage', [inner]);
    const roots = [ent('A', 'actor'), outer];

    // A pipe (actor-family) finds no actor ancestor and no shared container, so
    // it lands at top level before Outer's branch.
    expandComplexLines(roots, [spec({ target: 'Inner', connector: 'pipe' })]);

    expect(names(roots)).toEqual(['A', '', 'Outer']);
    expect(roots[1].subtype).toBe('pipe');
  });

  describe('regions', () => {
    it('drops the connector inside a region whose next non-region parent matches', () => {
      // The storage DB's contents are wrapped in a region; a channel (storage)
      // treats the region as storage-family and lands INSIDE it, before Reader.
      const reader = ent('Reader', 'actor');
      const wrap = ent('Wrap', 'region', [reader]);
      const db = ent('DB', 'storage', [wrap]);
      const roots = [ent('A', 'actor'), db];

      expandComplexLines(roots, [spec({ target: 'Reader' })]);

      expect(subtypes(wrap.children)).toEqual(['channel', 'actor']);
      expect(subtypes(db.children)).toEqual(['region']); // nothing added beside the region
    });

    it('matches through several nested regions to the non-region ancestor', () => {
      const worker = ent('Worker', 'actor');
      const inner = ent('Inner', 'region', [worker]);
      const outer = ent('Outer', 'region', [inner]);
      const box = ent('Box', 'actor', [outer]);
      const roots = [ent('S', 'storage'), box];

      // A pipe (actor-family) sees Inner -> Outer -> Box(actor) and stops at the
      // innermost region wrapping Worker.
      expandComplexLines(roots, [spec({ source: 'S', target: 'Worker', connector: 'pipe' })]);

      expect(subtypes(inner.children)).toEqual(['pipe', 'actor']);
    });

    it('lands in entity2\'s region when its non-region parent holds both endpoints', () => {
      // Service (actor) holds both Bob and Carol. It is not the channel's family,
      // but it is where the connector would land by containment — so Carol's
      // region is eligible and the channel goes INSIDE Right, before Carol.
      const carol = ent('Carol', 'actor');
      const right = ent('Right', 'region', [carol]);
      const bob = ent('Bob', 'actor');
      const left = ent('Left', 'region', [bob]);
      const service = ent('Service', 'actor', [left, right]);
      const roots = [service];

      expandComplexLines(roots, [spec({ source: bob, target: 'Carol' })]);

      expect(subtypes(service.children)).toEqual(['region', 'region']); // not beside them
      expect(subtypes(right.children)).toEqual(['channel', 'actor']);
    });

    it('lands inside a top-level region that itself holds both endpoints', () => {
      const a = ent('A', 'actor');
      const b = ent('B', 'actor');
      const g = ent('G', 'region', [a, b]);
      const roots = [g];

      expandComplexLines(roots, [spec({ source: 'A', target: 'B' })]);

      expect(names(g.children)).toEqual(['A', '', 'B']);
      expect(g.children[1].subtype).toBe('channel');
    });

    it('lands inside a top-level region even when entity1 is outside it', () => {
      // G's next non-region parent is the diagram root, so G is eligible: the
      // channel goes inside G (before B), not beside it at diagram scope.
      const b = ent('B', 'actor');
      const g = ent('G', 'region', [b]);
      const a = ent('A', 'actor');
      const roots = [g, a];

      expandComplexLines(roots, [spec({ source: 'A', target: 'B' })]);

      expect(names(roots)).toEqual(['G', 'A']); // nothing added at diagram scope
      expect(subtypes(g.children)).toEqual(['channel', 'actor']);
    });
  });

  it('accepts a direct entity reference as the source (relative form)', () => {
    const client = ent('Client', 'actor');
    const server = ent('Server', 'storage');
    const roots = [client, server];

    const lines = expandComplexLines(roots, [spec({ source: client, target: 'Server' })]);

    expect(names(roots)).toEqual(['Client', '', 'Server']);
    expect(lines[0].source).toBe(client);
  });

  describe('connector reuse', () => {
    it('reuses one connector when family, container, and second segment match', () => {
      const a = ent('A', 'actor');
      const b = ent('B', 'actor');
      const hub = ent('Hub', 'actor');
      const roots = [a, b, hub];

      const lines = expandComplexLines(roots, [
        spec({ source: 'A', target: 'Hub' }),
        spec({ source: 'B', target: 'Hub' }),
      ]);

      const channels = roots.filter((e) => e.subtype === 'channel');
      expect(channels).toHaveLength(1);
      const c = channels[0];
      // First line lays down both segments; the second reuses and adds only its
      // own first segment.
      expect(lines).toEqual([
        { source: a, target: c, type: '-->' },
        { source: c, target: hub, type: '-->' },
        { source: b, target: c, type: '-->' },
      ]);
    });

    it('does not reuse when the second segment arrow differs', () => {
      const roots = [ent('A', 'actor'), ent('B', 'actor'), ent('Hub', 'actor')];
      expandComplexLines(roots, [
        spec({ source: 'A', target: 'Hub', arrow2: '-->' }),
        spec({ source: 'B', target: 'Hub', arrow2: '<--' }),
      ]);
      expect(roots.filter((e) => e.subtype === 'channel')).toHaveLength(2);
    });

    it('does not reuse a connector of a different family', () => {
      const roots = [ent('A', 'actor'), ent('B', 'actor'), ent('Hub', 'actor')];
      expandComplexLines(roots, [
        spec({ source: 'A', target: 'Hub', connector: 'channel' }),
        spec({ source: 'B', target: 'Hub', connector: 'pipe' }),
      ]);
      expect(roots.filter((e) => e.subtype === 'channel')).toHaveLength(1);
      expect(roots.filter((e) => e.subtype === 'pipe')).toHaveLength(1);
    });

    it('does not reuse for a different second endpoint', () => {
      const roots = [ent('A', 'actor'), ent('B', 'actor'), ent('H1', 'actor'), ent('H2', 'actor')];
      expandComplexLines(roots, [
        spec({ source: 'A', target: 'H1' }),
        spec({ source: 'B', target: 'H2' }),
      ]);
      expect(roots.filter((e) => e.subtype === 'channel')).toHaveLength(2);
    });
  });

  describe('chains', () => {
    it('emits one segment per arrow, threading named entities untouched', () => {
      const a = ent('A', 'actor');
      const p = ent('P', 'pipe');
      const s = ent('S', 'storage');
      const roots = [a, p, s];

      const lines = expandComplexLines(roots, [
        { nodes: [{ entity: 'A' }, { entity: 'P' }, { entity: 'S' }], arrows: ['---', '---'] },
      ]);

      expect(names(roots)).toEqual(['A', 'P', 'S']); // nothing inserted
      expect(lines).toEqual([
        { source: a, target: p, type: '---' },
        { source: p, target: s, type: '---' },
      ]);
    });

    it('inserts a connector for each interior glyph and wires the whole chain', () => {
      const a = ent('A', 'actor');
      const p = ent('P', 'actor');
      const s = ent('S', 'storage');
      const roots = [a, p, s];

      // A --- o --- P --- | --- S: a channel then a pipe, around the named P.
      const lines = expandComplexLines(roots, [
        {
          nodes: [
            { entity: 'A' },
            { connector: 'channel' },
            { entity: 'P' },
            { connector: 'pipe' },
            { entity: 'S' },
          ],
          arrows: ['---', '---', '---', '---'],
        },
      ]);

      expect(subtypes(roots)).toEqual(['actor', 'channel', 'actor', 'pipe', 'storage']);
      const [, channel, , pipe] = roots;
      expect(lines).toEqual([
        { source: a, target: channel, type: '---' },
        { source: channel, target: p, type: '---' },
        { source: p, target: pipe, type: '---' },
        { source: pipe, target: s, type: '---' },
      ]);
    });
  });

  describe('port targets', () => {
    it('places the connector beside the port\'s container when the source is outside it', () => {
      // A channel targeting a port on Box, reached from an actor outside Box,
      // lands beside Box (at diagram scope) rather than inside it next to Port.
      const port = ent('Port', 'port');
      const inner = ent('Inner', 'storage');
      const box = ent('Box', 'storage', [port, inner]);
      const a = ent('A', 'actor');
      const roots = [a, box];

      const lines = expandComplexLines(roots, [spec({ source: 'A', target: 'Port' })]);

      // Inserted at the top level, just before Box — not among Box's children.
      expect(subtypes(roots)).toEqual(['actor', 'channel', 'storage']);
      expect(subtypes(box.children)).toEqual(['port', 'storage']);
      const channel = roots[1];
      expect(lines).toEqual([
        { source: a, target: channel, type: '-->' },
        { source: channel, target: port, type: '-->' },
      ]);
    });

    it('keeps ordinary port placement when the source is inside the port\'s container', () => {
      // Source and port share the container Box, so the connector stays inside,
      // just before the port — the container-substitution does not kick in.
      const port = ent('Port', 'port');
      const worker = ent('Worker', 'actor');
      const box = ent('Box', 'storage', [worker, port]);
      const roots = [box];

      expandComplexLines(roots, [spec({ source: 'Worker', target: 'Port' })]);

      expect(subtypes(box.children)).toEqual(['actor', 'channel', 'port']);
      expect(names(roots)).toEqual(['Box']); // nothing inserted at top level
    });
  });

  it('skips a line whose endpoint does not resolve, without mutating the tree', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const roots = [ent('A', 'actor')];

    const lines = expandComplexLines(roots, [spec({ target: 'Missing' })]);

    expect(lines).toEqual([]);
    expect(names(roots)).toEqual(['A']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
