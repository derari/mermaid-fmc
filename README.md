# mermaid-fmc

An [FMC (Fundamental Modeling Concepts)](http://www.fmc-modeling.org/) diagram
type for [Mermaid](https://mermaid.js.org/), shipped as an external diagram plugin.

## Usage

```js
import mermaid from 'mermaid';
import fmc from 'mermaid-fmc';

mermaid.registerExternalDiagrams([fmc]);
mermaid.initialize({ startOnLoad: true });
```

````
```fmc
fmc
  actor Bob
```
````

renders a rectangle labelled **Bob**.

## Syntax

### Actors and nesting

Actors are declared with `actor <name>`. **Indentation nests** them — an actor
indented under another becomes its child, drawn as a box inside the parent:

````
```fmc
fmc
  actor Bob
    actor Alice
    actor Carol
  actor Eve
    actor Mallory
```
````

### Names and labels

Every entity has a **name** — the reference the DSL uses to pick it out ([lines](#lines),
`style <name>`, `class`, `:::`) — and a **label**, the caption drawn on the chart.
By default they are the same: `actor Bob` is named `Bob` and drawn "Bob". To
separate them, add a **quoted label** after the name; the bareword stays the
reference, the quoted string is what's printed:

````
```fmc
fmc
  actor web "Web Server"
```
````

is referenced as `web` but drawn "Web Server". Quotes fence the label, so it may
contain spaces, arrows, or punctuation without the [whitespace hazard](#lines)
that a bare multi-word name has; `\"` and `\\` escape a literal quote or
backslash inside it.

The three forms, for `actor`, `storage`, `variance`, and `queue`:

| Declaration        | Name (reference) | Drawn caption |
|--------------------|------------------|---------------|
| `actor Bob`        | `Bob`            | "Bob" (name is the default label) |
| `actor bob "Bob"`  | `bob`            | "Bob" |
| `actor "Bob"`      | *(none)*         | "Bob" — no name, so it can't be referenced |
| `actor bob ""`     | `bob`            | *(none)* — an explicit empty label draws no caption |

`channel`, `pipe`, and `region` work the same way but their label **defaults to
empty** (a connector's name has always been undrawn, and a region's is
styling-only). Give one an explicit quoted label to draw a caption: a `channel`
or `pipe` prints it beside the glyph — below in a horizontal flow (`LR`/`RL`), to
the right in a vertical one (`TB`/`BT`), with layout reserving room for it — and a
`region` prints it as a heading, like an actor's. A `port` never carries a
label.

### Entity types

There are ten entity keywords. Each is declared the same way
(`<keyword> <name>`) and nests by indentation, subject to the rules below.
Every entity has a coarse **type** and a finer **subtype**: the type fixes the
shape family — `actor` draws with sharp rectangular corners, `storage` with
rounded ones (radius = half the shorter side) — and the subtype picks the
variant.

The **Default caption** column is what each keyword draws when you give only a
name; any of them (except `port`) can also take an explicit quoted
[label](#names-and-labels) to override it.

| Keyword (subtype) | Type    | Shape                               | Default caption | Can nest children? |
|-------------------|---------|-------------------------------------|:---------------:|:------------------:|
| `actor`           | actor   | rectangle                           |      name       |        yes         |
| `pipe`            | actor   | small rectangle                     |    *(none)*     |         no         |
| `user`            | actor   | figure (or icon) over a caption     |      name       |         no         |
| `storage`         | storage | rounded rectangle                   |      name       |        yes         |
| `variance`        | storage | rounded rectangle, dashed outline   |      name       |        yes         |
| `channel`         | storage | small circle                        |    *(none)*     |         no         |
| `request`         | storage | small circle with a direction arrow |    *(none)*     |         no         |
| `queue`           | storage | thin rounded bar                    |      name       |         no         |
| `region`          | region  | invisible box (no border)           |    *(none)*     |        yes         |
| `port`            | port    | point on the parent's edge          |      never      |         no         |

`channel` and `pipe` are connectors — they draw no caption by default and cannot
contain nested entities (doing so is a parse error). Their name lets [lines](#lines)
reference the connector; give one a quoted [label](#names-and-labels) to draw a
caption beside the glyph.

A `request` is a `channel` in every way — same circle, same connector rules, same
outside caption — with a direction arrow drawn inside it, filled with the
request's own outline color. Its syntax adds an optional trailing **orientation**:

```
request <name?> <"label"?> <orientation?>
```

The orientation is one of:

- a compass side — `n`/`north`, `e`/`east`, `s`/`south`, `w`/`west`
  (case-insensitive) — for a fixed direction;
- `auto`, `?`, or `>` — the default — which points the arrow **downstream of the
  container's flow** (`TB` → south, `RL` → west, and so on);
- `back` or `<`, which points it **upstream** (the opposite of `auto`).

When the last token reads as an orientation it is taken as one, so
`request wild wild west` is a request named `wild wild` pointing west; a last
token that is not an orientation stays part of the name.

A `queue` is a storage subtype for a buffer or message queue. Its thickness (the
short side) is half the default actor height and its long side sizes to its label
— which, unlike a connector, it draws inside the bar. It is oriented along the flow: a
horizontal bar under `LR`/`RL`, rotated a quarter turn (with its label turned to
match) under `TB`/`BT`. Like `channel` and `pipe` it is a leaf and cannot contain
nested entities.

A `user` is an actor subtype for a human role, drawn like a UML actor: a stick
figure above a caption along the bottom. It is at least the default actor height
wide and half again as tall (widening to fit the caption), and like `queue` it is
a leaf — it cannot contain nested entities. Give it an [`icon`](#icons) and the
icon is drawn at double size in place of the stick figure.

A `region` is a purely structural grouping box — see [Regions](#regions). A
`port` is a named connection point pinned to one edge of its parent — see
[Ports](#ports).

## Multiplicity

A trailing marker on the keyword marks an entity as standing for **several
instances**. There are two forms:

| Marker | Example | Rendering |
| ------ | ------- | --------- |
| `*`    | `actor* Servers`   | a same-size, same-color "shadow" box at a small diagonal offset behind the entity |
| `...`  | `actor... Servers` | three dots in the bottom-right corner — plus, on the shadow families, a shadow at a larger offset |

```
actor* Servers
storage... Shards
region... Cluster
```

The `*` marker is only valid on the full-box **shadow families** — `actor`,
`storage`, `variance`, and `user`. The `...` marker is valid on every subtype
**except `port`**: on a shadow family it draws the shadow *and* the dots; on any
other (a connector, `queue`, or `region`) it draws the dots alone. A `region`'s
dots are drawn at double size, since a region is a large structural box.

Multiplicity works on a container too — `storage* Pool` with children nested
inside — and combines with labels, classes, and icons
(`actor... web "Web Servers":::prod`). The box keeps its size, so **lines still
connect to it exactly as before** — they meet the front box's border, never the
shadow.

````
```fmc
fmc LR
  actor Client
  channel
  storage Database
  variance Cache
```
````

Nesting depth tints the background: leaves are drawn in the base color and each
enclosing level is a shade darker, so deeply nested structures stay legible. The
gradient is per container — a box's shade depends only on how deep *its own*
contents go, not on a deeper sibling elsewhere. See [Colors](#colors) to change
the base color or override it per subtree.

A `storage` or `variance` that contains children is drawn as a stadium, whose
semicircular caps sit on its two short edges. Those edges get just enough extra
padding for the label and nested boxes to clear the curve — for content of
half-width `hw` under a cap of radius `r`, that inset is `r − √(r² − hw²)`. The
layout is run once to size the box, then re-run with that padding applied.

### Layout direction

Set the diagram's flow direction on the header, the same way flowchart does
(`flowchart LR`). Tokens are Mermaid's `TB`/`TD`, `BT`, `LR`, `RL`, plus the
aliases `vertical` (→ `TB`) and `horizontal` (→ `LR`):

````
```fmc
fmc LR
  actor Bob
  actor Alice
```
````

A `direction` statement nested inside a container overrides the flow for that
container's children only — mirroring `direction` inside a flowchart subgraph.
This is idiomatic for FMC, where nesting levels often alternate axis:

````
```fmc
fmc LR
  actor Frontend
    direction TB
    actor Web UI
    actor Router
  actor Backend
    direction TB
    actor API
    actor Worker
```
````

> **Note.** A nested `direction` is always honored. Routing a [line](#lines)
> whose endpoints sit in different subtrees normally relies on ELK's
> `INCLUDE_CHILDREN`, which imposes one flow direction on the enclosing subtree —
> so it is used only when every container in that subtree already flows the same
> way (flattening then changes nothing). When the subtree mixes directions, it is
> left alone and the crossing line is routed directly instead, so both the
> per-container directions and the connection survive.

### Regions

A `region` is a structural grouping box with no visual presence of its own: it
never draws a border and is transparent unless given a `fill`. Use it to lay a
group of entities out together — for example on their own axis — without adding
a box to the picture.

A region is deliberately invisible to layout and color:

- **No chrome.** It reserves no label band and no padding, so its children sit
  exactly where they would without it. Wrapping entities in regions never
  shifts them — these two diagrams render identically:

  ````
  ```fmc
  fmc
    actor Parent
      actor Alice
      actor Bob
  ```
  ````

  ````
  ```fmc
  fmc
    actor Parent
      region
        actor Alice
      region
        actor Bob
  ```
  ````

- **Invisible to depth.** The nesting-depth [tint](#colors) skips regions, so a
  region-wrapped subtree shades exactly as if the region weren't there.
- **Fill only.** A region ignores `tint`/`shade` for its own box (it still
  passes them through to its children). When it has a `fill`, sibling regions
  tile their parent's interior edge to edge, each coloring the area around its
  own children.

A region takes an optional inline layout direction as its last token, after any
name (`region LR`, `region My Group RL`); a nested `direction` statement works
too. Here `Alice` and `Bob` sit side by side, with `Carol` below:

````
```fmc
fmc TB
  region LR
    actor Alice
    actor Bob
  region
    actor Carol
```
````

A region's name is not drawn by default — it exists so [styling](#colors) can
target it (`style My Group fill:#eef`, `:::class`, or a `class` statement) and so
a nested `direction` can attach. Give a region a quoted
[label](#names-and-labels) to draw it as a heading, like an actor's:
`region grp "My Group" LR`. Regions are structural, so they are never
[line](#lines) endpoints.

### Lines

Lines connect two entities. Three arrowss set the direction: `---` is a
plain link, `-->` points at the second entity, and `<--` points at the first.
Whitespace must surround the arrows so it never swallows a hyphen from a
name.

An **absolute line** names both endpoints — `entity1 arrows entity2` — and
may appear anywhere in the diagram; its nesting is irrelevant, so it reads the
same wherever you put it:

````
```fmc
fmc LR
  actor A
  actor B
  actor C
  A --- B
  B --> C
  C <-- A
```
````

A **relative line** drops one endpoint and lets the entity it is nested under
fill the gap. Drop the *first* endpoint (`arrows entity2`) and the enclosing
entity is the source; drop the *second* (`entity1 arrows`) and it is the
target. This is how you attach a line to an *unnamed* connector (a `channel` or
`pipe`), since no name can pick one out — for example two actors communicating
through a channel, wired from inside it:

````
```fmc
fmc LR
  actor Producer
  channel
    Producer -->
    --> Consumer
  actor Consumer
```
````

A connector may also be **named**, and while its name is never drawn it can be
referenced by an absolute line like any other entity — handy when the same
connector is wired from several places:

````
```fmc
fmc LR
  actor Client
  channel Wire
  actor Server
  Client --> Wire
  Wire --> Server
```
````

Endpoints are resolved by name after the whole diagram is parsed, so an absolute
line may reference an entity declared further down. A line whose endpoints don't
resolve is skipped with a console warning rather than failing the render. Lines
may cross container boundaries — `Router --> API` where each sits in a different
parent — and are routed through the nesting accordingly.

A meaningful FMC line always crosses the two families: an **actor** connects to a
**storage**. A line whose endpoints share a **primary type** — actor-to-actor or
storage-to-storage — is invalid, and is drawn **bold red** (`#ff0000`) instead of
being rejected, so the mistake is visible in the diagram. The check is on the
coarse type, so subtypes group with their family (a `pipe` counts as an actor, a
`channel` as a storage).

### Complex lines

A **complex line** is a chain of two or more arrows threaded through a run of
nodes — `A arrow B arrow C arrow …` — expanding to one plain line per arrow. Each
interior node is either a **named entity** the line passes through, or a
**connector glyph** whose entity is created and placed **for you**. The glyphs
(case-insensitive) are:

- `o` — a `channel`
- `|` — a `pipe`
- `q` — an (unlabelled) `queue`
- `r` — a `request`, optionally with a one-character
  [orientation](#entity-types) suffix from `nesw<>?` (`rn`, `re`, `rw`, `r<`,
  `r?`, …); the alias `<r` is a `back` request, same as `r<`. A bare `r` is `auto`.

The chain has **no length limit**, each arrow is independent, and either endpoint
may be omitted just as in a plain relative line (the enclosing entity fills the
gap).

So two actors talking through a channel is one line:

````
```fmc
fmc LR
  actor Producer
  actor Consumer
  Producer --> o --> Consumer
```
````

expands to an inserted `channel` plus `Producer --> channel` and
`channel --> Consumer`. Whitespace must flank an arrow next to a **name** (so a
hyphen in a name is never swallowed), but a glyph may hug its arrows —
`A -->o--> B` reads the same as `A --> o --> B`.

A longer chain mixes named entities and glyphs freely; a bare name in the middle
is simply threaded through, no connector inserted:

````
```fmc
fmc LR
  actor Actor
  storage Storage
  actor Actor2
  Actor --> o --> Storage --> Actor2
```
````

The connector's home is found — per glyph — by climbing from the entity on its
**right** toward the root and stopping at the first ancestor that either
**shares the connector's own family** (a channel is storage-family, a pipe
actor-family) or **already contains the entity on its left**; the connector is
inserted there, just before that branch. So when the right-hand entity sits
inside a storage container, a channel lands *inside* that container next to it:

````
```fmc
fmc LR
  actor Outside
  storage Disk
    actor Worker
  Outside --> o --> Worker
```
````

the channel is placed inside `Disk`, giving `Outside --> channel` and
`channel --> Worker`.

A **port** target is a special case. A port only pins the connection to an edge
of its container, so when the connector's right-hand entity is a port reached
from **outside** that port's container, the connector is placed relative to the
**container** (as its sibling) rather than climbed to from the port and buried
inside next to it. A port reached from **within** its own container keeps the
ordinary placement above. So a channel bridging two containers through their
ports lands between them:

````
```fmc
fmc LR
  actor Frontend
    actor Worker
    port Out e
  storage Backend
    port In w
    storage Store
  Worker --- Out --- o --- In --- | --- Store
```
````

the channel sits at the top level between `Frontend` and `Backend`, while the
pipe — whose target `Store` is an ordinary entity inside `Backend` — lands inside
`Backend`.

When a connector would be inserted with the **same family, in the same
container, with the same outgoing segment** (right-hand entity and arrow) as one
an earlier complex line already placed, it **reuses** that connector and adds
only its own incoming segment. So several sources can feed a single shared
channel or pipe:

````
```fmc
fmc LR
  actor A
  actor B
  actor Hub
  A --> o --> Hub
  B --> o --> Hub
```
````

yields one channel with `A --> channel`, `B --> channel`, and `channel --> Hub`.

### Routing lines across boundaries

When a line crosses a container boundary and the containers on either side flow
in **different directions**, the layout engine can't route it for us (see the
note under [Layout direction](#layout-direction)), so it is routed by hand. A
`route` statement nested under such a line tunes how:

````
```fmc
fmc TB
  region Left LR
    actor A
    actor B
  region Right TB
    storage C
    storage D
  A --> C
    route exit:s depth:1 bend:z
```
````

It takes up to three keys, all optional. Keys and values are case-insensitive:

| Key     | Values                                                      | Default | Meaning                                                                                                                                                                                                                                                                                    |
|---------|-------------------------------------------------------------|---------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `exit`  | `n`/`north` `e`/`east` `s`/`south` `w`/`west`, `auto` (`?`) | `auto`  | Which side of the source's container the line leaves. `auto` derives the axis from the container's flow direction and the side from where the target sits. The target enters on the facing side.                                                                                           |
| `enter` | `n`/`north` `e`/`east` `s`/`south` `w`/`west`, `auto` (`?`) | `auto`  | Which side of the target's container the line enters. `auto` faces the source's `exit` (the opposite side); set it explicitly for an asymmetric route.                                                                                                                                     |
| `depth` | integer ≥ 0, `auto` (`?`)                                   | `1`     | How many nesting levels on **each** side get an ELK-routed port. The two port chains are joined at the common ancestor by ELK when both reach it, otherwise by a hand-drawn bridge. `0` hand-routes the whole line; `auto` ports every level up to the common ancestor (fully ELK-routed). |
| `bend`  | `z`/`hvh` `n`/`vhv`, `auto` (`?`)                           | `z`     | The hand-drawn bridge's shape (only when a bridge is used): `z`/`hvh` is horizontal-vertical-horizontal, `n`/`vhv` is vertical-horizontal-vertical. `auto` picks the axis the two ends are more separated along.                                                                           |

`?` is an accepted alias for `auto` on every key that takes it.

The exit and enter sides are chosen **before** layout, so an `exit`/`enter` that
fights the geometry is honored literally — the line may loop around the container
to leave or arrive on the side you asked for. That is deliberate, not a bug.

A `route` may also be nested directly under an **entity** rather than a line, in
which case it sets a default for every line declared directly in that entity:

````
```fmc
fmc TB
  region Right TB
    storage C
    storage D
  region Left LR
    route exit:s
    actor A
    actor B
    A --> C
    B --> D
```
````

Here both `A --> C` and `B --> D` inherit `exit:s`. The default reaches every
line anywhere in the entity's subtree, regardless of where the `route` sits in
the block. A `route` at the **diagram root** (a sibling of the top-level
entities) works the same way but applies to every line in the diagram. When
routes are set at more than one level, the **closest** one wins per key: a line's
own `route` beats an enclosing entity's, which in turn beats one further out, and
the diagram-root default is the outermost of all. Keys not set at a closer level
fall through to the outer one.

A `route` on a line that crosses **no** boundary — or one whose two sides flow
the same way, which the engine routes directly — has nothing to tune and is
reported with a console warning. Unknown keys or values (a bad side, a
non-integer `depth`) are dropped with a warning too, leaving the valid keys in
place; routing keys are validated rather than passed through, unlike `style`.

Port chains and the flattening described under [Layout
direction](#layout-direction) **compose**: a container may be flattened for a
line crossing *within* it and still carry another line's port chain climbing
*out* through it, because each port hop connects one level to its immediate
parent. Nothing is un-flattened and no container has to choose between the two.
Expect the engine to **shift boxes** to make ports routable — positions move,
per-container directions never do. The full routing model, with worked examples,
is in [docs/routing.md](docs/routing.md).

### Ports

A `port` is a named connection point pinned to **one edge of its parent
container**. It draws nothing itself; its whole job is to give [lines](#lines) a
fixed spot on a container's boundary to enter or leave through. It is declared
with a **required trailing direction** — a compass side, `n`/`north`,
`e`/`east`, `s`/`south`, `w`/`west` (case-insensitive) — after an optional name:

````
```fmc
fmc LR
  actor Service
    port Out e
    actor Worker
    Worker --- Out
  storage Database
  Out --> Database
```
````

Here `Worker --- Out` runs from inside `Service` to a port on its **east** edge,
and `Out --> Database` carries on from that same point to the sibling `storage`.
The port pins where the connection crosses `Service`'s boundary. (The line into
the port is undirected — an arrowhead may not land *on* a port; see
[validation](#port-line-validation) below.)

Ports follow a few rules:

- **A port lives on a container, never at the diagram root** — there is no edge
  to pin to there, so a root-level `port` is a parse error.
- **Like `channel` and `pipe`, a port holds no children** other than lines (and
  config keywords); nesting an entity under one is an error. Its name is not
  drawn, but it lets an absolute line reference it. A port draws no caption at
  all, so a quoted [label](#names-and-labels) on one is a parse error.

When a line resolves to a port, the port is added to its parent as a fixed-side
ELK port on the declared edge, and the line is routed to it with the ordinary
layout. To see where ports land, enable the [`debug ports`](#debugging-ports)
overlay — **declared ports draw as green squares** (the router's own ports are
red).

#### Port line validation

A port is a hole through its container's wall, so it has two **faces**: an
**inner** face (reached by lines from *inside* the container) and an **outer**
face (reached by lines from *outside*). Each face takes a **type** —
`actor`, `storage`, `mixed`, or `empty` — inferred from the entities wired to it:
a face with only actors is `actor`, only storages `storage`, a clash `mixed`, and
a face with **no lines at all** is `empty`. When the far end of a line is *itself*
a port, the type carried across is that port's **opposite** face — what emerges on
the far side of its hole — computed recursively (a self-referential chain resolves
to `mixed` rather than looping).

Because a meaningful FMC connection crosses the two families, the faces are
checked like a line's endpoints:

- **Faces of the same type** (`actor`/`actor`, `storage`/`storage`, or
  `mixed`/`mixed`) — the port bridges nothing, so **all** its lines are invalid.
- **One face `empty`** — the port doesn't reach across at all, so **every line on
  the other face is invalid**. (A one-sided, dangling port is thus always flagged.)
- **One face `mixed`, the other definite** — on the mixed face, a line is invalid
  when its far end matches the definite face's type (an `actor` reaching a
  face whose opposite is already `actor`, say). Lines on the definite face are
  left alone.
- **The two faces differ and neither is `mixed`/`empty`** — the port bridges
  cleanly and every line is valid.

On top of the face rules, **an arrowhead may never land on a port**: a port is a
pass-through, not a destination, so a `-->` whose target is a port (or a `<--`
whose source is one) is invalid regardless of the faces. Wire ports with
undirected `---` lines, or point the arrow at the entity on the *far* side.

Invalid lines are drawn **bold red**, exactly like a same-family actor↔actor
line. So `Worker --- Out` with `Out --> Database` (an actor inside, a storage
outside) validates, while wiring another actor to that same port's outside — or
pointing an arrowhead straight at the port — lights it up red.

#### Debugging ports

The ports along a hand-routed line's chain — and the [ports](#ports) you declare
yourself — are laid out zero-size and are normally invisible. Add a `debug ports`
directive at the diagram root (directly under `fmc`) to draw each one as a small
square, so you can see exactly where a crossing line enters and leaves each
container. The router's own chain ports draw **red**; ports from a declared
`port` entity draw **green**:

````
```fmc
fmc TB
  debug ports
  region Left LR
    actor A
  region Right TB
    storage C
  A --> C
```
````

The directive is only valid at the root — nested under an entity it is dropped
with a console warning.

### Colors

Out of the box the diagram follows the active Mermaid **theme**. Set it the usual
way — `mermaid.initialize({ theme, themeVariables })`, or per-diagram with an
`%%{init}%%` directive — and fmc reads its palette from there: entity outlines
from `nodeBorder`, lines from `lineColor`, labels from `textColor`, and the
depth-tint base from `mainBkg`. On a **dark** theme (`darkMode`), the tint
lightens toward white as it nests instead of darkening toward black, so nesting
stays legible in either mode. No fmc-specific configuration is required.

Three style properties (plus `shade`) can be set explicitly, all taking any
whitespace-free CSS color (`#f90`, `tomato`, `rgb(255,0,0)`, `hsl(9,100%,64%)`):

| Property | Effect                                                                                        | Inherited by children? |
|----------|-----------------------------------------------------------------------------------------------|:----------------------:|
| `fill`   | flat background for **one** node                                                              |           no           |
| `tint`   | base color of a node's depth-graduated fill (leaf = the color, each level out a shade darker) |          yes           |
| `stroke` | outline color — and the color of lines written inside the node                                |          yes           |
| `shade`  | the color `tint` moves toward when nesting (default: theme-appropriate black/white)           |          yes           |

`fill` wins over `tint` on the node it names but does not cascade; children still
inherit the nearest `tint`.

#### Applying styles

A **`style` statement** carries one or more `key:value` props. Named, it targets
every entity with that name; bare (no name), it styles the entity — or line — it
is **nested under**:

````
```fmc
fmc TB
  actor Web Server
    actor Request Handler
    actor Auth Module
  storage Database
  Web Server --> o --> Database  stroke:#455a64

  style Web Server  tint:#c62828
  style Auth Module fill:#ffd54f
  style Database    tint:#2e7d32
```
````

Here `Web Server`'s red `tint` cascades to its children (graduated by depth),
`Auth Module` is a flat amber only on that box, and `Database` starts an
independent green subtree.

A bare `style` at the **diagram root** (a sibling of the top-level entities) sets
a **diagram-wide default**, the same way a root-level [`route`](#routing-lines-across-boundaries)
defaults every line. It is the outermost styling layer — one notch more specific
than the theme — so its inheritable props (`tint`, `stroke`, `shade`) seed every
entity unless a nearer declaration overrides them:

````
```fmc
fmc
  style tint:#c62828
  actor Web Server
  storage Database
```
````

tints the whole diagram red. (`fill` has no root box to paint and never cascades,
so it does nothing at the root.)

**`classDef` / `class` / `:::`** work as in flowchart: define a reusable bag with
`classDef <name> <props>`, then attach it with `class <names> <name>` (names
comma-separated, the class name last) or the `entity:::name` shorthand on a
declaration:

````
```fmc
fmc
  classDef critical tint:#b71c1c stroke:#7f0000
  actor Payments:::critical
    actor Ledger
  storage Archive
  class Archive critical
```
````

Precedence, most specific first: a node's own `fill` > its bare `style` >
`style <name>` > `class`/`classDef` > inherited `tint`/`stroke` > the
diagram-root `style` default > the theme.

#### Line color

A line takes its `stroke` from, in order: a `style` nested under it; the entity a
**relative** line is written inside (or, for an **absolute** line, the lowest
common ancestor of its endpoints); otherwise the theme line color. Nest the
`style` under the line to set it directly — and on a complex line, that same
`style` also paints the auto-inserted connector:

````
```fmc
fmc LR
  actor Producer
  actor Consumer
  Producer --> o --> Consumer
    style stroke:#00897b fill:#b2dfdb
```
````

Two rules override styling: an **invalid** line (endpoints of the same primary
type) is always bold red, ignoring any `stroke`; and a **reused** complex-line
connector keeps the styling of the line that first created it, though each
reusing line still colors its own segment.

### Icons

An entity can carry an **icon** drawn from an [Iconify](https://iconify.design/)
icon pack. `icon` is just another [style property](#colors), so it rides the same
machinery as the colors — set it with a bare `style`, `style <name>`, a
`classDef`/`class`, or the `:::` shorthand — and, like `fill`, it applies to **one
node** and never cascades to children. Its value is an Iconify `pack:name`
reference:

````
```fmc
fmc LR
  actor web "Web Server"
    style icon:lucide:server
  storage db "Database"
    style icon:lucide:database
  web --> db
```
````

Reuse one across many nodes with a class:

````
```fmc
fmc
  classDef svc icon:lucide:box
  actor Gateway:::svc
  storage Cache:::svc
```
````

Every entity that can draw a caption can carry an icon — that is, all of them
except a `port` (which draws nothing). Where the icon goes follows the subtype:

- **`actor`, `storage`, `variance`, and a captioned `region`** draw it at **one
  line height, before the label** — to its left in a leaf, in the top label band of
  a container — or, when there is no label, where the label would go. The box
  reserves the extra width, and an uncaptioned container with an icon reserves a top
  band for it. As a special case, a box with **no label and no children** draws the
  icon **alone at twice the line height**, centred — an icon-only glyph (use an
  explicit empty label, `storage a ""`, to get one).
- A **`user`** draws its icon at **double size above the bottom caption**, in place
  of the stick figure.
- A **connector** (`channel`/`pipe`) draws it **beside the glyph**, before the
  caption, in the same space the caption reserves (below the glyph in a horizontal
  flow, to its right in a vertical one).
- A **`queue`** draws it **inside the bar**, before the label, turned to run along
  the bar with it; the bar lengthens to make room.

#### Icon size

`icon-size` sets the icon's size as a factor of the line height. It is a
[style property](#colors) like `icon` — same `style`/`class` machinery, same
per-node (non-cascading) behaviour — and takes:

| Value | Factor |
|-------|--------|
| `auto` (or `?`) | the context default (see above) — **this is the default** |
| `s` / `m` / `l` | 1 / 2 / 3× line height |
| `xl`, `xxl`, `xxxl`, … | 4, 5, 6… — each leading `x` on `l` adds one |
| a number (`1.5`, `.7`, `2`) | that many line heights |

Values are case-insensitive. The box grows to reserve room for the icon, and when
a large icon sits beside a label the label is **vertically centred to the icon**:

````
```fmc
fmc LR
  actor api "API"
    style icon:lucide:server icon-size:xl
  storage db "Database"
    style icon:lucide:database icon-size:1.5
```
````

#### Registering icon packs

Icons resolve against packs you register once, up front. `registerIconPacks`
accepts Iconify packs either eagerly (their JSON in hand) or via a lazy `loader`
that is only run on the first diagram that actually uses an icon — so an icon-free
page never fetches a pack, and `@iconify/utils` (the one extra dependency, loaded
by dynamic import) is never pulled in:

```js
import mermaid from 'mermaid';
import fmc, { registerIconPacks } from 'mermaid-fmc';

mermaid.registerExternalDiagrams([fmc]);
registerIconPacks([
  {
    name: 'lucide',
    // Any Iconify pack works; install e.g. `@iconify-json/lucide`, or fetch its
    // JSON from a CDN as the examples do.
    loader: () => import('@iconify-json/lucide/icons.json', { with: { type: 'json' } })
      .then((m) => m.default),
  },
]);
```

An `icon:` that names an unregistered pack, a missing icon, or a value without a
`pack:` prefix is skipped with a console warning rather than failing the render.

## Project layout

| Path                  | What it is                                                                                                                                                                    |
|-----------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `src/index.ts`        | The `ExternalDiagramDefinition` — id, detector, lazy loader                                                                                                                   |
| `src/diagram.ts`      | Wires db + parser + renderer + styles together; captures the theme config getter via `injectUtils`                                                                            |
| `src/parser.ts`       | Line-oriented parser: indent stack for nesting, keyword dispatch per line                                                                                                     |
| `src/complexLines.ts` | Expands complex lines (chains): inserts a connector entity per glyph, emits one wiring line per arrow — pure, unit-tested                                                     |
| `src/db.ts`           | In-memory entity tree, connection list, layout direction, and style declarations (classDefs, named styles/classes)                                                            |
| `src/styleModel.ts`   | Resolves classes/`style`/tint inheritance into a concrete fill + outline + icon per entity — pure, unit-tested                                                                |
| `src/icons.ts`        | Icon-pack registry: `registerIconPacks`, lazy loading, and resolving an `icon:pack:name` to inline SVG via `@iconify/utils` (dynamic-imported)                                |
| `src/portTypes.ts`    | Infers each port's inner/outer face type and flags invalid port lines — pure, unit-tested                                                                                     |
| `src/theme.ts`        | Bridges Mermaid's resolved theme variables into the renderer's palette                                                                                                        |
| `src/renderer.ts`     | Lays out with elkjs (entities as nodes, lines as edges), then draws the SVG via the DOM; applies the plan from `routePlan.ts`                                                 |
| `src/routePlan.ts`    | Pure line-routing decisions (flatten vs. port chains, exit side, depth, join/bridge, arrow placement) — no DOM/ELK, unit-tested directly ([docs/routing.md](docs/routing.md)) |
| `src/geometry.ts`     | Pure layout math (depth tint, tree depth, stadium-cap geometry, edge common-ancestor) — no DOM/ELK, unit-tested directly                                                      |
| `src/styles.ts`       | Theme-aware CSS injected into the diagram's `<svg>`                                                                                                                           |
| `test/`               | Vitest tests: parser, db, style resolution, pure geometry, the route planner, plus a few real-ELK routing checks (headless)                                                   |
| `examples/`           | Visual playground you open in a browser                                                                                                                                       |

## Develop

```bash
npm install        # first time: approve esbuild's install script if prompted
npm test           # fast headless tests
npm run test:watch
```

## Visual playground

Live at **https://derari.github.io/mermaid-fmc/** (the [playground](https://derari.github.io/mermaid-fmc/)
and [editor](https://derari.github.io/mermaid-fmc/editor.html)), published from
`examples/` on every push to `main` by [`.github/workflows/pages.yml`](.github/workflows/pages.yml).

To run it locally:

```bash
npm run dev              # Vite dev server on :5173
```

- **http://localhost:5173/** — the playground (`examples/index.html`)
- **http://localhost:5173/editor.html** — the live editor

The pages import the library straight from `src/` (TypeScript), so editing
either `examples/cases.js` or the library source and refreshing is enough — **no
rebuild needed**. Add cases to `examples/cases.js` to eyeball new features.

```bash
npm run build:examples   # bundle the two pages into site/ (what Pages serves)
npm run preview:examples # serve that build locally to sanity-check it
```

## Build & release

```bash
npm run build      # tsup → dist/ (ESM + .d.ts)
npm run release    # test + build + npm publish
```

`mermaid` is a peer dependency (`^11`); consumers bring their own. The main
runtime dependency is [`elkjs`](https://github.com/kieler/elkjs), which computes
the nested-box layout — the same engine Mermaid uses for its ELK-based layouts.
[`@iconify/utils`](https://iconify.design/) is a second, but it is loaded by
dynamic import only when a diagram actually resolves an [icon](#icons), so an
icon-free consumer never pays for it.
