// One entry per feature you want to eyeball. Add cases as the diagram grows.
export const cases = [
  {
    title: 'Single actor',
    code: `fmc
  actor Bob`,
  },
  {
    title: 'Multiple actors',
    code: `fmc
  actor Bob
  actor Alice
  actor Web Server`,
  },
  {
    title: 'Nested actors',
    code: `fmc
  actor Bob
    actor Alice
    actor Carol
  actor Eve
    actor Mallory`,
  },
  {
    title: 'Horizontal diagram (fmc LR)',
    code: `fmc LR
  actor Bob
  actor Alice
  actor Carol`,
  },
  {
    title: 'Per-container direction',
    code: `fmc LR
  actor Frontend
    direction TB
    actor Web UI
    actor Router
  actor Backend
    direction TB
    actor API
    actor Worker`,
  },
  {
    title: 'Entity types',
    code: `fmc LR
  actor Client
  user User
  pipe
  storage Database
  variance Cache
  channel
  request
  queue Job Queue`,
  },
  {
    title: 'Storage with nested contents (horizontal)',
    code: `fmc LR
  storage Warehouse
    actor Picker
    actor Packer`,
  },
  {
    title: 'Storage with nested contents (vertical)',
    code: `fmc
  storage Warehouse
    actor Picker
    actor Packer`,
  },
  {
    title: 'Queue/Pipe orientation (horizontal)',
    code: `fmc LR
  actor Producer
  queue Message Queue
  storage Store
  Producer --> Message Queue
  Message Queue --> | --> Store`,
  },
  {
    title: 'Queue/Pipe orientation (vertical)',
    code: `fmc TB
  actor Producer
  queue Message Queue
  storage Store
  Producer --> Message Queue
  Message Queue --> | --> Store`,
  },
  {
    title: 'Request orientation',
    code: `fmc LR
  request w
  request
  region TB
    request
    request n`,
  },
  {
    title: 'Labels: name vs. caption',
    code: `fmc LR
  actor ui "Web UI"
  storage db "User Database"
    actor "worker (no name)"
  queue jobs "Job Queue"
  ui --> db`,
  },
  {
    title: 'Labels: connectors and a region heading',
    code: `fmc LR
  region grp "Ingest Group"
    actor producer "Producer"
    channel bus "Bus"
    pipe batch "Batch"
    storage store "Store"
  producer --> bus
  bus --> batch
  batch --> store`,
  },
  {
    title: 'Labels: wide connector caption reserves room (LR)',
    code: `fmc LR
  actor A
  channel bus "A Very Wide Message Bus Label"
  actor B
  A --> bus
  bus --> B`,
  },
  {
    title: 'Labels: connector caption to the right (TB)',
    code: `fmc TB
  storage A
  pipe processor "A Very Wide Processor"
  storage B
  A --> processor
  processor --> B`,
  },
  {
    title: 'Labels: unlabeled container skips the heading band',
    code: `fmc TB
  storage a ""
    actor Inner
  storage b "Titled"
    actor Inner2`,
  },
  {
    title: 'Labels: a short queue keeps its bar shape',
    code: `fmc LR
  queue q "x"
  queue q2 ""`,
  },
  {
    title: 'User: stick figure with a bottom label',
    code: `fmc LR
  user Customer
  storage Orders
  Customer --> Orders`,
  },
  {
    title: 'User: with an icon (double size) instead of the figure',
    code: `fmc LR
  user admin ""
    style icon:lucide:shield-user
  storage db "Database"
    style icon:lucide:database
  admin --> db`,
  },
  {
    title: 'Depth tint (background darkens with nesting)',
    code: `fmc
  actor Level 0
    actor Level 1
      actor Level 2
        actor Level 3`,
  },
  {
    title: 'Absolute lines (the three connectors)',
    code: `fmc LR
  actor A
  storage B
  actor C
  storage D
  A --- B
  B --> C
  C <-- D`,
  },
  {
    title: 'Relative lines (source is the enclosing entity)',
    code: `fmc LR
  actor Client
    --> Server
  storage Server`,
  },
  {
    title: 'Two actors communicating through an unnamed channel',
    code: `fmc LR
  actor Producer
  channel
    Producer -->
    --> Consumer
  actor Consumer`,
  },
  {
    title: 'Named connector as an absolute-line endpoint (name not drawn)',
    code: `fmc LR
  actor Client
  channel Wire
  actor Server
  Client --> Wire
  Wire --> Server`,
  },
  {
    title: 'A line crossing container boundaries',
    code: `fmc
  actor Frontend
    actor Router
  storage Backend
    storage API
  Router --> API`,
  },
  {
    title: 'Invalid lines (same primary type) are bold red',
    code: `fmc LR
  actor Client
  storage Store
  actor Peer
  variance Cache
  Client --> Store
  Client --> Peer
  Store --- Cache`,
  },
  {
    title: 'Complex line: auto-inserted channel between two actors',
    code: `fmc LR
  actor Producer
  actor Consumer
  Producer --> o --> Consumer`,
  },
  {
    title: 'Complex line: connector lands in a same-family container',
    code: `fmc LR
  actor Outside
  storage Disk
    actor Worker
  Outside --> o --> Worker`,
  },
  {
    title: 'Complex line (relative): source is the enclosing entity',
    code: `fmc LR
  actor Client
    --> o <-- Server
  actor Server`,
  },
  {
    title: 'Complex line with a pipe (| glyph) between two storages',
    code: `fmc LR
  storage Source
  storage Sink
  Source --> | --> Sink`,
  },
  {
    title: 'Complex line with a queue (q) and requests (r, rx, <r)',
    code: `fmc LR
  actor Client
  actor API
  Client --> q --> API
  Client --> r --> API
  Client --> rn --> API
  API --> <r --> Client`,
  },
  {
    title: 'Complex lines sharing one connector to the same target',
    code: `fmc LR
  actor A
  actor B
  actor Hub
  A --> o --> Hub
  B --> o --> Hub`,
  },
  {
    title: 'Complex line: an unbounded chain mixing named entities and glyphs',
    code: `fmc LR
  actor Parent 1
    actor Actor
    port P1 e
  storage Parent 2
    port P2 w
    storage Storage
  actor Actor2
  Actor --- P1 --- o --- P2 --- | --- Storage --> Actor2`,
  },
  {
    title: 'Color: tint cascades to children, flat fill for one node',
    code: `fmc TB
  actor Web Server
    direction TB
    actor Request Handler
    actor Auth Module
  storage Database
    actor Query Engine
    storage Page Cache
  Web Server --> o --> Database
    style stroke:#455a64

  style Web Server  tint:#c62828
  style Auth Module fill:#ffd54f
  style Database    tint:#2e7d32`,
  },
  {
    title: 'Color: bare style nested under the node it targets',
    code: `fmc
  storage Warehouse
    style tint:#1565c0
    actor Picker
    actor Packer`,
  },
  {
    title: 'Color: stroke inherited by a node and its inner line',
    code: `fmc LR
  actor Frontend
    style stroke:#8e24aa
    direction TB
    actor Router
    --> API
  storage Backend
    storage API`,
  },
  {
    title: 'Color: line stroke set inline, styled complex connector',
    code: `fmc LR
  actor Producer
  actor Consumer
  Producer --> o --> Consumer
    style stroke:#00897b fill:#b2dfdb`,
  },
  {
    title: 'Color: classDef + class and the ::: shorthand',
    code: `fmc TB
  classDef critical tint:#b71c1c, stroke:#7f0000
  classDef muted fill:#eceff1
  actor Payments:::critical
    actor Ledger
    actor Fraud Check
  storage Archive:::muted
  class Archive muted`,
  },
  {
    title: 'Color: tint toward white (shade) for dark backgrounds',
    code: `fmc TB
  actor Shell
    actor Panel
      actor Widget
  style Shell tint:#1e3a5f shade:white`,
  },
  {
    title: 'Icons: line-height icon before the label',
    code: `fmc LR
  actor web "Web Server"
    style icon:lucide:server
  storage db "Database"
    style icon:lucide:database
  web --> db`,
  },
  {
    title: 'Icons: via classDef and :::',
    code: `fmc TB
  classDef svc icon:lucide:box
  actor Gateway:::svc
  actor Worker:::svc`,
  },
  {
    title: 'Icons: label-less, childless box draws a big icon',
    code: `fmc LR
  storage a ""
    style icon:lucide:cloud
  pipe b
    style icon:lucide:wifi
  queue c ""
    style icon:lucide:list-ordered
  region
    style icon:lucide:triangle-alert
  a --> b --> c`,
  },
  {
    title: 'Icons: in the label band',
    code: `fmc LR
  storage Backend
    direction TB
    style icon:lucide:server
    actor API
    actor Worker
  region "Processing"
    style icon:lucide:triangle-alert
    pipe p "Pipe"
      style icon:lucide:wifi
    queue Queue
      style icon:lucide:list-ordered
  Backend --> p --> Queue`,
  },
  {
    title: 'Icons: icon-size (s/m/l/xl and a big icon beside its label)',
    code: `fmc LR
  actor s "Small"
    style icon:lucide:server icon-size:s
  actor m "Medium"
    style icon:lucide:server icon-size:m
  actor l "Large"
    style icon:lucide:server icon-size:l
  actor xl "X-Large"
    style icon:lucide:server icon-size:xl
  storage db "Database (icon-size:1.5)"
    style icon:lucide:database icon-size:1.5
  storage db2 "Smaller (icon-size:.67)"
    style icon:lucide:database icon-size:.67`,
  },
  {
    title: 'Region: wrapping in regions is invisible (matches the plain form)',
    code: `fmc
  actor Parent
    region
      actor Alice
    region
      actor Bob`,
  },
  {
    title: 'Region: per-region layout direction',
    code: `fmc TB
  region LR
    actor Alice
    actor Bob
  region
    actor Carol`,
  },
  {
    title: 'Region: styled regions tile their parent border to border',
    code: `fmc TB
  actor Service
    region Left LR
      actor Alice
      actor Bob
    region Right
      actor Carol
  style Left fill:#e3f2fd
  style Right fill:#fff3e0`,
  },
  {
    title: 'Region: Mixed directions with a cross-region line (hand-routed)',
    code: `fmc tb
  region lr
    style fill:#ffcdd2
    actor alice
      ->o-> bob
    actor bob
      ->o-> carol
  region tb
    style fill:#bbdefb
    actor carol
      ->o-> dave
    actor dave`,
  },
  {
    title: 'Direction survives a cross-boundary line in a sibling subtree',
    code: `fmc TB
  actor SideBar
    direction LR
    actor Home
    actor Search
  actor Main
    actor Panel
      actor Widget
    actor Sink
    Widget --> Sink`,
  },
  {
    title: 'Region: a styled region at root pads around its children',
    code: `fmc
  region
    style fill:#ffcdd2
    actor bob`,
  },
  {
    title: 'Region: extends around actors, with a cross-boundary line',
    code: `fmc TB
  actor Service
    region Left
      actor Alice
      actor Bob
        -o-> Carol
    region Right
      actor Carol
      actor Dave
  style Left fill:#e3f2fd
  style Right fill:#fff3e0`,
  },
  {
    title: 'Route: baseline mixed-direction cross line (no route keyword)',
    code: `fmc tb
  debug ports
  region Left lr
    actor A
    actor B
  region Right tb
    storage C
    storage D
  A --> C
  style Left fill:#e3f2fd
  style Right fill:#fff3e0`,
  },
  {
    title: 'Route: depth:1 — both sides routed via ELK ports (auto exit)',
    code: `fmc tb
  debug ports
  region Left lr
    actor A
    actor B
  region Right tb
    storage C
    storage D
  A --> C
    route depth:1
  style Left fill:#e3f2fd
  style Right fill:#fff3e0`,
  },
  {
    title: 'Route: exit:n — explicit exit honored literally (loops against geometry)',
    code: `fmc tb
  debug ports
  region Left lr
    actor A
    actor B
  region Right tb
    storage C
    storage D
  A --> C
    route exit:n depth:1
  style Left fill:#e3f2fd
  style Right fill:#fff3e0`,
  },
  {
    title: 'Route: depth:0 bend:z — fully hand-routed, HVH',
    code: `fmc tb
  debug ports
  region Left lr
    actor A
    actor B
  region Right tb
    storage C
    storage D
  A --> C
    route depth:0 bend:z
  style Left fill:#e3f2fd
  style Right fill:#fff3e0`,
  },
  {
    title: 'Route: depth:0 bend:n — fully hand-routed, VHV',
    code: `fmc tb
  debug ports
  region Left lr
    actor A
    actor B
  region Right tb
    storage C
    storage D
  A --> C
    route depth:0 bend:n
  style Left fill:#e3f2fd
  style Right fill:#fff3e0`,
  },
  {
    title: 'Route: depth:2 — two-level port chain out of nested containers',
    code: `fmc tb
  debug ports
  region Outer lr
    storage P
    region Inner tb
      actor A
      actor B
  storage C
  A --> C
    route exit:s depth:2
  style Outer fill:#e3f2fd
  style Inner fill:#bbdefb`,
  },
  {
    title: 'Route: INCLUDE_CHILDREN inside + exit:e out to a sibling',
    code: `fmc lr
  debug ports
  region Big tb
    region Top tb
      actor A
      storage S
    region Bottom tb
      actor B
      storage S2
    A --> S2
  region Other tb
    storage T
  B --> T
    route exit:e depth:1
  style Big fill:#e3f2fd
  style Other fill:#fff3e0`,
  },
  {
    title: 'Route: entity-level route inherited by every line (exit + enter + depth)',
    code: `fmc tb
  debug ports
  region Left lr
    route exit:s enter:s depth:1
    actor A
    actor B
    A --> C
    B --> D
  region Right lr
    storage C
    storage D
  style Left fill:#e3f2fd
  style Right fill:#fff3e0`,
  },
  {
    title: 'Port: a child wires to its container edge, the port on to a sibling',
    code: `fmc lr
  debug ports
  actor Service
    port Out e
    actor Worker
    Worker --- Out
  storage Database
  Out --> Database`,
  },
  {
    title: 'Port: named ports on two containers, referenced by absolute lines',
    code: `fmc lr
  debug ports
  actor Frontend
    port Send e
    actor UI
    UI --- Send
  storage Backend
    port Recv w
    storage Store
    Recv --> Store
  Send --- Recv`,
  },
  {
    title: 'Port: invalid — both faces actor, so the lines go red',
    code: `fmc lr
  actor Peer
  actor Service
    actor Worker
    port Out e
    Worker --- Out
  Out --- Peer`,
  },
  {
    title: 'Port: invalid — an arrowhead landing on a port',
    code: `fmc lr
  storage Database
  actor Service
    actor Worker
    port Out e
    Worker --- Out
  Database --> Out`,
  },
  {
    title: 'Port: invalid — a dangling port (inner face empty)',
    code: `fmc lr
  debug ports
  storage Database
  actor Server
    port Out e
    actor Application
  Database --- Out`,
  },
  {
    title: 'Multiplicity: `*` (small shadow) vs `...` (larger shadow + corner dots)',
    code: `fmc lr
  actor* Servers
  storage... Shards
  Servers --> Shards`,
  },
  {
    title: 'Multiplicity: `...` on a container with children and a line in',
    code: `fmc lr
  storage... Pool
    direction tb
    actor Worker
    actor Worker 2
  actor... Client
  Pool <-- Client`,
  },
  {
    title: 'Multiplicity: `...` dots only (no shadow) on connectors, queue, region',
    code: `fmc lr
  region... Cluster
    style fill:#e3f2fd
    actor Node
    queue... Jobs
    channel... Bus`,
  },
];
