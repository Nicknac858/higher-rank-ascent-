# Higher Rank — concept site explorations

Separate design explorations for Higher Rank. Neither replaces any approved Higher Rank work.

## Candidates

**The Conduit** (current direction) — `conduit/index.html`
A sculptural power core wrapped in wires, with three replaceable media windows that travel
through the scene around it. One continuous WebGL world driven by scroll.

**Ascent** (earlier direction, not approved) — `index.html`
Moonlit dunes climbed toward sunrise. Preserved unchanged.

## Versions
`versions/` holds every save point, so nothing is lost:
- `v1-rank-order.html` — typographic ranked-list concept (not approved)
- `v2-ascent-terraces-vermilion.html` — first WebGL world
- `v3-ascent-terraces-aurora.html` — new palette and richer sky
- `v4-ascent-dunes.html` — moonlit dunes (same as `index.html`)
- `v5-conduit.html` — The Conduit (same as `conduit/index.html`)

## The Conduit — how it works
One self-contained file. Open it in a browser.

A single eased value `s` (0–10), driven by native page scroll, controls everything, so
scrolling backward reverses the journey exactly.

- **Sculpture** — six armature ribs between machined collars, heavy cables, helical conduits
  and fine filaments, all generated as tube meshes with rotation-minimising frames. A coiled
  emissive torus-knot heart sits inside a containment field. Node beads mark the junctions.
- **Lighting** — the heart is a point light at the centre; a camera-relative key and rim light
  keep the metal reading from every angle. GGX specular, procedural environment reflections,
  8× multisampling, bloom, filmic tone curve.
- **Particles** — curve positions are baked into a float texture; instanced sprites flow along
  the wires in the vertex shader, slow and brighten at the nodes, and shed outward as energy rises.
- **Media windows** — textured quads inside the 3D scene, depth-tested against the sculpture, so
  wires genuinely pass in front of and behind them. Positioned in camera space for exact framing.

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
