import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db.js';
import { parser } from '../src/parser.js';
import { analysePorts } from '../src/portTypes.js';

// Parses a diagram and returns the invalid-flag for every line, in declaration
// order, so a test reads `flags(code)` as the per-line verdict list.
function flags(code: string): boolean[] {
  parser.parse(code);
  const validation = analysePorts(db.getEntities(), db.getLines());
  return db.getLines().map((l) => validation.isInvalidLine(l));
}

describe('port line validation', () => {
  beforeEach(() => db.clear());

  it('validates a plain line by the actor↔storage rule (no ports involved)', () => {
    // A --> B is actor-actor (invalid); A --> S is actor-storage (valid).
    expect(
      flags(['fmc lr', '  actor A', '  actor B', '  storage S', '  A --> B', '  A --> S'].join('\n')),
    ).toEqual([true, false]);
  });

  // Face-type rules below use undirected (`---`) lines to ports so the separate
  // "no arrowhead on a port" rule (tested last) doesn't cloud the outcome.
  describe('face types', () => {
    it('accepts a port that bridges actor (inner) to storage (outer)', () => {
      const code = [
        'fmc lr',
        '  storage DB',
        '  actor Box',
        '    actor Inner',
        '    port P w',
        '    Inner --- P',
        '  DB --- P',
      ].join('\n');
      expect(flags(code)).toEqual([false, false]);
    });

    it('flags every line on a port whose faces carry the same type', () => {
      // Inner actor + outer actor → inner == outer == actor → all invalid.
      const code = [
        'fmc lr',
        '  actor A',
        '  actor Box',
        '    actor Inner',
        '    port P w',
        '    Inner --- P',
        '  A --- P',
      ].join('\n');
      expect(flags(code)).toEqual([true, true]);
    });

    it('accepts a clean two-port pass-through (each port bridges the families)', () => {
      const code = [
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
      ].join('\n');
      // Worker-Out, Data-In, Out-In — all valid.
      expect(flags(code)).toEqual([false, false, false]);
    });

    it('on a mixed face, flags only the lines that clash with the opposite face', () => {
      // P.inner = actor, P.outer = mixed (actor A + storage S). On the mixed outer
      // face a line is invalid iff its far end matches the inner type (actor).
      const code = [
        'fmc lr',
        '  actor A',
        '  storage S',
        '  actor Box',
        '    actor Inner',
        '    port P w',
        '    Inner --- P',
        '  A --- P',
        '  S --- P',
      ].join('\n');
      // Inner-P (inner face, not checked) valid; A-P (actor==inner) invalid;
      // S-P (storage != inner) valid.
      expect(flags(code)).toEqual([false, true, false]);
    });

    it('flags all lines when both faces are mixed', () => {
      const code = [
        'fmc lr',
        '  actor A',
        '  storage S',
        '  actor Box',
        '    actor IA',
        '    storage IS',
        '    port P w',
        '    IA --- P',
        '    IS --- P',
        '  A --- P',
        '  S --- P',
      ].join('\n');
      expect(flags(code)).toEqual([true, true, true, true]);
    });

    it('bridges a port with no inner line from its container family (actor box)', () => {
      // No inner line, but the port's container `Box` is an actor, so the inner face
      // takes `actor` from the wall; the outer storage line then bridges cleanly.
      const code = ['fmc lr', '  storage DB', '  actor Box', '    port P w', '  DB --- P'].join('\n');
      expect(flags(code)).toEqual([false]);
    });

    it('still flags a container-derived inner face that clashes with the outer type', () => {
      // Inner face has no line → takes `actor` from container `Box`. Outer is mixed
      // (actor A + storage S): A clashes with the actor inner (invalid), S bridges it.
      const code = [
        'fmc lr',
        '  actor A',
        '  storage S',
        '  actor Box',
        '    port P w',
        '  A --- P',
        '  S --- P',
      ].join('\n');
      expect(flags(code)).toEqual([true, false]);
    });

    it('leaves a port on a region container empty-faced (no family to inherit)', () => {
      // The container is a region, which lends no family, so the inner face stays
      // `empty` and the outer storage line bridges nothing — invalid.
      const code = [
        'fmc lr',
        '  storage DB',
        '  region Box',
        '    port P w',
        '  DB --- P',
      ].join('\n');
      expect(flags(code)).toEqual([true]);
    });

    it('terminates (no infinite loop) on ports that only reference each other', () => {
      // P1 <-> P2 with no grounded type: both faces resolve to mixed → invalid,
      // and — the point of the test — it returns rather than looping.
      const code = [
        'fmc lr',
        '  actor Box1',
        '    port P1 e',
        '  actor Box2',
        '    port P2 w',
        '  P1 --- P2',
      ].join('\n');
      expect(flags(code)).toEqual([true]);
    });

    it('reads the face from containment: outer actor bridges to inner storage', () => {
      // A port on the inner `Vol` container: `Data` (inside Vol) reaches its inner
      // face, `App` (a sibling of Vol, outside it) reaches its outer face — so the
      // facing is decided by the entity tree, not declaration order.
      const code = [
        'fmc lr',
        '  actor Host',
        '    actor App',
        '    storage Vol',
        '      storage Data',
        '      port In w',
        '      Data --- In',
        '    App --- In',
      ].join('\n');
      // Data-In (inner storage), App-In (outer actor) → In bridges cleanly.
      expect(flags(code)).toEqual([false, false]);
    });
  });

  describe('arrowhead on a port', () => {
    it('flags a `-->` whose target is a port (head lands on the port)', () => {
      // Faces would otherwise validate (actor inner, storage outer) — the head is
      // what makes it invalid.
      const code = [
        'fmc lr',
        '  storage DB',
        '  actor Box',
        '    actor Inner',
        '    port P w',
        '    Inner --- P',
        '  DB --> P',
      ].join('\n');
      // Inner-P valid; DB-->P invalid (head on the port).
      expect(flags(code)).toEqual([false, true]);
    });

    it('flags a `<--` whose source is a port (head lands on the port)', () => {
      const code = [
        'fmc lr',
        '  storage DB',
        '  actor Box',
        '    actor Inner',
        '    port P w',
        '    Inner --- P',
        '  P <-- DB',
      ].join('\n');
      expect(flags(code)).toEqual([false, true]);
    });

    it('allows an arrow pointing AWAY from a port', () => {
      // `-->` with the port as source (head on the storage), and `<--` with the
      // port as target (head on the storage) both keep the head off the port.
      const code = [
        'fmc lr',
        '  storage DB',
        '  actor Box',
        '    actor Inner',
        '    port P w',
        '    Inner --- P',
        '  P --> DB',
      ].join('\n');
      expect(flags(code)).toEqual([false, false]);
    });

    it('flags a directed line between two ports (the head is always on one)', () => {
      const code = [
        'fmc lr',
        '  actor Box',
        '    actor Worker',
        '    port Out e',
        '    Worker --- Out',
        '  storage Store',
        '    storage Data',
        '    port In w',
        '    Data --- In',
        '  Out --> In',
      ].join('\n');
      // Worker-Out, Data-In valid; Out-->In invalid (head on In).
      expect(flags(code)).toEqual([false, false, true]);
    });
  });
});
