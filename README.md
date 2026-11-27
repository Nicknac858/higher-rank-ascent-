# Higher Rank — concept site explorations

Separate design explorations for Higher Rank. Neither replaces any approved Higher Rank work.

## Candidates

**The Arena** (newest, stage one) — `arena/` (Vite project), single-file copy at
`versions/v8-arena-stage-one.html`. Branch `claude/arena-hero`.
A round esports stage under a centre-hung halo of LED screens, a lighting truss with moving
beams, a reflective floor and a bowl of crowd lights. Scrolling orbits the camera while three
broadcast screens (web design, marketing, live events and esports) swing in on a diagonal and
bend like LED sheets with scroll speed. See `arena/README.md`.

**The Conduit** (current direction) — `conduit/index.html`
A structure you descend. A vertical conduit of cables, helical wires, tunnel ribs and wide
outer arcs runs far beyond the frame; scrolling carries you down it, past node collars, from
a luminous core at the top to a terminus at the bottom. Three replaceable media windows swing
to a large, face-on position in front of the structure, rendered as panes of smoked glass
you can see the wires through. Neon: a magenta core, deep-blue cables, violet conduits and
aqua filaments, against steel ribs on near-black.

**Ascent** (earlier direction, not approved) — `index.html`
Moonlit dunes climbed toward sunrise. Preserved unchanged.

## Versions
`versions/` holds every save point, so nothing is lost:
- `v14-arena-reveal-hairline.html` — The Arena: screen reveal edge is a crisp hairline instead of a glare band (current)
- `v13-arena-light-profile.html` — The Arena: light profile for built-in GPUs, verified at native resolution on an Intel HD 530
- `v12-arena-crowd-crisp.html` — The Arena: organic crowd, crisp rendering pass, lens points, reflection fix
- `v11-arena-ultraviolet.html` — The Arena with ultraviolet as the second colour (owner's pick)
- `v10-arena-electric-purple.html` — The Arena with vivid electric purple as the second colour
- `v9-arena-magenta.html` — The Arena with magenta as the second colour
- `v8-arena-stage-one.html` — The Arena, stage one, blue only
- `v1-rank-order.html` — typographic ranked-list concept (not approved)
- `v2-ascent-terraces-vermilion.html` — first WebGL world
- `v3-ascent-terraces-aurora.html` — new palette and richer sky
- `v4-ascent-dunes.html` — moonlit dunes (same as `index.html`)
- `v5-conduit.html` — The Conduit, first pass: a single floating sculpture, warm amber palette
- `v6-conduit-descent.html` — The Conduit: descent through a larger structure, cool palette,
  media windows brought to the front
- `v7-conduit-neon-glass.html` — The Conduit, current: neon colour per wire gauge, magenta
  core, larger media panes with a glass treatment (same as `conduit/index.html`)

## The Conduit — how it works
One self-contained file. Open it in a browser.

A single eased value `s` (0–10), driven by native page scroll, controls everything, so
scrolling backward reverses the journey exactly.

- **Structure** — a spine running from y=+26 to y=-26: heavy cables, helical conduits and fine
  filaments, with tunnel ribs every four units and wide outer arcs that sweep past the viewport.
  Node collars sit at five stations. A coiled emissive torus-knot heart sits inside a containment
  field at the top core and again at the bottom terminus, where cables converge into a wide ring.
- **Colour** — each wire gauge carries its own neon emissive (`MAT[].ec` and `.e`), pulsing along
  its length with a fresnel edge so the tubes read as lit glass rod. The core and terminus are
  magenta; the ribs, arcs and collars stay steel so the neon has something neutral to sit against.
- **Lighting** — a travelling light rides the conduit axis at the camera's height; a camera-relative key and rim light
  keep the metal reading from every angle. GGX specular, procedural environment reflections,
  8× multisampling, bloom, filmic tone curve.
- **Particles** — curve positions are baked into a float texture; instanced sprites flow along
  the wires in the vertex shader, slow and brighten at the nodes, and shed outward as energy rises.
- **Media windows** — textured quads inside the 3D scene, depth-tested against the structure, so
  wires genuinely pass in front of and behind them while they travel. At each focus moment the
  window moves forward of every wire, so the content reads cleanly. Rendered as glass: a
  travelling sheen, a cool body tint, a brighter rim, and an alpha that rises with image
  brightness so dark areas read through and bright areas hold. Positioned in camera space.

### Replacing the media
Near the top of the last `<script>` block:

```js
window.MEDIA = ['', '', ''];   // slot 01 Web Design, 02 Events, 03 Digital Media
```

Put a muted, looping H.264 `.mp4` or `.webm` URL in each string (CORS enabled). Leave a slot
empty and a clearly-marked placeholder slate renders in its place.

## Status
- All copy is written; projects, contact details and clips are placeholders where marked.
- The contact form is not connected.
- Tested in a headless desktop browser with software rendering, at desktop and phone viewport
  sizes, plus the no-WebGL fallback. Not yet verified on a real graphics card or phone.
