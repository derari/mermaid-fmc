import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/db.js';
import { parser } from '../src/parser.js';
import { renderer } from '../src/renderer.js';

// Renders the REAL renderer under a minimal DOM stub (mirroring the other
// render tests) to check that a multiplicity entity (`actor* servers`) draws a
// second, same-size, same-color "shadow" box offset diagonally behind it —
// without moving the entity's own box (so edges and layout are untouched).

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

// Every rect drawn for a given subtype class, in document (paint) order.
function rects(cls: string): El[] {
  return svg.children.filter(
    (e) => e.nodeName === 'rect' && e.attrs['class']?.split(' ').includes(cls),
  );
}
const num = (el: El, k: string): number => Number(el.attrs[k]);

describe('multiplicity rendering', () => {
  it('draws a single box for a plain actor', async () => {
    await render('fmc\n  actor servers');
    expect(rects('fmc-actor')).toHaveLength(1);
  });

  it('draws a same-size shadow box offset diagonally behind a `*` actor', async () => {
    await render('fmc\n  actor* servers');
    const drawn = rects('fmc-actor');
    expect(drawn).toHaveLength(2);
    // The shadow is painted first (behind), so it is the earlier child; the top
    // box is the later one, at the smaller (x, y).
    const [shadow, top] = drawn;
    // Same size.
    expect(num(shadow, 'width')).toBe(num(top, 'width'));
    expect(num(shadow, 'height')).toBe(num(top, 'height'));
    // Offset down AND right by the same amount (a diagonal shadow).
    const dx = num(shadow, 'x') - num(top, 'x');
    const dy = num(shadow, 'y') - num(top, 'y');
    expect(dx).toBeGreaterThan(0);
    expect(dx).toBe(dy);
    // `*` uses a SIXTH of the default actor height (the box height for a leaf).
    expect(dx).toBeCloseTo(num(top, 'height') / 6, 5);
  });

  it('uses a third-height offset and adds three corner dots for a `...` actor', async () => {
    await render('fmc\n  actor... servers');
    const [shadow, top] = rects('fmc-actor');
    // `...` uses a THIRD-height offset (larger than `*`).
    const dx = num(shadow, 'x') - num(top, 'x');
    expect(dx).toBe(num(shadow, 'y') - num(top, 'y'));
    expect(dx).toBeCloseTo(num(top, 'height') / 3, 5);
    // Three dots (circles) grouped as the ellipsis, evenly spaced on the 45°
    // diagonal in the bottom-right corner of the TOP box.
    const g = svg.children.find(
      (e) => e.nodeName === 'g' && e.attrs['class'] === 'fmc-multiplicity-dots',
    );
    expect(g).toBeDefined();
    const dots = (g as El).children.filter((c) => c.nodeName === 'circle');
    expect(dots).toHaveLength(3);
    const cx = dots.map((d) => num(d, 'cx'));
    const cy = dots.map((d) => num(d, 'cy'));
    // On the diagonal: each dot's cx and cy step by the same amount.
    const stepX = cx[1] - cx[0];
    const stepY = cy[1] - cy[0];
    expect(stepX).toBeCloseTo(stepY, 5);
    // Evenly spaced.
    expect(cx[2] - cx[1]).toBeCloseTo(stepX, 5);
    expect(cy[2] - cy[1]).toBeCloseTo(stepY, 5);
    // Anchored to the SHADOW box's corner, not the top box: the dots sit within
    // the shadow's bounds, and the corner-most one is past the top box's own
    // bottom-right corner (down and to the right of it).
    const shadowRight = num(shadow, 'x') + num(shadow, 'width');
    const shadowBottom = num(shadow, 'y') + num(shadow, 'height');
    const topRight = num(top, 'x') + num(top, 'width');
    const topBottom = num(top, 'y') + num(top, 'height');
    for (let i = 0; i < 3; i++) {
      expect(cx[i]).toBeLessThan(shadowRight);
      expect(cy[i]).toBeLessThan(shadowBottom);
    }
    // The corner-most dot (largest cx/cy) peeks out past the front box.
    expect(Math.max(...cx)).toBeGreaterThan(topRight);
    expect(Math.max(...cy)).toBeGreaterThan(topBottom);
  });

  it('draws no dots for a `*` actor', async () => {
    await render('fmc\n  actor* servers');
    const g = svg.children.find(
      (e) => e.nodeName === 'g' && e.attrs['class'] === 'fmc-multiplicity-dots',
    );
    expect(g).toBeUndefined();
  });

  it('draws dots OUTSIDE the box with NO shadow for `...` on a non-shadow family (queue)', async () => {
    await render('fmc\n  queue... Q');
    // Only one queue box — no shadow behind it.
    const box = rects('fmc-queue');
    expect(box).toHaveLength(1);
    const [q] = box;
    // The ellipsis is present, and sits past the box's bottom-right corner (i.e.
    // outside the object), like the actor/storage case — just no shadow.
    const g = svg.children.find(
      (e) => e.nodeName === 'g' && e.attrs['class'] === 'fmc-multiplicity-dots',
    );
    expect(g).toBeDefined();
    const dots = (g as El).children.filter((c) => c.nodeName === 'circle');
    expect(dots).toHaveLength(3);
    const cx = dots.map((d) => num(d, 'cx'));
    const cy = dots.map((d) => num(d, 'cy'));
    // The corner-most dot is beyond the box's own bottom-right corner.
    expect(Math.max(...cx)).toBeGreaterThan(num(q, 'x') + num(q, 'width'));
    expect(Math.max(...cy)).toBeGreaterThan(num(q, 'y') + num(q, 'height'));
  });

  const dotRadius = (): number => {
    const g = svg.children.find(
      (e) => e.nodeName === 'g' && e.attrs['class'] === 'fmc-multiplicity-dots',
    ) as El;
    return num(g.children.find((c) => c.nodeName === 'circle') as El, 'r');
  };

  it('doubles the dot size for a region', async () => {
    await render('fmc\n  actor... A');
    const actorR = dotRadius();
    await render('fmc\n  region... R\n    actor Inner');
    const regionR = dotRadius();
    expect(regionR).toBeCloseTo(actorR * 2, 5);
  });

  it('gives the shadow the same fill and stroke as the top box', async () => {
    await render('fmc\n  actor* servers\n    style fill:#abc, stroke:#123');
    const [shadow, top] = rects('fmc-actor');
    expect(shadow.attrs['style']).toBe(top.attrs['style']);
  });

  it('does not enlarge the entity box (edges still meet the real border)', async () => {
    await render('fmc\n  actor plain');
    const plain = rects('fmc-actor')[0];
    await render('fmc\n  actor* many');
    // The top box (smaller x) is the later-painted of the two.
    const top = rects('fmc-actor')[1];
    expect(num(top, 'width')).toBe(num(plain, 'width'));
    expect(num(top, 'height')).toBe(num(plain, 'height'));
  });

  it('shadows a container without moving its children or border', async () => {
    await render('fmc\n  storage Pool\n    actor Worker');
    const plainPool = rects('fmc-storage')[0];
    await render('fmc\n  storage* Pool\n    actor Worker');
    const poolRects = rects('fmc-storage');
    // Two storage boxes now: the shadow plus the real container.
    expect(poolRects).toHaveLength(2);
    const [, topPool] = poolRects;
    // Container border is the same size as the un-shadowed one.
    expect(num(topPool, 'width')).toBe(num(plainPool, 'width'));
    expect(num(topPool, 'height')).toBe(num(plainPool, 'height'));
  });
});
