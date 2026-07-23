import { describe, expect, it } from 'vitest';
import type { Entity, StyleProps } from '../src/db.js';
import { type ThemeDefaults, resolveStyles } from '../src/styleModel.js';

const THEME: ThemeDefaults = { tint: '#ececff', stroke: '#9370db', shade: 'black' };

const ent = (
  name: string,
  over: Partial<Entity> = {},
  children: Entity[] = [],
): Entity => ({
  name,
  type: 'actor',
  subtype: 'actor',
  children,
  ...over,
});

const resolve = (
  roots: Entity[],
  opts: {
    classDefs?: Map<string, StyleProps>;
    namedStyles?: Map<string, StyleProps>;
    namedClasses?: Map<string, string[]>;
    theme?: ThemeDefaults;
    rootStyle?: StyleProps;
  } = {},
) =>
  resolveStyles(
    roots,
    opts.classDefs ?? new Map(),
    opts.namedStyles ?? new Map(),
    opts.namedClasses ?? new Map(),
    opts.theme ?? THEME,
    opts.rootStyle ?? {},
  );

describe('resolveStyles', () => {
  it('gives a lone entity the theme tint (a leaf, so no shading) and border', () => {
    const a = ent('A');
    const r = resolve([a]).get(a);
    expect(r).toEqual({ fill: '#ececff', border: '#9370db', strokeExplicit: undefined });
  });

  it('applies a flat fill to just that node, not its children', () => {
    const child = ent('Child');
    const a = ent('A', { style: { fill: '#ffd54f' } }, [child]);
    const map = resolve([a]);
    expect(map.get(a)?.fill).toBe('#ffd54f');
    // Child still tints from the theme base, ignoring the parent's flat fill.
    expect(map.get(child)?.fill).toBe('#ececff');
  });

  it('cascades tint to descendants, graduated by each node subtree height', () => {
    const leaf = ent('Leaf');
    const mid = ent('Mid', {}, [leaf]);
    const root = ent('Root', { style: { tint: '#c62828' } }, [mid]);
    const map = resolve([root]);
    // Leaf is a leaf -> pure tint; ancestors mix toward the shade target.
    expect(map.get(leaf)?.fill).toBe('#c62828');
    expect(map.get(mid)?.fill).toContain('color-mix(in srgb, #c62828');
    expect(map.get(root)?.fill).toContain('#c62828');
    expect(map.get(mid)?.fill).toContain('black');
  });

  it('lets a nested tint override an inherited one for its own subtree', () => {
    const gLeaf = ent('GLeaf');
    const green = ent('Green', { style: { tint: '#2e7d32' } }, [gLeaf]);
    const root = ent('Root', { style: { tint: '#c62828' } }, [green]);
    const map = resolve([root]);
    expect(map.get(gLeaf)?.fill).toBe('#2e7d32');
  });

  it('inherits an explicit stroke to descendants and reports it for lines', () => {
    const child = ent('Child');
    const a = ent('A', { style: { stroke: '#455a64' } }, [child]);
    const map = resolve([a]);
    expect(map.get(a)?.border).toBe('#455a64');
    expect(map.get(child)?.border).toBe('#455a64');
    expect(map.get(child)?.strokeExplicit).toBe('#455a64');
  });

  it('shades toward a custom shade target (e.g. white for dark themes)', () => {
    const leaf = ent('Leaf');
    const root = ent('Root', { style: { tint: '#204060', shade: 'white' } }, [leaf]);
    const map = resolve([root]);
    expect(map.get(root)?.fill).toContain('white');
  });

  it('merges classDef styles, with bare style winning over class and name', () => {
    const classDefs = new Map<string, StyleProps>([
      ['imp', { fill: '#111', stroke: '#222' }],
    ]);
    const namedStyles = new Map<string, StyleProps>([['A', { fill: '#333' }]]);
    // Bare style overrides name-style fill; class supplies stroke; name loses fill.
    const a = ent('A', { classes: ['imp'], style: { fill: '#999' } });
    const map = resolve([a], { classDefs, namedStyles });
    expect(map.get(a)?.fill).toBe('#999');
    expect(map.get(a)?.border).toBe('#222');
  });

  it('applies class assignments made by name via `class` statements', () => {
    const classDefs = new Map<string, StyleProps>([['hot', { fill: '#f00' }]]);
    const namedClasses = new Map<string, string[]>([['A', ['hot']]]);
    const a = ent('A');
    const map = resolve([a], { classDefs, namedClasses });
    expect(map.get(a)?.fill).toBe('#f00');
  });

  describe('icon', () => {
    it('resolves an entity own icon and does not cascade it to children', () => {
      const child = ent('Child');
      const a = ent('A', { style: { icon: 'lucide:server' } }, [child]);
      const map = resolve([a]);
      expect(map.get(a)?.icon).toBe('lucide:server');
      // Like fill, the icon is per-node — the child starts without one.
      expect(map.get(child)?.icon).toBeUndefined();
    });

    it('follows the same class < name < bare-style precedence as colors', () => {
      const classDefs = new Map<string, StyleProps>([['svc', { icon: 'lucide:box' }]]);
      const namedStyles = new Map<string, StyleProps>([['A', { icon: 'lucide:database' }]]);
      const a = ent('A', { classes: ['svc'], style: { icon: 'lucide:server' } });
      // Bare style wins over the name style, which wins over the class.
      expect(resolve([a], { classDefs, namedStyles }).get(a)?.icon).toBe('lucide:server');
    });
  });

  describe('diagram-root style', () => {
    it('seeds the whole diagram with the root tint, graduated per subtree', () => {
      const leaf = ent('Leaf');
      const root = ent('Root', {}, [leaf]);
      const map = resolve([root], { rootStyle: { tint: 'red' } });
      // Every entity inherits the root tint (a leaf shows it pure) — as if it were
      // declared on each top-level entity.
      expect(map.get(leaf)?.fill).toBe('red');
      expect(map.get(root)?.fill).toContain('color-mix(in srgb, red');
    });

    it('is overridden by a nearer own tint (root default is the outermost layer)', () => {
      const leaf = ent('Leaf');
      const mid = ent('Mid', { style: { tint: '#2e7d32' } }, [leaf]);
      const map = resolve([mid], { rootStyle: { tint: 'red' } });
      // The entity's own tint wins over the diagram default for its subtree.
      expect(map.get(leaf)?.fill).toBe('#2e7d32');
    });

    it('seeds a diagram-wide stroke and shade too', () => {
      const a = ent('A');
      const map = resolve([a], { rootStyle: { stroke: '#123', shade: 'white' } });
      expect(map.get(a)?.border).toBe('#123');
      expect(map.get(a)?.strokeExplicit).toBe('#123');
    });

    it('beats the theme but only where the root style sets a prop', () => {
      const a = ent('A');
      // Root sets tint only; stroke still falls back to the theme.
      const map = resolve([a], { rootStyle: { tint: 'red' } });
      expect(map.get(a)?.fill).toBe('red');
      expect(map.get(a)?.border).toBe(THEME.stroke);
    });
  });

  describe('region', () => {
    const region = (over: Partial<Entity> = {}, children: Entity[] = []): Entity =>
      ent('', { type: 'region', subtype: 'region', ...over }, children);

    it('is transparent by default, never tinted', () => {
      const r = region({}, [ent('Inner')]);
      expect(resolve([r]).get(r)?.fill).toBe('transparent');
    });

    it('paints a flat fill when one is set, still without a gradient', () => {
      const r = region({ style: { fill: '#eef' } }, [ent('A', {}, [ent('B')])]);
      expect(resolve([r]).get(r)?.fill).toBe('#eef');
    });

    it('is invisible to depth: a wrapped actor tints as if unwrapped', () => {
      // parent(actor) > actor alice   vs   parent(actor) > region > actor alice
      const bare = ent('Parent', {}, [ent('Alice')]);
      const wrapped = ent('Parent', {}, [region({}, [ent('Alice')])]);
      const bareFill = resolve([bare]).get(bare)?.fill;
      const wrappedFill = resolve([wrapped]).get(wrapped)?.fill;
      expect(wrappedFill).toBe(bareFill);
    });

    it('threads inherited tint/shade straight through to its children', () => {
      const leaf = ent('Leaf');
      const r = region({}, [leaf]);
      const root = ent('Root', { style: { tint: '#c62828' } }, [r]);
      // Leaf is still a leaf under the tint -> pure tint, unaffected by the region.
      expect(resolve([root]).get(leaf)?.fill).toBe('#c62828');
    });
  });
});
