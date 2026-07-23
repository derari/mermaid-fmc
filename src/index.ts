import type { ExternalDiagramDefinition } from 'mermaid';

const id = 'fmc';

// Claims any text whose first non-blank content starts with `fmc`.
const detector = (txt: string): boolean => /^\s*fmc/.test(txt);

// Lazily loads the diagram implementation only when an fmc diagram is found,
// so consumers who never use fmc don't pay for it.
const loader = async () => {
  const { diagram } = await import('./diagram.js');
  return { id, diagram };
};

export const fmc: ExternalDiagramDefinition = { id, detector, loader };

// Icon support: register Iconify packs the `icon:` style prop can draw from.
// Re-exported from the entry so consumers `import { registerIconPacks } from
// 'mermaid-fmc'`. It carries no heavy dependency itself — `@iconify/utils` is
// pulled in lazily only when a diagram actually resolves an icon (see icons.ts).
export { registerIconPacks, type IconPack } from './icons.js';

export default fmc;
