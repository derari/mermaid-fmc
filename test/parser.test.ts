import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/db.js';
import { parser } from '../src/parser.js';

describe('fmc parser', () => {
  beforeEach(() => db.clear());

  it('parses a single actor', () => {
    parser.parse('fmc\n  actor Bob');
    expect(db.getEntities()).toEqual([
      { name: 'Bob', type: 'actor', subtype: 'actor', children: [] },
    ]);
  });

  it('parses multiple actors', () => {
    parser.parse('fmc\n  actor Bob\n  actor Alice');
    expect(db.getEntities()).toEqual([
      { name: 'Bob', type: 'actor', subtype: 'actor', children: [] },
      { name: 'Alice', type: 'actor', subtype: 'actor', children: [] },
    ]);
  });

  it('ignores blank lines and comments', () => {
    parser.parse('fmc\n\n  %% a comment\n  actor Bob\n');
    expect(db.getEntities()).toEqual([
      { name: 'Bob', type: 'actor', subtype: 'actor', children: [] },
    ]);
  });

  it('handles multi-word actor names', () => {
    parser.parse('fmc\n  actor Web Server');
    expect(db.getEntities()).toEqual([
      { name: 'Web Server', type: 'actor', subtype: 'actor', children: [] },
    ]);
  });

  it('clears previous state on re-parse', () => {
    parser.parse('fmc\n  actor Bob');
    parser.parse('fmc\n  actor Alice');
    expect(db.getEntities()).toEqual([
      { name: 'Alice', type: 'actor', subtype: 'actor', children: [] },
    ]);
  });

  describe('entity types', () => {
    it('parses each keyword into its type and subtype', () => {
      parser.parse(
        [
          'fmc',
          '  actor A',
          '  storage S',
          '  channel C',
          '  pipe P',
          '  variance V',
        ].join('\n'),
      );
      expect(db.getEntities()).toEqual([
        { name: 'A', type: 'actor', subtype: 'actor', children: [] },
        { name: 'S', type: 'storage', subtype: 'storage', children: [] },
        { name: 'C', type: 'storage', subtype: 'channel', children: [] },
        { name: 'P', type: 'actor', subtype: 'pipe', children: [] },
        { name: 'V', type: 'storage', subtype: 'variance', children: [] },
      ]);
    });

    it('allows connectors without a name', () => {
      parser.parse('fmc\n  channel\n  pipe');
      expect(db.getEntities()).toEqual([
        { name: '', type: 'storage', subtype: 'channel', children: [] },
        { name: '', type: 'actor', subtype: 'pipe', children: [] },
      ]);
    });

    it('lets storage and variance contain children', () => {
      parser.parse(
        ['fmc', '  storage Disk', '    actor Reader', '  variance V', '    actor Inner'].join(
          '\n',
        ),
      );
      expect(db.getEntities()).toEqual([
        {
          name: 'Disk',
          type: 'storage',
          subtype: 'storage',
          children: [
            { name: 'Reader', type: 'actor', subtype: 'actor', children: [] },
          ],
        },
        {
          name: 'V',
          type: 'storage',
          subtype: 'variance',
          children: [
            { name: 'Inner', type: 'actor', subtype: 'actor', children: [] },
          ],
        },
      ]);
    });

    it('parses a queue as a named storage subtype', () => {
      parser.parse('fmc\n  queue Jobs');
      expect(db.getEntities()).toEqual([
        { name: 'Jobs', type: 'storage', subtype: 'queue', children: [] },
      ]);
    });

    it('parses a user as a named actor subtype', () => {
      parser.parse('fmc\n  user Alice');
      expect(db.getEntities()).toEqual([
        { name: 'Alice', type: 'actor', subtype: 'user', children: [] },
      ]);
    });

    it('rejects nesting inside a user', () => {
      expect(() =>
        parser.parse('fmc\n  user U\n    actor Nope'),
      ).toThrow(/user cannot contain nested entities/);
    });

    it('rejects nesting inside a channel', () => {
      expect(() =>
        parser.parse('fmc\n  channel C\n    actor Nope'),
      ).toThrow(/channel cannot contain nested entities/);
    });

    it('rejects nesting inside a pipe', () => {
      expect(() =>
        parser.parse('fmc\n  pipe P\n    actor Nope'),
      ).toThrow(/pipe cannot contain nested entities/);
    });

    it('rejects nesting inside a queue', () => {
      expect(() =>
        parser.parse('fmc\n  queue Q\n    actor Nope'),
      ).toThrow(/queue cannot contain nested entities/);
    });
  });

  describe('multiplicity', () => {
    it('sets `star` multiplicity from a `*` glued to the keyword', () => {
      parser.parse('fmc\n  actor* servers');
      expect(db.getEntities()).toEqual([
        { name: 'servers', type: 'actor', subtype: 'actor', children: [], multiplicity: 'star' },
      ]);
    });

    it('sets `dots` multiplicity from a `...` glued to the keyword', () => {
      parser.parse('fmc\n  actor... servers');
      expect(db.getEntities()).toEqual([
        { name: 'servers', type: 'actor', subtype: 'actor', children: [], multiplicity: 'dots' },
      ]);
    });

    it('leaves multiplicity unset without a marker', () => {
      parser.parse('fmc\n  actor servers');
      expect(db.getEntities()[0].multiplicity).toBeUndefined();
    });

    it('accepts a marker on each full-box family (actor, storage, variance, user)', () => {
      parser.parse('fmc\n  actor* A\n  storage* S\n  variance... V\n  user... U');
      expect(db.getEntities().map((e) => e.multiplicity)).toEqual(['star', 'star', 'dots', 'dots']);
    });

    it('rejects a `*` on any non-shadow family (connector, queue, region, port)', () => {
      expect(() => parser.parse('fmc\n  channel* C')).toThrow(/channel cannot carry a "\*" marker/);
      expect(() => parser.parse('fmc\n  queue* Q')).toThrow(/queue cannot carry a "\*" marker/);
      expect(() => parser.parse('fmc\n  region* R')).toThrow(/region cannot carry a "\*" marker/);
    });

    it('allows `...` on connectors, queue, and region (dots, no shadow)', () => {
      parser.parse('fmc\n  channel... C\n  pipe...\n  request...\n  queue... Q\n  region... R');
      expect(db.getEntities().map((e) => [e.subtype, e.multiplicity])).toEqual([
        ['channel', 'dots'],
        ['pipe', 'dots'],
        ['request', 'dots'],
        ['queue', 'dots'],
        ['region', 'dots'],
      ]);
    });

    it('rejects any marker on a port', () => {
      expect(() => parser.parse('fmc\n  storage S\n    port... P n')).toThrow(
        /port cannot carry a "\.\.\." marker/,
      );
      expect(() => parser.parse('fmc\n  storage S\n    port* P n')).toThrow(
        /port cannot carry a "\*" marker/,
      );
    });

    it('treats a marker not glued to the keyword as part of the name', () => {
      parser.parse('fmc\n  actor a*b');
      expect(db.getEntities()).toEqual([
        { name: 'a*b', type: 'actor', subtype: 'actor', children: [] },
      ]);
    });

    it('marks a container entity as multiplicity too', () => {
      parser.parse('fmc\n  storage* Pool\n    actor Worker');
      const [pool] = db.getEntities();
      expect(pool.multiplicity).toBe('star');
      expect(pool.children).toHaveLength(1);
    });
  });

  describe('labels', () => {
    it('splits a quoted label from the reference name', () => {
      parser.parse('fmc\n  actor bob "Bob the Builder"');
      expect(db.getEntities()).toEqual([
        { name: 'bob', label: 'Bob the Builder', type: 'actor', subtype: 'actor', children: [] },
      ]);
    });

    it('allows a label with no name (unreferenceable entity)', () => {
      parser.parse('fmc\n  actor "Alice"');
      expect(db.getEntities()).toEqual([
        { name: '', label: 'Alice', type: 'actor', subtype: 'actor', children: [] },
      ]);
    });

    it('leaves label undefined when only a bare name is given', () => {
      parser.parse('fmc\n  actor Bob');
      expect(db.getEntities()[0].label).toBeUndefined();
    });

    it('keeps an explicit empty label (suppresses the caption)', () => {
      parser.parse('fmc\n  actor bob ""');
      expect(db.getEntities()).toEqual([
        { name: 'bob', label: '', type: 'actor', subtype: 'actor', children: [] },
      ]);
    });

    it('labels a connector while keeping its name for reference', () => {
      parser.parse('fmc\n  channel Wire "Message Bus"');
      expect(db.getEntities()).toEqual([
        { name: 'Wire', label: 'Message Bus', type: 'storage', subtype: 'channel', children: [] },
      ]);
    });

    it('reads a region label ahead of its trailing direction', () => {
      parser.parse('fmc\n  region grp "My Group" LR\n    actor A');
      const [region] = db.getEntities();
      expect(region.name).toBe('grp');
      expect(region.label).toBe('My Group');
      expect(region.direction).toBe('LR');
    });

    it('unescapes an escaped quote inside a label', () => {
      parser.parse('fmc\n  actor a "say \\"hi\\""');
      expect(db.getEntities()[0].label).toBe('say "hi"');
    });

    it('combines a label with inline ::: classes', () => {
      parser.parse('fmc\n  actor a "Alice":::hot');
      const [a] = db.getEntities();
      expect(a.name).toBe('a');
      expect(a.label).toBe('Alice');
      expect(a.classes).toEqual(['hot']);
    });

    it('rejects a label on a port', () => {
      expect(() => parser.parse('fmc\n  actor Box\n    port In "x" w')).toThrow(
        /a port cannot have a label/,
      );
    });
  });

  describe('port', () => {
    it('parses a named port with a trailing direction', () => {
      parser.parse('fmc\n  actor Box\n    port In w');
      const [box] = db.getEntities();
      expect(box.children).toEqual([
        { name: 'In', type: 'port', subtype: 'port', children: [], portSide: 'w' },
      ]);
    });

    it('parses an unnamed port (direction only)', () => {
      parser.parse('fmc\n  actor Box\n    port e');
      const [box] = db.getEntities();
      expect(box.children[0]).toMatchObject({ name: '', subtype: 'port', portSide: 'e' });
    });

    it('keeps a multi-word name and reads the trailing direction after it', () => {
      parser.parse('fmc\n  actor Box\n    port Data Out s');
      const [box] = db.getEntities();
      expect(box.children[0]).toMatchObject({ name: 'Data Out', subtype: 'port', portSide: 's' });
    });

    it('accepts compass words and is case-insensitive on the direction', () => {
      parser.parse(
        ['fmc', '  actor Box', '    port A NORTH', '    port B East', '    port C south'].join('\n'),
      );
      const [box] = db.getEntities();
      expect(box.children.map((c) => c.portSide)).toEqual(['n', 'e', 's']);
    });

    it('rejects a port at the diagram root', () => {
      expect(() => parser.parse('fmc\n  port e')).toThrow(/cannot be declared at the diagram root/);
    });

    it('rejects a port with no direction', () => {
      expect(() => parser.parse('fmc\n  actor Box\n    port In')).toThrow(
        /a port needs a trailing direction/,
      );
    });

    it('rejects nesting inside a port', () => {
      expect(() => parser.parse('fmc\n  actor Box\n    port In w\n      actor Nope')).toThrow(
        /port cannot contain nested entities/,
      );
    });

    it('rejects a port nested inside a port (a port has no box to pin to)', () => {
      expect(() => parser.parse('fmc\n  actor Box\n    port In w\n      port Deep n')).toThrow(
        /port cannot contain ports/,
      );
    });

    // A `port` is an edge anchor, not a nested box, so the otherwise-childless
    // leaves (connectors, queue, user) may carry ports even though they reject
    // every other child.
    for (const parent of ['queue Q', 'channel C', 'pipe P', 'user U', 'request R']) {
      const kind = parent.split(' ')[0];
      it(`allows a port on a childless ${kind}`, () => {
        parser.parse(['fmc', `  ${parent}`, '    port Out e'].join('\n'));
        const [box] = db.getEntities();
        expect(box.children).toEqual([
          { name: 'Out', type: 'port', subtype: 'port', children: [], portSide: 'e' },
        ]);
      });

      it(`still rejects a non-port child on a childless ${kind}`, () => {
        expect(() => parser.parse(['fmc', `  ${parent}`, '    actor Nope'].join('\n'))).toThrow(
          new RegExp(`${kind} cannot contain nested entities`),
        );
      });
    }

    it('lets a line reference a port by name', () => {
      parser.parse(
        ['fmc', '  actor A', '  actor Box', '    port In w', '  A --> In'].join('\n'),
      );
      expect(db.getLines()).toEqual([{ source: 'A', target: 'In', type: '-->' }]);
    });

    it('lets a relative line take a port as its enclosing endpoint', () => {
      parser.parse(['fmc', '  actor Box', '    port Out e', '      Inner -->'].join('\n'));
      const port = db.getEntities()[0].children[0];
      expect(port.subtype).toBe('port');
      expect(db.getLines()).toEqual([
        { source: 'Inner', target: port, type: '-->', container: port },
      ]);
    });
  });

  describe('request', () => {
    it('parses a bare request (no name, no orientation)', () => {
      parser.parse('fmc\n  request');
      expect(db.getEntities()).toEqual([
        { name: '', type: 'storage', subtype: 'request', children: [] },
      ]);
    });

    it('parses a name with a trailing orientation', () => {
      parser.parse('fmc\n  request Fetch n');
      expect(db.getEntities()).toEqual([
        { name: 'Fetch', type: 'storage', subtype: 'request', children: [], requestDir: 'n' },
      ]);
    });

    it('accepts compass words and is case-insensitive on the orientation', () => {
      parser.parse(['fmc', '  request A NORTH', '  request B East', '  request C south'].join('\n'));
      expect(db.getEntities().map((e) => e.requestDir)).toEqual(['n', 'e', 's']);
    });

    it('reads the last token as the orientation when ambiguous, keeping the rest as the name', () => {
      parser.parse('fmc\n  request wild wild west');
      const [r] = db.getEntities();
      expect(r).toMatchObject({ name: 'wild wild', subtype: 'request', requestDir: 'w' });
    });

    it('leaves a non-orientation last token as part of the name (arrow defaults to auto)', () => {
      parser.parse('fmc\n  request Get Order');
      const [r] = db.getEntities();
      expect(r.name).toBe('Get Order');
      expect(r.requestDir).toBeUndefined();
    });

    it('treats an explicit auto/?/> orientation as the default (no stored direction)', () => {
      parser.parse('fmc\n  request Poll auto\n  request Push ?\n  request Down >');
      const [poll, push, down] = db.getEntities();
      expect(poll).toMatchObject({ name: 'Poll' });
      expect(poll.requestDir).toBeUndefined();
      expect(push).toMatchObject({ name: 'Push' });
      expect(push.requestDir).toBeUndefined();
      expect(down).toMatchObject({ name: 'Down' });
      expect(down.requestDir).toBeUndefined();
    });

    it('stores the back orientation, accepting the < alias', () => {
      parser.parse('fmc\n  request Undo back\n  request Redo <');
      const [undo, redo] = db.getEntities();
      expect(undo).toMatchObject({ name: 'Undo', subtype: 'request', requestDir: 'back' });
      expect(redo).toMatchObject({ name: 'Redo', subtype: 'request', requestDir: 'back' });
    });

    it('takes a quoted label, with the orientation after it', () => {
      parser.parse('fmc\n  request Fetch "Get user" e');
      expect(db.getEntities()).toEqual([
        {
          name: 'Fetch',
          label: 'Get user',
          type: 'storage',
          subtype: 'request',
          children: [],
          requestDir: 'e',
        },
      ]);
    });

    it('rejects nesting inside a request', () => {
      expect(() => parser.parse('fmc\n  request R n\n    actor Nope')).toThrow(
        /request cannot contain nested entities/,
      );
    });
  });

  describe('nesting', () => {
    it('nests actors by indentation', () => {
      parser.parse(
        ['fmc', '  actor Bob', '    actor Alice', '    actor Carol', '  actor Eve', '    actor Mallory'].join('\n'),
      );
      expect(db.getEntities()).toEqual([
        {
          name: 'Bob',
          type: 'actor',
          subtype: 'actor',
          children: [
            { name: 'Alice', type: 'actor', subtype: 'actor', children: [] },
            { name: 'Carol', type: 'actor', subtype: 'actor', children: [] },
          ],
        },
        {
          name: 'Eve',
          type: 'actor',
          subtype: 'actor',
          children: [
            { name: 'Mallory', type: 'actor', subtype: 'actor', children: [] },
          ],
        },
      ]);
    });

    it('supports multiple levels of nesting', () => {
      parser.parse(
        ['fmc', '  actor A', '    actor B', '      actor C'].join('\n'),
      );
      expect(db.getEntities()).toEqual([
        {
          name: 'A',
          type: 'actor',
          subtype: 'actor',
          children: [
            {
              name: 'B',
              type: 'actor',
              subtype: 'actor',
              children: [
                { name: 'C', type: 'actor', subtype: 'actor', children: [] },
              ],
            },
          ],
        },
      ]);
    });

    it('handles dedent back to an outer level', () => {
      parser.parse(
        ['fmc', '  actor A', '    actor B', '  actor C'].join('\n'),
      );
      expect(db.getEntities()).toEqual([
        {
          name: 'A',
          type: 'actor',
          subtype: 'actor',
          children: [
            { name: 'B', type: 'actor', subtype: 'actor', children: [] },
          ],
        },
        { name: 'C', type: 'actor', subtype: 'actor', children: [] },
      ]);
    });
  });

  describe('lines', () => {
    it('parses an absolute line as a name-to-name connection', () => {
      parser.parse(['fmc', '  actor A', '  actor B', '  A --> B'].join('\n'));
      expect(db.getLines()).toEqual([{ source: 'A', target: 'B', type: '-->' }]);
    });

    it('reads each connector type', () => {
      parser.parse(
        ['fmc', '  actor A', '  actor B', '  A --- B', '  A --> B', '  A <-- B'].join('\n'),
      );
      expect(db.getLines()).toEqual([
        { source: 'A', target: 'B', type: '---' },
        { source: 'A', target: 'B', type: '-->' },
        { source: 'A', target: 'B', type: '<--' },
      ]);
    });

    it('accepts connectors of any dash length', () => {
      parser.parse(
        [
          'fmc',
          '  actor A',
          '  actor B',
          '  A - B',
          '  A ---------- B',
          '  A -> B',
          '  A ----------> B',
          '  A <- B',
          '  A <---------- B',
        ].join('\n'),
      );
      expect(db.getLines()).toEqual([
        { source: 'A', target: 'B', type: '---' },
        { source: 'A', target: 'B', type: '---' },
        { source: 'A', target: 'B', type: '-->' },
        { source: 'A', target: 'B', type: '-->' },
        { source: 'A', target: 'B', type: '<--' },
        { source: 'A', target: 'B', type: '<--' },
      ]);
    });

    it('rejects broken arrows (`-<`, `>-`, `<-->`)', () => {
      parser.parse(
        ['fmc', '  actor A', '  actor B', '  A -< B', '  A >- B', '  A <--> B'].join('\n'),
      );
      expect(db.getLines()).toEqual([]);
    });

    it('requires whitespace flanking the connector (a hyphen in a name is safe)', () => {
      // No spaces around the dashes -> not a line; `foo-bar` stays a stray token.
      parser.parse(['fmc', '  actor foo-bar', '  actor A', '  A-->foo-bar'].join('\n'));
      expect(db.getLines()).toEqual([]);
    });

    it('keeps multi-word endpoint names intact', () => {
      parser.parse(['fmc', '  actor Web Server', '  Web Server --> Data Store'].join('\n'));
      expect(db.getLines()).toEqual([
        { source: 'Web Server', target: 'Data Store', type: '-->' },
      ]);
    });

    it('is oblivious to where an absolute line sits', () => {
      // Nested three levels deep, yet still a plain top-level connection.
      parser.parse(
        ['fmc', '  actor A', '    actor B', '      X --> Y'].join('\n'),
      );
      expect(db.getLines()).toEqual([{ source: 'X', target: 'Y', type: '-->' }]);
    });

    it('takes a relative line\'s source from its enclosing entity', () => {
      parser.parse(['fmc', '  actor A', '    --> B'].join('\n'));
      const [a] = db.getEntities();
      // A relative line records the enclosing entity as its stroke container.
      expect(db.getLines()).toEqual([{ source: a, target: 'B', type: '-->', container: a }]);
    });

    it('lets an unnamed connector be a relative source', () => {
      parser.parse(['fmc', '  channel', '    --> Store'].join('\n'));
      const [channel] = db.getEntities();
      expect(db.getLines()).toEqual([
        { source: channel, target: 'Store', type: '-->', container: channel },
      ]);
    });

    it('takes a trailing line\'s target from its enclosing entity', () => {
      // `A -->` omits entity2, so the enclosing entity becomes the target.
      parser.parse(['fmc', '  channel', '    Producer -->'].join('\n'));
      const [channel] = db.getEntities();
      expect(db.getLines()).toEqual([
        { source: 'Producer', target: channel, type: '-->', container: channel },
      ]);
    });

    it('wires an unnamed connector from both sides with omitted endpoints', () => {
      parser.parse(
        [
          'fmc',
          '  actor Producer',
          '  channel',
          '    Producer -->',
          '    --> Consumer',
          '  actor Consumer',
        ].join('\n'),
      );
      const channel = db.getEntities()[1];
      expect(channel.subtype).toBe('channel');
      expect(db.getLines()).toEqual([
        { source: 'Producer', target: channel, type: '-->', container: channel },
        { source: channel, target: 'Consumer', type: '-->', container: channel },
      ]);
    });

    it('rejects a trailing line with no enclosing entity', () => {
      expect(() => parser.parse('fmc\n  A -->')).toThrow(/needs an enclosing entity/);
    });

    it('still reads an absolute line (both endpoints named)', () => {
      parser.parse(['fmc', '  actor A', '  storage B', '  A --> B'].join('\n'));
      expect(db.getLines()).toEqual([{ source: 'A', target: 'B', type: '-->' }]);
    });

    it('binds a relative line to the nearest enclosing entity on dedent', () => {
      parser.parse(
        ['fmc', '  actor A', '    actor B', '    --> C'].join('\n'),
      );
      const [a] = db.getEntities();
      expect(db.getLines()).toEqual([{ source: a, target: 'C', type: '-->', container: a }]);
    });

    it('rejects a relative line with no enclosing entity', () => {
      expect(() => parser.parse('fmc\n  --> B')).toThrow(/needs an enclosing entity/);
    });

    it('does not confuse an actor keyword line for a connection', () => {
      parser.parse('fmc\n  actor A');
      expect(db.getLines()).toEqual([]);
    });

    it('lets an absolute line target a named connector', () => {
      // The connector keeps its name (undrawn) so lines can pick it out.
      parser.parse(
        ['fmc', '  actor Client', '  channel Wire', '  Client --> Wire'].join('\n'),
      );
      expect(db.getEntities()).toContainEqual({
        name: 'Wire',
        type: 'storage',
        subtype: 'channel',
        children: [],
      });
      expect(db.getLines()).toEqual([
        { source: 'Client', target: 'Wire', type: '-->' },
      ]);
    });
  });

  describe('complex lines', () => {
    it('inserts a channel between the endpoints and wires both sides', () => {
      parser.parse(
        ['fmc', '  actor A', '  storage S', '  A --> o --> S'].join('\n'),
      );
      const [a, connector, s] = db.getEntities();
      expect(db.getEntities().map((e) => e.subtype)).toEqual(['actor', 'channel', 'storage']);
      expect(connector.name).toBe('');
      expect(db.getLines()).toEqual([
        { source: a, target: connector, type: '-->' },
        { source: connector, target: s, type: '-->' },
      ]);
    });

    it('uses a pipe for the | glyph', () => {
      parser.parse(
        ['fmc', '  storage A', '  storage B', '  A --- | --- B'].join('\n'),
      );
      expect(db.getEntities().map((e) => e.subtype)).toEqual(['storage', 'pipe', 'storage']);
    });

    it('inserts an unlabelled queue for the q glyph', () => {
      parser.parse(['fmc', '  actor A', '  storage S', '  A --> q --> S'].join('\n'));
      const [, queue] = db.getEntities();
      expect(db.getEntities().map((e) => e.subtype)).toEqual(['actor', 'queue', 'storage']);
      expect(queue.name).toBe('');
      expect(queue.label).toBeUndefined();
    });

    it('inserts a request for the r glyph (auto direction)', () => {
      parser.parse(['fmc', '  actor A', '  storage S', '  A --> r --> S'].join('\n'));
      const [, req] = db.getEntities();
      expect(db.getEntities().map((e) => e.subtype)).toEqual(['actor', 'request', 'storage']);
      expect(req.requestDir).toBeUndefined();
    });

    it('reads a one-char orientation on the r glyph', () => {
      parser.parse(
        [
          'fmc',
          '  actor A',
          '  storage S',
          '  A --> rn --> S',
          '  A --> re --> S',
          '  A --> rs --> S',
          '  A --> rw --> S',
          '  A --> r> --> S',
        ].join('\n'),
      );
      const requests = db.getEntities().filter((e) => e.subtype === 'request');
      // rn/re/rs/rw fix a side; r> is auto (undefined), like a bare r.
      expect(requests.map((r) => r.requestDir)).toEqual(['n', 'e', 's', 'w', undefined]);
    });

    it('treats r< and <r as the same back request', () => {
      // Both spell a back-pointing request; reused as one shared connector here.
      parser.parse(
        ['fmc', '  actor A', '  storage S', '  A --> r< --> S', '  A --> <r --> S'].join('\n'),
      );
      const requests = db.getEntities().filter((e) => e.subtype === 'request');
      expect(requests).toHaveLength(1);
      expect(requests[0].requestDir).toBe('back');
    });

    it('lets a multi-char glyph hug its arrows', () => {
      // The arrow-boundary check agrees with the glyph scanner, so `rn` hugs too.
      parser.parse(['fmc', '  actor A', '  storage S', '  A -->rn--> S'].join('\n'));
      const [, req] = db.getEntities();
      expect(db.getEntities().map((e) => e.subtype)).toEqual(['actor', 'request', 'storage']);
      expect(req.requestDir).toBe('n');
    });

    it('still rejects the broken `<-->` arrow (a lone < is not a glyph)', () => {
      parser.parse(['fmc', '  actor A', '  storage B', '  A <--> B'].join('\n'));
      expect(db.getLines()).toEqual([]);
    });

    it('is case-insensitive on connector glyphs', () => {
      parser.parse(
        [
          'fmc',
          '  actor A',
          '  storage S',
          '  A --> O --> S',
          '  A --> Q --> S',
          '  A --> RN --> S',
        ].join('\n'),
      );
      const subtypes = db.getEntities().filter((e) => e.type !== 'actor' && e.subtype !== 'storage');
      expect(db.getEntities().map((e) => e.subtype)).toContain('channel');
      expect(db.getEntities().map((e) => e.subtype)).toContain('queue');
      const req = db.getEntities().find((e) => e.subtype === 'request');
      expect(req?.requestDir).toBe('n');
    });

    it('does not mistake a name starting with a glyph letter for a glyph', () => {
      // `router` interior would be the glyph `r` only if `outer` were a boundary;
      // it is not, so the chain reads `router` as a plain named entity.
      parser.parse(['fmc', '  actor A', '  storage router', '  actor B', '  A --> router --> B'].join('\n'));
      const [, mid] = db.getEntities();
      expect(mid.subtype).toBe('storage');
      expect(mid.name).toBe('router');
    });

    it('keeps whitespace around the connector glyph optional', () => {
      // Arrows still need a space to the entities, but the glyph may hug them.
      parser.parse(['fmc', '  actor A', '  storage S', '  A -->o--> S'].join('\n'));
      const [a, connector, s] = db.getEntities();
      expect(db.getEntities().map((e) => e.subtype)).toEqual(['actor', 'channel', 'storage']);
      expect(db.getLines()).toEqual([
        { source: a, target: connector, type: '-->' },
        { source: connector, target: s, type: '-->' },
      ]);
    });

    it('keeps each arrow independent', () => {
      parser.parse(
        ['fmc', '  actor A', '  actor B', '  A --> o <-- B'].join('\n'),
      );
      const lines = db.getLines();
      expect(lines.map((l) => l.type)).toEqual(['-->', '<--']);
    });

    it('takes a relative complex line\'s source from the enclosing entity', () => {
      parser.parse(
        ['fmc', '  actor Client', '    --> o --> Server', '  storage Server'].join('\n'),
      );
      const client = db.getEntities()[0];
      const lines = db.getLines();
      expect(lines[0].source).toBe(client);
      // The channel is the second endpoint of the first line and source of the next.
      expect(lines[0].target).toBe(lines[1].source);
      expect((lines[1].source as { subtype: string }).subtype).toBe('channel');
    });

    it('rejects a relative complex line with no enclosing entity', () => {
      expect(() => parser.parse('fmc\n  --> o --> B')).toThrow(/needs an enclosing entity/);
    });

    it('reuses one connector across complex lines to the same target', () => {
      parser.parse(
        [
          'fmc',
          '  actor A',
          '  actor B',
          '  actor Hub',
          '  A --> o --> Hub',
          '  B --> o --> Hub',
        ].join('\n'),
      );
      expect(db.getEntities().filter((e) => e.subtype === 'channel')).toHaveLength(1);
      // Two segments for the first line, one shared first segment for the second.
      expect(db.getLines()).toHaveLength(3);
    });

    it('lets a trailing complex line omit entity2 (enclosing entity)', () => {
      // `A --> o -->` nested under Box makes Box the second endpoint.
      parser.parse(
        ['fmc', '  actor A', '  storage Box', '    A --> o -->'].join('\n'),
      );
      // A channel was inserted somewhere and two lines were generated.
      const subtypes = db.getEntities().flatMap((e) => [e.subtype, ...e.children.map((c) => c.subtype)]);
      expect(subtypes).toContain('channel');
      expect(db.getLines()).toHaveLength(2);
    });

    it('does not mistake a plain line to an entity named "o" for a complex line', () => {
      parser.parse(['fmc', '  actor A', '  storage o', '  A --> o'].join('\n'));
      expect(db.getEntities().map((e) => e.subtype)).toEqual(['actor', 'storage']);
      expect(db.getLines()).toEqual([{ source: 'A', target: 'o', type: '-->' }]);
    });

    it('threads a chain through a named entity with no glyph', () => {
      parser.parse(
        ['fmc', '  actor Actor', '  pipe P1', '  storage Storage', '  Actor --- P1 --- Storage'].join('\n'),
      );
      const [actor, p1, storage] = db.getEntities();
      // No connector is inserted — every node is a real named entity.
      expect(db.getEntities().map((e) => e.subtype)).toEqual(['actor', 'pipe', 'storage']);
      expect(db.getLines()).toEqual([
        { source: actor, target: p1, type: '---' },
        { source: p1, target: storage, type: '---' },
      ]);
    });

    it('places no limit on the number of segments and mixes names with glyphs', () => {
      parser.parse(
        [
          'fmc',
          '  actor Actor',
          '  pipe P1',
          '  pipe P2',
          '  storage Storage',
          '  Actor --- P1 --- o --- P2 --- | --- Storage',
        ].join('\n'),
      );
      // The two glyphs become a channel and a pipe, inserted around the named
      // pipes; the named entities are threaded through untouched.
      expect(db.getEntities().map((e) => e.subtype)).toEqual([
        'actor',
        'pipe',
        'channel',
        'pipe',
        'pipe',
        'storage',
      ]);
      const lines = db.getLines();
      expect(lines).toHaveLength(5);
      expect(lines.map((l) => l.type)).toEqual(['---', '---', '---', '---', '---']);
    });

    it('keeps the final arrow direction on a chain ending in an entity', () => {
      parser.parse(
        [
          'fmc',
          '  actor Actor',
          '  actor Actor2',
          '  pipe P1',
          '  storage Storage',
          '  Actor --- P1 --- | --- Storage --> Actor2',
        ].join('\n'),
      );
      const lines = db.getLines();
      expect(lines).toHaveLength(4);
      // The trailing `-->` survives as the last segment's direction.
      expect(lines[lines.length - 1].type).toBe('-->');
    });
  });

  describe('styling', () => {
    it('parses classDef into a named style bag', () => {
      parser.parse('fmc\n  classDef hot fill:#f00 stroke:#900\n  actor A');
      expect(db.getClassDefs().get('hot')).toEqual({ fill: '#f00', stroke: '#900' });
    });

    it('attaches inline ::: classes to the entity declaration', () => {
      parser.parse('fmc\n  actor Web Server:::hot cold');
      const [a] = db.getEntities();
      expect(a.name).toBe('Web Server');
      expect(a.classes).toEqual(['hot', 'cold']);
    });

    it('assigns a class to comma-separated names via `class`', () => {
      parser.parse('fmc\n  actor A\n  actor B\n  class A, B hot');
      expect(db.getNamedClasses().get('A')).toEqual(['hot']);
      expect(db.getNamedClasses().get('B')).toEqual(['hot']);
    });

    it('styles all nodes of a name via `style <name> <props>`', () => {
      parser.parse('fmc\n  actor Web Server\n  style Web Server tint:#c62828 stroke:#333');
      expect(db.getNamedStyles().get('Web Server')).toEqual({
        tint: '#c62828',
        stroke: '#333',
      });
    });

    it('applies a bare `style` to the entity it is nested under', () => {
      parser.parse('fmc\n  actor A\n    style fill:#eee\n    actor B');
      const [a] = db.getEntities();
      expect(a.style).toEqual({ fill: '#eee' });
      expect(a.children[0].style).toBeUndefined();
    });

    it('applies a bare `style` nested under a line to that line', () => {
      parser.parse('fmc\n  actor A\n  storage B\n  A --> B\n    style stroke:#f00');
      const line = db.getLines()[0];
      expect(line.style).toEqual({ stroke: '#f00' });
    });

    it('carries a complex line style onto the connector and both segments', () => {
      parser.parse(
        ['fmc', '  actor A', '  actor B', '  A --> o --> B', '    style stroke:#333 fill:#eee'].join(
          '\n',
        ),
      );
      const connector = db.getEntities().find((e) => e.subtype === 'channel');
      expect(connector?.style).toEqual({ stroke: '#333', fill: '#eee' });
      for (const line of db.getLines()) {
        expect(line.style).toEqual({ stroke: '#333', fill: '#eee' });
      }
    });

    it('accepts whitespace-free rgb()/hsl() color values', () => {
      parser.parse('fmc\n  actor A\n  style A fill:rgb(255,0,0) tint:hsl(9,100%,64%)');
      expect(db.getNamedStyles().get('A')).toEqual({
        fill: 'rgb(255,0,0)',
        tint: 'hsl(9,100%,64%)',
      });
    });

    it('splits props on commas and semicolons as well as whitespace', () => {
      parser.parse('fmc\n  classDef hot fill:#f00, stroke:#900; tint:#f88\n  actor A');
      expect(db.getClassDefs().get('hot')).toEqual({
        fill: '#f00',
        stroke: '#900',
        tint: '#f88',
      });
    });

    it('keeps spaces and commas inside a color value', () => {
      parser.parse('fmc\n  actor A\n  style A fill:rgb(255, 0, 0) stroke:#000');
      expect(db.getNamedStyles().get('A')).toEqual({
        fill: 'rgb(255, 0, 0)',
        stroke: '#000',
      });
    });

    it('parses `icon` as a style prop, keeping its pack:name value intact', () => {
      parser.parse('fmc\n  actor Web\n  style Web icon:lucide:server tint:#f00');
      expect(db.getNamedStyles().get('Web')).toEqual({
        icon: 'lucide:server',
        tint: '#f00',
      });
    });

    it('carries `icon` through classDef + inline :::', () => {
      parser.parse('fmc\n  classDef svc icon:lucide:database\n  storage db:::svc');
      expect(db.getClassDefs().get('svc')).toEqual({ icon: 'lucide:database' });
      expect(db.getEntities()[0].classes).toEqual(['svc']);
    });

    it('parses `icon-size` keywords into a numeric factor', () => {
      const factor = (v: string): number | undefined => {
        parser.parse(`fmc\n  actor A\n  style A icon-size:${v}`);
        return db.getNamedStyles().get('A')?.iconSize;
      };
      expect(factor('auto')).toBe(0);
      expect(factor('?')).toBe(0);
      expect(factor('S')).toBe(1); // case-insensitive
      expect(factor('m')).toBe(2);
      expect(factor('l')).toBe(3);
      expect(factor('xl')).toBe(4);
      expect(factor('xxxl')).toBe(6); // one +1 per leading x
      expect(factor('1.5')).toBe(1.5);
      expect(factor('.7')).toBe(0.7);
    });

    it('drops an invalid `icon-size` but keeps the sibling props', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      parser.parse('fmc\n  actor A\n  style A icon-size:huge stroke:#000');
      expect(db.getNamedStyles().get('A')).toEqual({ stroke: '#000' });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('icon-size:huge'));
      warn.mockRestore();
    });

    it('parses `icon-size` alongside `icon` in one statement', () => {
      parser.parse('fmc\n  actor A\n  style A icon:lucide:server icon-size:xxl');
      expect(db.getNamedStyles().get('A')).toEqual({ icon: 'lucide:server', iconSize: 5 });
    });

    it('separates a multi-word name from props with an internal-comma value', () => {
      parser.parse('fmc\n  actor Web Server\n  style Web Server fill:rgb(1, 2, 3), stroke:#333');
      expect(db.getNamedStyles().get('Web Server')).toEqual({
        fill: 'rgb(1, 2, 3)',
        stroke: '#333',
      });
    });

    it('does not treat a line from an entity named "style" as a style statement', () => {
      parser.parse('fmc\n  actor style\n  storage B\n  style --> B');
      expect(db.getLines()).toEqual([{ source: 'style', target: 'B', type: '-->' }]);
    });

    it('records a bare `style` at the diagram root as a diagram-wide default', () => {
      // At indent 2 the `style` is a sibling of the entities, i.e. at diagram
      // scope — like a root-level `route`, it sets a diagram-wide default rather
      // than attaching to an entity.
      parser.parse('fmc\n  actor A\n  style tint:red stroke:#333');
      expect(db.getRootStyle()).toEqual({ tint: 'red', stroke: '#333' });
      // It is a default, not an entity style: the entity itself carries none.
      expect(db.getEntities()[0].style).toBeUndefined();
    });

    it('merges several diagram-root `style` statements, last value winning', () => {
      parser.parse('fmc\n  style tint:red\n  actor A\n  style tint:blue shade:white');
      expect(db.getRootStyle()).toEqual({ tint: 'blue', shade: 'white' });
    });

    it('does not warn on a bare `style` at the diagram root', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      parser.parse('fmc\n  actor A\n  style tint:red');
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  describe('route', () => {
    it('attaches a route spec to the line it is nested under', () => {
      parser.parse(
        ['fmc', '  actor A', '  storage B', '  A --> B', '    route exit:s depth:2 bend:z'].join('\n'),
      );
      const line = db.getLines()[0];
      expect(line.routing).toEqual({ exit: 's', depth: 2, bend: 'z' });
    });

    it('leaves routing undefined on lines without a route', () => {
      parser.parse(['fmc', '  actor A', '  storage B', '  A --> B'].join('\n'));
      expect(db.getLines()[0].routing).toBeUndefined();
    });

    it('accepts each side and auto for exit', () => {
      for (const exit of ['n', 'e', 's', 'w', 'auto'] as const) {
        db.clear();
        parser.parse(['fmc', '  actor A', '  storage B', '  A --> B', `    route exit:${exit}`].join('\n'));
        expect(db.getLines()[0].routing).toEqual({ exit });
      }
    });

    it('accepts each side and auto for enter', () => {
      for (const enter of ['n', 'e', 's', 'w', 'auto'] as const) {
        db.clear();
        parser.parse(['fmc', '  actor A', '  storage B', '  A --> B', `    route enter:${enter}`].join('\n'));
        expect(db.getLines()[0].routing).toEqual({ enter });
      }
    });

    it('accepts exit and enter together', () => {
      parser.parse(['fmc', '  actor A', '  storage B', '  A --> B', '    route exit:s enter:e'].join('\n'));
      expect(db.getLines()[0].routing).toEqual({ exit: 's', enter: 'e' });
    });

    it('accepts auto for depth and an integer >= 0', () => {
      parser.parse(['fmc', '  actor A', '  storage B', '  A --> B', '    route depth:0'].join('\n'));
      expect(db.getLines()[0].routing).toEqual({ depth: 0 });
      db.clear();
      parser.parse(['fmc', '  actor A', '  storage B', '  A --> B', '    route depth:auto'].join('\n'));
      expect(db.getLines()[0].routing).toEqual({ depth: 'auto' });
    });

    it('drops an unknown side with a warning but keeps valid keys', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      parser.parse(
        ['fmc', '  actor A', '  storage B', '  A --> B', '    route exit:x bend:n'].join('\n'),
      );
      expect(db.getLines()[0].routing).toEqual({ bend: 'n' });
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it('drops a non-integer / negative depth with a warning', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      parser.parse(
        ['fmc', '  actor A', '  storage B', '  A --> B', '    route depth:1.5 exit:e'].join('\n'),
      );
      expect(db.getLines()[0].routing).toEqual({ exit: 'e' });
      db.clear();
      parser.parse(['fmc', '  actor A', '  storage B', '  A --> B', '    route depth:-1'].join('\n'));
      expect(db.getLines()[0].routing).toBeUndefined();
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it('drops an unknown route key with a warning', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      parser.parse(
        ['fmc', '  actor A', '  storage B', '  A --> B', '    route wobble:9 exit:n'].join('\n'),
      );
      expect(db.getLines()[0].routing).toEqual({ exit: 'n' });
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it('applies a diagram-root route as a default for every line', () => {
      // At indent 2 the `route` is a sibling of the entities, i.e. at diagram scope.
      parser.parse(
        ['fmc', '  actor A', '  storage B', '  storage C', '  A --> B', '  A --> C', '  route exit:s depth:2'].join('\n'),
      );
      const lines = db.getLines();
      expect(lines).toHaveLength(2);
      for (const line of lines) {
        expect(line.routing).toEqual({ exit: 's', depth: 2 });
      }
    });

    it("lets a line's own and an entity's route win per key over a diagram-root route", () => {
      parser.parse(
        [
          'fmc',
          '  route exit:s depth:2 bend:z',
          '  storage B',
          '  region G',
          '    route depth:1',
          '    actor A',
          '    A --> B',
          '      route exit:e',
        ].join('\n'),
      );
      // exit from the line, depth from the entity, bend from the diagram root.
      expect(db.getLines()[0].routing).toEqual({ exit: 'e', depth: 1, bend: 'z' });
    });

    it('applies an entity-level route to every line declared in that entity', () => {
      parser.parse(
        [
          'fmc',
          '  storage B',
          '  region G',
          '    route exit:s depth:2',
          '    actor A',
          '    A --> B',
          '    A --> C',
        ].join('\n'),
      );
      const lines = db.getLines();
      expect(lines).toHaveLength(2);
      for (const line of lines) {
        expect(line.routing).toEqual({ exit: 's', depth: 2 });
      }
    });

    it('applies an entity-level route regardless of where it sits in the block', () => {
      // `route` after the lines still reaches them.
      parser.parse(
        [
          'fmc',
          '  storage B',
          '  region G',
          '    actor A',
          '    A --> B',
          '    route exit:e',
        ].join('\n'),
      );
      expect(db.getLines()[0].routing).toEqual({ exit: 'e' });
    });

    it("lets a line's own route win per key over the entity-level route", () => {
      parser.parse(
        [
          'fmc',
          '  storage B',
          '  region G',
          '    route exit:s depth:2',
          '    actor A',
          '    A --> B',
          '      route exit:e',
        ].join('\n'),
      );
      // exit from the line, depth from the entity.
      expect(db.getLines()[0].routing).toEqual({ exit: 'e', depth: 2 });
    });

    it('applies an entity route to lines anywhere in its subtree', () => {
      parser.parse(
        [
          'fmc',
          '  storage B',
          '  region G',
          '    route exit:s',
          '    region Inner',
          '      actor A',
          '      A --> B',
        ].join('\n'),
      );
      // The line is nested in Inner, inside G, so G's route reaches it.
      expect(db.getLines()[0].routing).toEqual({ exit: 's' });
    });

    it('lets a closer entity route win per key over an outer one', () => {
      parser.parse(
        [
          'fmc',
          '  storage B',
          '  region G',
          '    route exit:s depth:2',
          '    region Inner',
          '      route exit:e',
          '      actor A',
          '      A --> B',
        ].join('\n'),
      );
      // exit from Inner (closer), depth from G (outer).
      expect(db.getLines()[0].routing).toEqual({ exit: 'e', depth: 2 });
    });

    it('does not mistake a line from an entity named "route" for a route stmt', () => {
      parser.parse(['fmc', '  actor route', '  storage B', '  route --> B'].join('\n'));
      expect(db.getLines()).toEqual([{ source: 'route', target: 'B', type: '-->' }]);
    });

    it('propagates routing onto both segments of a complex line', () => {
      parser.parse(
        ['fmc', '  actor A', '  storage B', '  A --> o --> B', '    route exit:e depth:1'].join('\n'),
      );
      for (const line of db.getLines()) {
        expect(line.routing).toEqual({ exit: 'e', depth: 1 });
      }
    });

    it('merges repeated route statements, last value winning per key', () => {
      parser.parse(
        [
          'fmc',
          '  actor A',
          '  storage B',
          '  A --> B',
          '    route exit:s depth:2',
          '    route exit:e',
        ].join('\n'),
      );
      expect(db.getLines()[0].routing).toEqual({ exit: 'e', depth: 2 });
    });
  });

  describe('direction', () => {
    it('defaults to LR', () => {
      parser.parse('fmc\n  actor Bob');
      expect(db.getDirection()).toBe('LR');
    });

    it('reads diagram direction from the header', () => {
      parser.parse('fmc LR\n  actor Bob');
      expect(db.getDirection()).toBe('LR');
    });

    it('reads diagram direction from a top-level statement', () => {
      parser.parse('fmc\n  direction RL\n  actor Bob');
      expect(db.getDirection()).toBe('RL');
    });

    it('accepts vertical/horizontal aliases', () => {
      parser.parse('fmc horizontal\n  actor Bob');
      expect(db.getDirection()).toBe('LR');
    });

    it('normalizes TD to TB', () => {
      parser.parse('fmc TD\n  actor Bob');
      expect(db.getDirection()).toBe('TB');
    });

    it('applies a nested direction to its container only', () => {
      parser.parse(
        ['fmc LR', '  actor Bob', '    direction TB', '    actor Alice'].join('\n'),
      );
      expect(db.getDirection()).toBe('LR');
      const [bob] = db.getEntities();
      expect(bob.direction).toBe('TB');
    });
  });

  describe('debug ports', () => {
    it('is off by default', () => {
      parser.parse('fmc\n  actor Bob');
      expect(db.getDebugPorts()).toBe(false);
    });

    it('is enabled by a root-level "debug ports" directive', () => {
      parser.parse('fmc\n  debug ports\n  actor Bob');
      expect(db.getDebugPorts()).toBe(true);
    });

    it('warns and stays off when nested under an entity', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      parser.parse('fmc\n  actor Bob\n    debug ports');
      expect(db.getDebugPorts()).toBe(false);
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/only allowed at the diagram root/));
      warn.mockRestore();
    });
  });

  describe('region', () => {
    it('parses a bare region into its own type and subtype', () => {
      parser.parse('fmc\n  region\n    actor A');
      const [region] = db.getEntities();
      expect(region).toMatchObject({ name: '', type: 'region', subtype: 'region' });
      expect(region.children).toEqual([
        { name: 'A', type: 'actor', subtype: 'actor', children: [] },
      ]);
      expect(region.direction).toBeUndefined();
    });

    it('reads a trailing direction keyword as the layout direction', () => {
      parser.parse('fmc\n  region LR\n    actor A');
      const [region] = db.getEntities();
      expect(region.name).toBe('');
      expect(region.direction).toBe('LR');
    });

    it('keeps a name and reads the trailing direction after it', () => {
      parser.parse('fmc\n  region My Group LR\n    actor A');
      const [region] = db.getEntities();
      expect(region.name).toBe('My Group');
      expect(region.direction).toBe('LR');
    });

    it('treats a lone non-direction token as the name', () => {
      parser.parse('fmc\n  region Group\n    actor A');
      const [region] = db.getEntities();
      expect(region.name).toBe('Group');
      expect(region.direction).toBeUndefined();
    });

    it('lets a region nest inside an entity and hold children', () => {
      parser.parse(
        ['fmc', '  actor Parent', '    region', '      actor Alice', '    region', '      actor Bob'].join(
          '\n',
        ),
      );
      const [parent] = db.getEntities();
      expect(parent.children.map((c) => c.subtype)).toEqual(['region', 'region']);
      expect(parent.children[0].children[0].name).toBe('Alice');
      expect(parent.children[1].children[0].name).toBe('Bob');
    });

    it('attaches inline ::: classes to a region for styling', () => {
      parser.parse('fmc\n  region Group:::hot\n    actor A');
      const [region] = db.getEntities();
      expect(region.name).toBe('Group');
      expect(region.classes).toEqual(['hot']);
    });
  });
});
