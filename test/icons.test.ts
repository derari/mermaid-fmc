import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearIconPacks, registerIconPacks, resolveIcons } from '../src/icons.js';

// A minimal Iconify pack: one square icon whose body uses `currentColor`, plus the
// pack's default 24×24 canvas, so `iconToSVG` produces a "0 0 24 24" viewBox.
const PACK = {
  prefix: 'test',
  icons: { box: { body: '<rect x="2" y="2" width="20" height="20" fill="currentColor"/>' } },
  width: 24,
  height: 24,
};

describe('icons', () => {
  afterEach(() => {
    clearIconPacks();
    vi.restoreAllMocks();
  });

  it('resolves a registered icon to its viewBox and body', async () => {
    registerIconPacks([{ name: 'test', icons: PACK }]);
    const map = await resolveIcons(['test:box']);
    expect(map.get('test:box')).toEqual({
      viewBox: '0 0 24 24',
      body: '<rect x="2" y="2" width="20" height="20" fill="currentColor"/>',
    });
  });

  it('runs a lazy loader once, caching the pack for later renders', async () => {
    const loader = vi.fn().mockResolvedValue(PACK);
    registerIconPacks([{ name: 'test', loader }]);
    expect((await resolveIcons(['test:box'])).has('test:box')).toBe(true);
    expect((await resolveIcons(['test:box'])).has('test:box')).toBe(true);
    // The loader is consumed on first use, so the second render doesn't refetch.
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('skips (with a warning) an unknown pack, a missing icon, and a malformed spec', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerIconPacks([{ name: 'test', icons: PACK }]);
    const map = await resolveIcons(['other:box', 'test:missing', 'noPrefix']);
    expect(map.size).toBe(0);
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it('resolves nothing (and touches no pack) for an empty spec set', async () => {
    const map = await resolveIcons([]);
    expect(map.size).toBe(0);
  });
});
