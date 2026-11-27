# The Arena (stage one)

A round esports stage under a centre-hung halo of LED screens, inside a dark bowl. The
camera moves through it as you scroll. Built with Three.js, `postprocessing` and Lenis on Vite.

Stage one covers the hero, the three services (web design, marketing, live events and
esports) and a closing call to action. Events detail, process and work come in stage two.

## Run it

```bash
cd arena
npm install
npm run dev            # local preview
npm run build          # dist/ for Vercel (static output)
npm run build:single   # dist-single/index.html, one self-contained file for review links
```

Vercel settings: root directory `arena`, build command `npm run build`, output `dist`.

## The scroll story

`T` = scroll position in viewports (0 to 4). One value drives everything, and scrolling back
reverses it exactly.

| T | Shot |
|---|------|
| 0 | Hero: up in the lower seats, looking at the stage and halo. Giant HIGHER RANK type. |
| 1 | Web design screen swings in on a diagonal, settles beside the copy, swings out. |
| 2 | Marketing screen. |
| 3 | Live events and esports screen. |
| 4 | Close: high three-quarter view over the rig. |

The screens bend like flexible LED sheets with scroll speed (the Cloth Carousel reference)
and are real 3D planes inside the scene, so beams and haze pass in front and behind them.

On arrival the arena powers up in about four seconds: floor rings, stage, desks, halo, ticker,
beams, then the crowd. The copy is readable from the first frame; nothing blocks the page.

## Where to change things

| What | File |
|------|------|
| Camera keyframes per shot (desktop and phone) | `src/choreography.js` (`KEYS`) |
| Screen entry/focus/exit paths | `src/choreography.js` (`PATHS`) |
| Power-up timing | `src/choreography.js` (`SCHEDULE`) |
| Arena sizes (stage, halo, truss heights) | `src/arena.js` (`DIM`) |
| LED wall content (halo, ticker, underside, screens) | `src/textures.js` |
| Shaders (LED, beams, floor, crowd, dust, screens) | `src/materials.js` |
| Device tiers and the frame-rate governor | `src/quality.js` |
| Post (bloom, ACES tone mapping, vignette, grain) | `src/main.js` |
| Copy and page structure | `index.html` |

Screen content is placeholder art labelled "PLACEHOLDER — PROJECT FOOTAGE GOES HERE".
To use real footage, swap `makeScreenTexture(k)` for a `THREE.VideoTexture` of a muted,
looping, inline video; the screen shader takes any texture.

## Colour

Black, electric blue for the brand and structure, and one second colour (ultraviolet, `#9d00ff`)
kept to highlight moments: the rank chevrons, the centre of the stage, one beam in four, the
dashed floor ring, the crowd wave and the screens' broadcast bars. Buttons stay blue.
Compare other options with `?accent=electric|hot|magenta|purple|violet|gold|aqua|blue`, or `#electric` etc. on the
artifact link. The default lives in `src/main.js` (`ACCENTS`).

## Crowd

Never a visible loop: each person sways at their own tempo with a phase that wanders,
sections get livelier and calmer on a slow noise field, phones are raised and lowered at
random moments, wristbands follow a drifting show pattern (a third of them in the accent
colour), waves run on an irregular schedule (gaps, speed, direction and span all vary), and
the four crowd beams light up whoever they sweep across. All in the vertex shader.

## Crispness

Desktop renders above native resolution within a pixel budget (up to 2x, ~5.2 MP), then a
contrast-adaptive sharpening pass runs after tone mapping. LED walls keep their diodes fixed
and show cabinet seams; content steps across them like a real wall. Every fixture has a
crisp lens point with a thin anamorphic streak. Add `#stats` to the link for a frame-rate
and resolution readout.

## Built-in graphics (light profile)

Measured on the owner's PC (Intel HD Graphics 530, 717x867 window, `#bench`):
as first shipped 17 fps (1.5x render scale); at 1.0x 31 fps; MSAA and the full
reflection cost ~10 ms each, beam noise and bloom ~4 ms each, the crowd ~0.
Integrated GPUs (Intel HD/UHD/Iris, AMD integrated, Mali, PowerVR) now get the
light profile: native resolution, SMAA instead of MSAA, reflection at 0.3 scale
every other frame without beams/haze/crowd, noise-free beams and haze, half-res
bloom, no wash beams, 30 fps target. Result on the same machine: native 1.0x at
94-151 fps. `?q=light` forces it; `#bench` re-measures on any device.

## Quality and fallbacks

- Tiers: desktop high, phone (DPR capped at 1.75), low. `?q=low|mid|high` forces one.
- A governor watches frame time and lowers render resolution and reflection resolution
  step by step if frames run slow, and raises them again when there is headroom.
- No WebGL 2, or a software renderer: a pre-rendered poster of the hero replaces the 3D
  scene and the page works normally. `?nogl` forces this.
- Reduced motion: the camera holds the hero view, no drift, no power-up, no beam sweep;
  the screens appear in place. `?reduced` forces this.

## Testing

`tools/shoot.py` renders frames in headless Chrome with SwiftShader:

```bash
python3 -I tools/shoot.py dist /tmp/shots both 0,1,2,3,4
```

`?test` exposes `window.__hr.renderAt({ T, elapsed, vel })` for deterministic frames and
`?poster` hides the page so only the 3D frame is captured (used to make `src/poster.jpg`).

Not yet tested on a real GPU or phone.

## Device diagnostics (URL hash)

The artifact host only passes a simple `#name` to the page, so diagnostics are hash words joined with `-`,
e.g. `#crack-nosmaa`. Any of them also turns on the `#stats` readout.

- `#crack`: paints the frame behind the glass magenta, so any gap in the panes shows up.
- `#nosmaa`, `#nosharp`: drop the SMAA or sharpening pass.
- `#noenv`, `#nosheen`, `#noedge`, `#noback`: skip one glass term (reflection, sheen, edge + lip, frosted backdrop).
- `#noblur`: drop the frosted blur behind the glass nav and buttons; `#flat`: drop the title's depth shadows.
  These skip the computation rather than multiplying it by zero, because NaN times zero is still NaN.

Lessons from the owner's Intel HD 530 (ANGLE on D3D): a negative base raised to a power is NaN, the arc
tangent's branch cut produced NaN along a line across a flat glass pane, and mip bloom spreads a single NaN
pixel over the whole frame (that was the "black flicker"). The glass shader uses neither; its output also
passes through `max(., 0)`, which returns the non-NaN operand on D3D. SwiftShader in local tests computes
these "correctly", so check new shaders on the real device.

## Glass UI and title

The nav bar and buttons use the same glass as the broadcast windows: frosted, lit along the top edge,
the accent along the underside, and a glint that follows the pointer (`--gx` / `--gy`). Primary actions
are glossy blue with a sheen on hover. On the light profile (built-in GPUs) the live backdrop blur is
skipped (`html.lite`): measured on the owner's Intel HD 530 it cost more than the whole 3D scene saves
(67-78 fps at 0.86x with it, 89-99 fps at 1.0x without).

The title is two layers: `.depth` (a thin solid edge with an accent rim and a soft shadow, never
repainted) and `.face` (metallic gradient plus a band of light at `--sweep`). The light sweeps once when
the arena powers on and again as the hero scrolls away, while the title tilts back into the arena
(`updateDOM`). The nav pill slides to the section in view and a progress line runs along the bar.
Reduced motion: no tilt, sweep, sheen or pill animation.

## Live preview (Vercel)

- URL: https://higher-rank-arena.vercel.app (project `higher-rank-arena`, team `nyoung-6483`), separate from the
  owner's existing `higher-rank-website` project, which is untouched.
- Built by Vercel from GitHub: repo `Nicknac858/higher-rank-ascent-`, branch `claude/arena-hero`, root `arena`,
  `npm ci` then `npm run build`, output `dist`, framework Vite.
- First deploy 2026-11-27 from commit 8bb32eb (deployment `dpl_2jgVvt1fAExbwZPRb7A6nLDBgtdr`).
- The live link changes only when a new production deploy is made from this branch (the project's production
  branch is the repo default, which has no `arena/` folder). Update it once the owner approves a new version.
- `<meta name="robots" content="noindex">` keeps the concept (placeholder footage) out of search results;
  remove it at launch.
