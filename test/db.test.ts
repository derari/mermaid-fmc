import { beforeEach, describe, expect, it } from 'vitest';
import { type Entity, type EntitySubtype, db, entityLabel, isInvalidConnection } from '../src/db.js';

// A line is meaningful only across the two families (actor <-> storage). The
// predicate keys off the coarse `type`, so subtypes within a family group
// together: an actor-to-pipe line is still actor-to-actor.
describe('isInvalidConnection', () => {
  it('flags a connection whose endpoints share a primary type', () => {
    expect(isInvalidConnection('actor', 'actor')).toBe(true);
    expect(isInvalidConnection('storage', 'storage')).toBe(true);
  });

  it('accepts a connection that crosses the two families', () => {
    expect(isInvalidConnection('actor', 'storage')).toBe(false);
    expect(isInvalidConnection('storage', 'actor')).toBe(false);
  });
});

describe('entityLabel', () => {
  const make = (subtype: EntitySubtype, name: string, label?: string): Entity => ({
    name,
    ...(label !== undefined ? { label } : {}),
    type: 'actor',
    subtype,
    children: [],
  });

  it('defaults a name-as-label subtype to its name', () => {
    for (const subtype of ['actor', 'storage', 'variance', 'queue'] as const) {
      expect(entityLabel(make(subtype, 'Bob'))).toBe('Bob');
    }
  });

  it('defaults connectors and regions to no caption', () => {
    for (const subtype of ['channel', 'pipe', 'region'] as const) {
      expect(entityLabel(make(subtype, 'Wire'))).toBe('');
    }
  });

  it('uses an explicit label over the name', () => {
    expect(entityLabel(make('actor', 'a', 'Alice'))).toBe('Alice');
    expect(entityLabel(make('channel', 'Wire', 'Bus'))).toBe('Bus');
  });

  it('suppresses the caption for an explicit empty label', () => {
    expect(entityLabel(make('actor', 'a', ''))).toBe('');
  });

  it('never draws a caption for a port', () => {
    expect(entityLabel(make('port', 'In'))).toBe('');
  });
});

// The diagram is modelled as a single root container entity; the public getters
// are just views onto it, so "diagram scope" is never a special case.
describe('root entity', () => {
  beforeEach(() => db.clear());

  it('is an unnamed region, and getEntities() is a view of its children', () => {
    const root = db.getRoot();
    expect(root.subtype).toBe('region');
    expect(db.getEntities()).toBe(root.children);
    const a = db.addEntity('A', 'actor'); // no parent -> top level
    expect(root.children).toEqual([a]);
    expect(db.getEntities()).toEqual([a]);
  });

  it('backs the diagram direction with the root entity (default TB)', () => {
    expect(db.getDirection()).toBe('TB');
    db.setDirection('LR'); // no target -> the diagram default
    expect(db.getDirection()).toBe('LR');
    expect(db.getRoot().direction).toBe('LR');
    // A target still sets that entity's own direction, not the diagram default.
    const a = db.addEntity('A', 'actor');
    db.setDirection('RL', a);
    expect(a.direction).toBe('RL');
    expect(db.getDirection()).toBe('LR');
  });

  it('exposes the root entity own style as the diagram-wide default style', () => {
    expect(db.getRootStyle()).toEqual({});
    db.getRoot().style = { tint: 'red' };
    expect(db.getRootStyle()).toEqual({ tint: 'red' });
  });

  it('clear() installs a fresh root (state does not leak between parses)', () => {
    const first = db.getRoot();
    db.addEntity('A', 'actor');
    db.setDirection('LR');
    db.clear();
    expect(db.getRoot()).not.toBe(first);
    expect(db.getEntities()).toEqual([]);
    expect(db.getDirection()).toBe('TB');
    expect(db.getRootStyle()).toEqual({});
  });
});
