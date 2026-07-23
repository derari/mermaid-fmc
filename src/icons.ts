import type { IconifyJSON } from '@iconify/types';

// Icon support, self-contained (see README "Icons"). An `icon:pack:name` style
// prop names an icon from a registered Iconify pack; the renderer resolves it to
// inline SVG here and draws it on the node. We own the whole path rather than
// leaning on Mermaid's icon registry, mirroring how the renderer owns its own
// layout/drawing — the only new dependency is `@iconify/utils`, and it is loaded
// lazily (dynamic import) so a diagram with no icons never pulls it in.

// A pack is registered either eagerly (its Iconify JSON in hand) or lazily (a
// loader that fetches it — e.g. from a CDN in the browser). Loaders run once, on
// the first render that actually uses an icon.
export interface IconPack {
  name: string;
  icons?: IconifyJSON;
  loader?: () => Promise<IconifyJSON>;
}

// The inline SVG pieces the renderer needs to build an <svg> element: the icon's
// own `viewBox` and its `body` markup (paths/shapes, colored with `currentColor`
// so it inherits the node's text color).
export interface IconSvg {
  body: string;
  viewBox: string;
}

// Resolved packs, and the not-yet-run loaders. Module-level, matching how the db
// keeps diagram state; consumers register once at startup.
const packs = new Map<string, IconifyJSON>();
const loaders = new Map<string, () => Promise<IconifyJSON>>();

// Registers icon packs for `icon:` props to draw from. Eager packs are available
// immediately; lazy ones are fetched on first use. Re-registering a name replaces
// it. Call before rendering (see the examples' `registerIconPacks([...])`).
export function registerIconPacks(list: IconPack[]): void {
  for (const pack of list) {
    if (pack.icons) {
      packs.set(pack.name, pack.icons);
      loaders.delete(pack.name);
    } else if (pack.loader) {
      loaders.set(pack.name, pack.loader);
    }
  }
}

// Drops all registered packs — used by tests to isolate cases.
export function clearIconPacks(): void {
  packs.clear();
  loaders.clear();
}

// Runs every pending loader once, caching its pack (or warning and dropping it on
// failure so one bad pack never sinks the render). Idempotent: a loader is removed
// as it resolves, so later renders don't refetch.
async function ensureLoaded(): Promise<void> {
  const pending = [...loaders.entries()].map(async ([name, load]) => {
    try {
      packs.set(name, await load());
    } catch (err) {
      console.warn(`fmc: failed to load icon pack "${name}"`, err);
    } finally {
      loaders.delete(name);
    }
  });
  await Promise.all(pending);
}

// Splits an `icon:` value into its pack and icon name (`lucide:server` ->
// `{ pack: 'lucide', name: 'server' }`). A value with no `pack:` prefix can't be
// resolved (we need to know which set to look in), so it returns null.
function parseSpec(spec: string): { pack: string; name: string } | null {
  const i = spec.indexOf(':');
  if (i <= 0 || i >= spec.length - 1) return null;
  return { pack: spec.slice(0, i), name: spec.slice(i + 1) };
}

// Resolves a set of `pack:name` specs to inline SVG, loading any lazy packs first.
// `@iconify/utils` is imported dynamically here (not at module top) so it is only
// pulled in when a diagram actually uses icons. An unknown pack or missing icon is
// warned about and skipped, so it simply doesn't draw rather than failing the render.
export async function resolveIcons(specs: Iterable<string>): Promise<Map<string, IconSvg>> {
  const wanted = [...new Set(specs)];
  const out = new Map<string, IconSvg>();
  if (wanted.length === 0) return out;

  await ensureLoaded();
  const { getIconData, iconToSVG } = await import('@iconify/utils');

  for (const spec of wanted) {
    const parsed = parseSpec(spec);
    if (!parsed) {
      console.warn(`fmc: ignoring icon "${spec}" (expected "pack:name")`);
      continue;
    }
    const pack = packs.get(parsed.pack);
    if (!pack) {
      console.warn(`fmc: icon "${spec}" refers to an unregistered pack "${parsed.pack}"`);
      continue;
    }
    const data = getIconData(pack, parsed.name);
    if (!data) {
      console.warn(`fmc: icon "${parsed.name}" not found in pack "${parsed.pack}"`);
      continue;
    }
    const built = iconToSVG(data);
    out.set(spec, { body: built.body, viewBox: built.attributes.viewBox });
  }
  return out;
}
