# Glass navbar candidate: review notes

Status: **candidate, not approved, not merged.** Branch `claude/glass-nav-candidate`.
Approved work is unchanged: `conduit/index.html`, the root `index.html` and everything in `versions/` are untouched.

- Candidate page: `candidates/glass-nav/index.html` (a copy of `conduit/index.html` with the navbar change only)
- Compare: open the candidate, and the same page with `?nav=solid` for the original navbar.
- `?nav=glass` pins the glass and skips the frame-rate check. It is for review on slow test machines only.

## What changed
- `<script type="module" src="https://cdn.jsdelivr.net/gh/MuhammadaliMS/liquid-glass@1/dist/liquid-glass.js">` in the head.
- The navbar is wrapped in `<liquid-glass id="nav" backdrop="aurora" dim="0.72" colors="#000000 #031437 #0b3fd6 #3fd8ff">`, and the navbar (`<nav class="pill" glass>`) carries the `glass` attribute. The buttons, their ids and handlers, sizes, typography and spacing are the same.
- The scene is clipped to the pill's own radius (`overflow:hidden`, `border-radius:999px`), so the canvas and aurora never reach past the navbar. The component's purple default background and its rainbow no-WebGL backdrop are switched off.
- Glass settings: dark deep-blue tint, thin slab (`--glass-depth:.32`, `--glass-dome:.3`), `--glass-ior:1.18`, light frost, no colour split (`--glass-chroma:0`), no pointer bulge (`--glass-pull:0`), no press growth (`--glass-press:1`), no drop shadow, no sound glow, no `inner-light`.
- The component adds a fixed white specular term to the whole glass face, which read as a grey wash. A `contrast(1.45) saturate(1.2)` filter on its canvas pulls that back to near-black and keeps the blue movement.
- Dim: started at 0.8. That was near-black with almost no visible aurora, so it is now 0.72, with the contrast curve above. Text contrast stays above 4.5:1 (below).

## Fallback: the original navbar returns when
| Condition | How it is detected | Tested |
|---|---|---|
| CDN blocked or offline | the component never reports ready within 6 s | yes, `solid:not-ready` |
| No WebGL, or the glass loses its context | the component sets `data-renderer="css"` | yes, forced context loss, `solid:webgl-unavailable` |
| The page itself fell back from WebGL | `body.fallback` | by code path |
| Slow frames | two 2-second windows averaging over 22 ms, or the main scene lowering its own render scale | yes, this test machine trips it (see below) |
| More contrast or forced colours requested | CSS media queries | by code path |
| `?nav=solid` | address | yes |

Reverting removes the component entirely (its canvas and loop stop) and leaves the original navbar in place. Until the component confirms a working WebGL render, the navbar draws exactly as the original. Reduced motion: the component holds the aurora and glass still (tested: two captures 1.5 s apart are identical).

## Results
Tested in headless Chrome with **software rendering (SwiftShader)**, 1440×900 and 390×844. The CDN and Google Fonts cannot be reached from the test machine, so the component was served from a local copy of the same release (1.1.1), and fonts fell back to system fonts in both before and after.

Frame rate, whole page (before = solid, after = glass pinned):

| | before fps / p95 | after fps / p95 |
|---|---|---|
| Desktop, top | 1.9 / 567 ms | 1.8 / 700 ms |
| Desktop, middle | 2.2 / 550 ms | 2.2 / 500 ms |
| Desktop, end | 2.0 / 600 ms | 2.0 / 600 ms |
| Mobile, top | 7.8 / 167 ms | 7.7 / 167 ms |
| Mobile, middle | 11.8 / 117 ms | 11.9 / 100 ms |
| Mobile, end | 11.0 / 117 ms | 10.8 / 100 ms |

The 3D scene dominates on a software renderer, so the whole-page numbers are within noise. Measured alone on a black page, the glass navbar held 40 fps (60 fps without it) and kept the CPU busy, because software rendering runs its ray-traced shader on the CPU. **This is not a GPU measurement.** On a real graphics chip the navbar is a small area (about 200×36 px) and should be far cheaper, but that is unverified. The guard handles the case where it is not: on this machine it switched back to the solid navbar after about 4 seconds (`solid:slow-frames`), and Work, Contact and sound still worked afterwards.

Text contrast (navbar labels against the brighter 20% of pixels behind them):

| | before | after |
|---|---|---|
| Desktop, lowest | 4.98 | 4.84 |
| Mobile, lowest | **3.98** (fails 4.5) | 5.49 |

Interactions with the glass on: Work opens and closes, Contact opens, Escape closes, sound toggles, keyboard focus and wheel scrolling work.

Visual check: no border, no white outline, no rainbow, no glow outside the pill, same dimensions and position (desktop 200.6×36 at the same place; mobile 184.3×35).

## Trade-offs to weigh
- **The glass does not show the 3D scene behind it.** Browsers do not let WebGL read the page, so the component refracts its own aurora, not the wires. The original navbar was a blurred window onto the scene; the glass version is a dark lens with a slow deep-blue sheen, so the wires disappear behind the navbar.
- The aurora animates, so the glass redraws every frame while it is on screen (it pauses in background tabs and when reduced motion is on).
- A second WebGL context on phones. The guard covers slowdowns, but the S23 Ultra has not been tested.
- The light still drifts slightly toward the pointer and brightens about 6% on hover. These are built into the component and cannot be switched off from CSS.
- The script loads from jsdelivr at `@1`, so a future 1.x release would load automatically. Pinning to `@1.1.1` would make that deliberate.

## Evidence in this folder
- `compare-navbar.png`: before and after crops, desktop and mobile, three scroll positions
- `*-before-*` and `*-after-*`: full screenshots (jpg) and navbar crops (png)
- `desktop-after-hover.png`, `fallback-*.png`
- `recording-glass-nav.mp4`: hover, the Work menu and scrolling with the glass on (software rendering, so it plays at a low frame rate)
- `report.json`: raw numbers; `glassnav_test.py`: the test script
