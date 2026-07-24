import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/db.js';
import { parser } from '../src/parser.js';
import { renderer } from '../src/renderer.js';

// Integration tests that run the REAL renderer (ELK layout + SVG build) under a
// minimal DOM stub. They cover only what the pure planRoute tests cannot: that a
// plan, once applied, actually routes through ELK — including the port chain
// climbing through a flattened container (rule 3), which is the ELK behaviour the
// whole design hinges on — and that heads land correctly in the final geometry.

class El {
  nodeName: string;
  children: El[] = [];
  attrs: Record<string, string> = {};
  private text = '';
  constructor(name: string) {
    this.nodeName = name;
  }
  setAttribute(k: string, v: string): void {
    this.attrs[k] = String(v);
  }
  getAttribute(k: string): string | null {
    return this.attrs[k] ?? null;
  }
  appendChild(c: El): El {
    this.children.push(c);
    return c;
  }
  remove(): void {}
  get firstChild(): El | null {
    return this.children[0] ?? null;
  }
  set textContent(v: string) {
    this.text = v;
  }
  get textContent(): string {
    return this.text;
  }
  getComputedTextLength(): number {
    return this.text.length * 8;
  }
}

let svg: El;
const origDocument = (globalThis as { document?: unknown }).document;

beforeAll(() => {
  svg = new El('svg');
  (globalThis as { document?: unknown }).document = {
    createElementNS: (_ns: string, name: string) => new El(name),
    getElementById: () => svg,
  };
});
afterAll(() => {
  (globalThis as { document?: unknown }).document = origDocument;
});

// All edge <path> elements anywhere in the built SVG (edges are appended flat,
// each carrying the fmc-edge class; other paths — arrowheads, glyphs — do not).
function edges(): El[] {
  return svg.children.filter((e) => e.nodeName === 'path' && !!e.attrs.class?.includes('fmc-edge'));
}
// Count of edges carrying an arrowhead (a real line's single head).
function heads(): number {
  return edges().filter((p) => p.attrs['marker-start'] || p.attrs['marker-end']).length;
}

async function render(code: string): Promise<void> {
  svg.children = [];
  db.clear();
  parser.parse(code);
  await renderer.draw(code, 'x');
}

describe('routing (real ELK)', () => {
  it('routes a mixed-direction cross line via auto-depth port chains, one head at the target', async () => {
    await render(
      [
        'fmc tb',
        '  region Left lr',
        '    actor A',
        '    actor B',
        '  region Right tb',
        '    storage C',
        '    storage D',
        '  A --> C',
        '    route depth:1',
      ].join('\n'),
    );
    // Source and target chains + the ELK join = 3 polylines; exactly one head.
    expect(edges().length).toBe(3);
    expect(heads()).toBe(1);
  });

  it('composes a flattened container with a port chain climbing out of it (rule 3)', async () => {
    // A -> S2 routes via flattening Big; B -> T's chain places a port on Bottom,
    // *inside* the flattened Big, and still routes. The pre-rewrite clamp existed
    // only because we (wrongly) thought this could not work — so this is the test
    // that must keep it working.
    await render(
      [
        'fmc lr',
        '  region Big tb',
        '    region Top tb',
        '      actor A',
        '      storage S',
        '    region Bottom tb',
        '      actor B',
        '      storage S2',
        '    A --> S2',
        '  region Other tb',
        '    storage T',
        '  B --> T',
        '    route depth:1',
      ].join('\n'),
    );
    // Two real lines (A->S2 flattened, B->T ported+bridged): two heads total.
    expect(heads()).toBe(2);
    // B->T is a chain (B->port) + bridge + (T->port) = 3 polylines; A->S2 = 1.
    expect(edges().length).toBeGreaterThanOrEqual(4);
  });

  it('routes a two-level port chain out of nested containers without throwing', async () => {
    await render(
      [
        'fmc tb',
        '  region Outer lr',
        '    storage P',
        '    region Inner tb',
        '      actor A',
        '      actor B',
        '  storage C',
        '  A --> C',
        '    route exit:s depth:2',
      ].join('\n'),
    );
    // A->port(Inner) + port(Inner)->port(Outer) + join(->C) = 3 polylines, one head.
    expect(edges().length).toBe(3);
    expect(heads()).toBe(1);
  });

  it('chains a declared port nested below the LCA, joining by ELK without throwing', async () => {
    // `alice` is a declared port on `region LR`, itself inside `extra` — one level
    // below the root LCA. With depth high enough the fixed port grows a routing
    // port on `extra` (not on its own container) and ELK-joins Bob's chain at the
    // root, instead of a hand-drawn bridge. Regression for the fixed-port chain.
    await render(
      [
        'fmc tb',
        '  debug ports',
        '  route depth:99',
        '  region',
        '    actor a-bob',
        '      -- alice',
        '  region extra',
        '    region LR',
        '      port alice w',
        '        --r-- a-alice',
        '      actor a-alice',
      ].join('\n'),
    );
    const rects: El[] = [];
    const walk = (e: El): void => {
      if (e.nodeName === 'rect') rects.push(e);
      e.children.forEach(walk);
    };
    walk(svg);
    const ports = rects.filter((r) => (r.attrs.class ?? '').startsWith('fmc-port'));
    const declared = ports.filter((r) => r.attrs.class?.includes('fmc-port-declared')).length;
    const router = ports.filter((r) => r.attrs.class === 'fmc-port').length;
    // One declared port (alice) plus TWO router ports: one on Bob's region and one
    // on `extra` — the latter is what the fix adds (proof the fixed port chained up
    // its enclosing container rather than bridging from depth 0).
    expect(declared).toBe(1);
    expect(router).toBe(2);
  });

  it('hand-routes the whole line at depth:0 (single polyline, one head)', async () => {
    await render(
      [
        'fmc tb',
        '  region Left lr',
        '    actor A',
        '    actor B',
        '  region Right tb',
        '    storage C',
        '    storage D',
        '  A --> C',
        '    route depth:0',
      ].join('\n'),
    );
    expect(edges().length).toBe(1);
    expect(heads()).toBe(1);
  });

  it('draws undirected lines through a bridging port as valid (non-red) edges', async () => {
    // A port needs both faces wired to bridge: Inner (actor) inside, DB (storage)
    // outside — both edges valid.
    await render(
      [
        'fmc lr',
        '  storage DB',
        '  actor Box',
        '    actor Inner',
        '    port In w',
        '    Inner --- In',
        '  DB --- In',
      ].join('\n'),
    );
    const ls = edges();
    expect(ls.length).toBe(2);
    expect(ls.every((p) => p.attrs.class === 'fmc-edge')).toBe(true);
  });

  it('builds a declared port on a childless box (queue) and routes a line into it', async () => {
    // A queue holds no nested boxes but may carry ports. Its unwired inner face
    // borrows the queue's storage family (see portTypes), so an undirected line
    // from an actor bridges the port cleanly and stays valid.
    await render(
      [
        'fmc lr',
        '  debug ports',
        '  actor A',
        '  queue Jobs',
        '    port In w',
        '  A --- In',
      ].join('\n'),
    );
    const rects: El[] = [];
    const walk = (e: El): void => {
      if (e.nodeName === 'rect') rects.push(e);
      e.children.forEach(walk);
    };
    walk(svg);
    // The declared port rendered as a declared-port marker (proof it was built on
    // the leaf queue), and the line to it routed as a single valid edge.
    expect(rects.some((r) => r.attrs.class?.includes('fmc-port-declared'))).toBe(true);
    expect(edges().length).toBe(1);
    expect(edges()[0].attrs.class).toBe('fmc-edge');
  });

  it('draws a same-family port bridge as an invalid (red) edge', async () => {
    // No inner line, so the inner face takes `actor` from the container `Box`; the
    // outer actor `A` matches it, so the port bridges nothing (actor↔actor) — red.
    await render(
      ['fmc lr', '  actor A', '  actor Box', '    port In w', '  A --- In'].join('\n'),
    );
    const ls = edges();
    expect(ls.length).toBe(1);
    expect(ls[0].attrs.class).toBe('fmc-edge fmc-edge-invalid');
  });

  it('keeps a box that has only a port child (it is a leaf, not an empty container)', async () => {
    // Regression: an actor whose only child is a `port` was built as a compound
    // node with no child boxes, which ELK collapsed to zero size — the box vanished,
    // leaving just its label. It must render as a normal leaf box carrying the port.
    await render(['fmc LR', '  actor Bob', '    port p w', '  storage Alice', '  p -- Alice'].join('\n'));
    const bob = svg.children.find(
      (e) => e.nodeName === 'rect' && e.attrs.class?.includes('fmc-actor'),
    );
    expect(bob).toBeDefined();
    expect(Number(bob!.attrs.width)).toBeGreaterThan(0);
    expect(Number(bob!.attrs.height)).toBeGreaterThan(0);
    // Being a leaf now, it is not tagged as a container.
    expect(bob!.attrs.class).not.toContain('fmc-container');
    // The port line still routes (one polyline for p--Alice), and bridges cleanly:
    // the inner face takes `actor` from Bob, the outer end is storage Alice — valid.
    const ls = edges();
    expect(ls.length).toBe(1);
    expect(ls[0].attrs.class).toBe('fmc-edge');
  });

  it('wires a child to its container port and the port on to a sibling', async () => {
    await render(
      [
        'fmc lr',
        '  actor Box',
        '    actor Inner',
        '    port Out e',
        '  storage DB',
        '  Inner --- Out',
        '  Out --> DB',
      ].join('\n'),
    );
    // Two valid edges; the head sits on DB (away from the port), never on Out.
    expect(edges().length).toBe(2);
    expect(edges().every((p) => p.attrs.class === 'fmc-edge')).toBe(true);
    expect(heads()).toBe(1);
  });

  it('validates a two-port pass-through from the entities behind each port', async () => {
    // Worker (actor) — Out — In — Data (storage): each port bridges the families,
    // so all three edges are valid (none red). Undirected so no head lands on a port.
    await render(
      [
        'fmc lr',
        '  actor Box',
        '    actor Worker',
        '    port Out e',
        '    Worker --- Out',
        '  storage Store',
        '    storage Data',
        '    port In w',
        '    Data --- In',
        '  Out --- In',
      ].join('\n'),
    );
    const ls = edges();
    expect(ls.length).toBe(3);
    expect(ls.every((p) => p.attrs.class === 'fmc-edge')).toBe(true);
  });

  it('draws an arrowhead into a port as an invalid (red) edge', async () => {
    await render(
      ['fmc lr', '  storage DB', '  actor Box', '    port In w', '  DB --> In'].join('\n'),
    );
    const ls = edges();
    expect(ls.length).toBe(1);
    expect(ls[0].attrs.class).toBe('fmc-edge fmc-edge-invalid');
  });

  it('draws declared ports green under the debug overlay', async () => {
    await render(
      [
        'fmc lr',
        '  debug ports',
        '  storage DB',
        '  actor Box',
        '    actor Inner',
        '    port In w',
        '    Inner --- In',
        '  DB --- In',
      ].join('\n'),
    );
    const marks = svg.children.filter((e) => e.nodeName === 'rect' && e.attrs.class?.includes('fmc-port'));
    expect(marks.length).toBe(1);
    expect(marks[0].attrs.class).toContain('fmc-port-declared');
    expect(marks[0].attrs.style).toContain('#00c853');
  });

  // The reported bug: `alice` sits inside a region, wired to a port on a *sibling*
  // region. The line lives in the root LCA but alice is a level down, so a plain
  // ELK edge could not dive across that boundary and the line was silently
  // dropped. It now routes through the ordinary crossing machinery.
  const nestedPortDiagram = [
    'fmc tb',
    '  region',
    '    actor alice',
    '      --- p-bob',
    '  region lr',
    '    port p-bob w',
    '      -o- bob',
    '    actor bob',
  ].join('\n');

  it('routes a line to a declared port whose other end is nested in a sibling container', async () => {
    await render(nestedPortDiagram);
    // Default depth (like node crossings): alice--p-bob is one hand-drawn bridge;
    // the `-o- bob` complex line adds p-bob--channel and channel--bob. Three
    // polylines — the alice line is no longer dropped.
    expect(edges().length).toBe(3);
    // All bridge cleanly (actor↔storage across the port), so none is red.
    expect(edges().every((p) => p.attrs.class === 'fmc-edge')).toBe(true);
  });

  it('preserves a sibling container\'s own direction when routing a nested port line', async () => {
    // The crossing must NOT flatten the mixed root (which would unify directions).
    // The right region flows LR, so `bob` stays to the RIGHT of the channel it
    // connects to — a horizontal segment — rather than being stacked by a TB flow.
    await render(nestedPortDiagram);
    const horizontal = edges().some((p) => {
      const pts = [...p.attrs.d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => [
        Number(m[1]),
        Number(m[2]),
      ]);
      return pts.length >= 2 && pts.every((q) => q[1] === pts[0][1]);
    });
    expect(horizontal).toBe(true);
  });

  it('route depth:auto ELK-routes the nested end into the declared port via a chain', async () => {
    await render(
      [
        'fmc tb',
        '  region',
        '    actor alice',
        '      --- p-bob',
        '      route depth:auto',
        '  region lr',
        '    port p-bob w',
        '      -o- bob',
        '    actor bob',
      ].join('\n'),
    );
    // alice now climbs out through a routed port (1 chain segment) that ELK-joins
    // the declared port (1 join edge) = 2 polylines for that line, + 2 for the
    // channel = 4. Directions are still preserved (no flattening).
    expect(edges().length).toBe(4);
    expect(edges().every((p) => p.attrs.class === 'fmc-edge')).toBe(true);
  });

  it('renders an undirected mixed cross line with no head', async () => {
    await render(
      [
        'fmc tb',
        '  region Left lr',
        '    actor A',
        '    actor B',
        '  region Right tb',
        '    storage C',
        '    storage D',
        '  A --- C',
        '    route depth:1',
      ].join('\n'),
    );
    expect(heads()).toBe(0);
    expect(edges().length).toBe(3);
  });
});
