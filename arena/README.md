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
