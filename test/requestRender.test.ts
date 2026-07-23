import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/db.js';
import { parser } from '../src/parser.js';
import { renderer } from '../src/renderer.js';

// Renders the REAL renderer under a minimal DOM stub (mirroring routing.elk.test)
// to check that a `request` draws a channel circle plus a direction arrow, that
// the arrow uses the line color (via the `fmc-arrow` class), and that its
// rotation follows the resolved orientation — explicit or auto-from-flow.

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

async function render(code: string): Promise<void> {
  svg.children = [];
  db.clear();
  parser.parse(code);
  await renderer.draw(code, 'x');
}

// The <g> wrapping the request's inner arrow (its child <path> carries the class).
function arrowGroup(): El | undefined {
  return svg.children.find(
    (e) => e.nodeName === 'g' && e.firstChild?.attrs['class']?.includes('fmc-request-arrow'),
  );
}

describe('request rendering', () => {
  it('draws a circle (rounded rect) for the request glyph', async () => {
    await render('fmc\n  request');
    const rect = svg.children.find((e) => e.nodeName === 'rect' && e.attrs['class']?.includes('fmc-request'));
    expect(rect).toBeDefined();
    // A square storage box rounds to a circle: rx = ry = half the side.
    expect(Number(rect?.attrs['rx'])).toBeGreaterThan(0);
    expect(rect?.attrs['rx']).toBe(rect?.attrs['ry']);
  });

  it('draws an inner arrow filled with the request outline color', async () => {
    await render('fmc\n  request Fetch e');
    const g = arrowGroup();
    expect(g).toBeDefined();
    expect(g?.firstChild?.attrs['d']).toBeTruthy();
    // Default outline is the theme node border (#333); the arrow fills to match.
    expect(g?.firstChild?.attrs['style']).toContain('fill:#333');
  });

  it('fills the inner arrow with an explicit stroke override', async () => {
    await render('fmc\n  request Fetch e\n    style stroke:#0a7');
    expect(arrowGroup()?.firstChild?.attrs['style']).toContain('fill:#0a7');
  });

  it('rotates the arrow to the explicit orientation', async () => {
    await render('fmc\n  request N n\n  request E e\n  request S s\n  request W w');
    const rotations = svg.children
      .filter((e) => e.nodeName === 'g' && e.firstChild?.attrs['class']?.includes('fmc-request-arrow'))
      .map((g) => g.attrs['transform']);
    // Declaration order N, E, S, W → 270, 0, 90, 180 degrees.
    expect(rotations[0]).toContain('rotate(270)');
    expect(rotations[1]).toContain('rotate(0)');
    expect(rotations[2]).toContain('rotate(90)');
    expect(rotations[3]).toContain('rotate(180)');
  });

  it('auto orientation points downstream of a vertical flow (TB → south)', async () => {
    await render('fmc\n  request Down');
    expect(arrowGroup()?.attrs['transform']).toContain('rotate(90)');
  });

  it('auto orientation points downstream of a horizontal flow (LR → east)', async () => {
    await render('fmc LR\n  request Right');
    expect(arrowGroup()?.attrs['transform']).toContain('rotate(0)');
  });

  it('auto orientation follows the enclosing container, not the diagram default', async () => {
    // Diagram flows TB, but the request sits in an RL region → arrow points west.
    await render(['fmc', '  region R rl', '    request Inner'].join('\n'));
    expect(arrowGroup()?.attrs['transform']).toContain('rotate(180)');
  });

  it('back orientation points opposite the flow (LR → west)', async () => {
    // auto in LR points east (rotate 0); back is its opposite → west (rotate 180).
    await render('fmc LR\n  request Up back');
    expect(arrowGroup()?.attrs['transform']).toContain('rotate(180)');
  });

  it('back orientation points opposite the flow (TB → north)', async () => {
    await render('fmc\n  request Up back');
    expect(arrowGroup()?.attrs['transform']).toContain('rotate(270)');
  });
});
