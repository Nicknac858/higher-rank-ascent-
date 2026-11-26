"""Before/after validation for the glass navbar candidate.

Usage: python3 -I glassnav_test.py <repo_root> <out_dir> <component_js>

Renders the approved homepage (conduit/index.html) and the candidate
(candidates/glass-nav/index.html) in headless Chrome with software GL,
serving the CDN script from a local copy because this sandbox cannot reach
jsdelivr. Records frame timings, screenshots, contrast samples and a video.
"""
import json, sys, time, pathlib, statistics
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(sys.argv[1]); OUT = pathlib.Path(sys.argv[2]); COMP = pathlib.Path(sys.argv[3])
OUT.mkdir(parents=True, exist_ok=True)
CDN = "https://cdn.jsdelivr.net/gh/MuhammadaliMS/liquid-glass@1/dist/liquid-glass.js"
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
        "--ignore-gpu-blocklist", "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding"]
PAGES = {"before": ROOT / "conduit/index.html", "after": ROOT / "candidates/glass-nav/index.html"}

FRAME_JS = """(ms)=>new Promise(r=>{const t=[];let l=0;const s=performance.now();
 function f(n){ if(l) t.push(n-l); l=n; if(n-s<ms) requestAnimationFrame(f); else r(t);} requestAnimationFrame(f);})"""

CONTRAST_JS = """async()=>{
 // WCAG contrast of each nav label against the darkest-to-brightest backdrop pixels behind it.
 const lum=c=>{const f=v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)};return .2126*f(c[0])+.7152*f(c[1])+.0722*f(c[2]);};
 const out=[];
 for(const b of document.querySelectorAll('#nav button')){
   const cs=getComputedStyle(b); const m=cs.color.match(/[\\d.]+/g).map(Number);
   const r=b.getBoundingClientRect();
   out.push({id:b.id,color:cs.color,lum:lum(m),rect:[r.x,r.y,r.width,r.height]});
 }
 return out;}"""


import re
_cand = (ROOT / "candidates/glass-nav/index.html").read_text()
_style = re.search(r"<style>.*?</style>", _cand, re.S).group(0)
_nav = re.search(r"<liquid-glass.*?</liquid-glass>", _cand, re.S).group(0)
ISO = {
    "blank_page": f"<!doctype html><html><head>{_style}</head><body style='height:200vh'></body></html>",
    "glass_navbar_only": f"<!doctype html><html><head>{_style}<script type='module' src='{CDN}'></script></head><body style='height:200vh'>{_nav}</body></html>",
}


def stats(t):
    if not t:
        return {}
    s = sorted(t)
    return {"frames": len(t), "fps": round(1000 / statistics.mean(t), 1),
            "mean_ms": round(statistics.mean(t), 2), "p50_ms": round(s[len(s) // 2], 2),
            "p95_ms": round(s[int(len(s) * .95)], 2), "max_ms": round(s[-1], 2),
            "over_33ms": sum(1 for x in t if x > 33.4)}


def route(page, block_cdn=False):
    def handler(r):
        u = r.request.url
        if u.startswith(CDN):
            if block_cdn:
                return r.abort()
            return r.fulfill(path=str(COMP), content_type="text/javascript")
        if u.startswith("file://"):
            return r.continue_()
        return r.abort()  # fonts and anything else: offline here
    page.route("**/*", handler)


def open_page(b, which, vp, *, block_cdn=False, reduced=False, video=None, query=""):
    ctx = b.new_context(viewport=vp, device_scale_factor=1,
                        reduced_motion="reduce" if reduced else "no-preference",
                        record_video_dir=str(video) if video else None,
                        record_video_size=vp if video else None)
    p = ctx.new_page()
    logs = []
    p.on("console", lambda m: logs.append(f"{m.type}: {m.text}"))
    route(p, block_cdn)
    p.goto(PAGES[which].as_uri() + query)
    p.wait_for_timeout(9000)
    return ctx, p, logs


def scroll_to(p, f):
    p.evaluate("f=>scrollTo(0,(document.documentElement.scrollHeight-innerHeight)*f)", f)
    p.wait_for_timeout(2500)


def nav_contrast(p, shot):
    """Screenshot the nav, then measure text vs the brightest background pixel per label box."""
    from PIL import Image
    info = p.evaluate(CONTRAST_JS)
    img = Image.open(shot).convert("RGB")
    res = []
    for it in info:
        x, y, w, h = [int(round(v)) for v in it["rect"]]
        # background: pixels in the label's box that are not text (darkest 80% by luminance)
        px = [img.getpixel((i, j)) for i in range(x + 2, x + w - 2) for j in range(y + 2, y + h - 2)]
        def L(c):
            f = lambda v: (v / 255) / 12.92 if v / 255 <= .03928 else (((v / 255) + .055) / 1.055) ** 2.4
            return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2])
        ls = sorted(L(c) for c in px)
        bg = ls[int(len(ls) * .80)]  # bright end of the backdrop, excluding glyph pixels
        ratio = (max(it["lum"], bg) + .05) / (min(it["lum"], bg) + .05)
        res.append({"id": it["id"], "text": it["color"], "bg_lum_p80": round(bg, 4), "contrast": round(ratio, 2)})
    return res


def main():
    report = {"note": "Headless Chrome, SwiftShader software GL. Frame times are relative only; "
                      "they are not GPU or phone measurements.", "runs": {}}
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=ARGS)
        for vpname, vp in {"desktop": {"width": 1440, "height": 900}, "mobile": {"width": 390, "height": 844}}.items():
            for which in ("before", "after"):
                ctx, p, logs = open_page(b, which, vp, query="?nav=glass" if which == "after" else "")
                cdp = ctx.new_cdp_session(p); cdp.send("Performance.enable")
                key = f"{vpname}-{which}"
                run = {"frames": {}, "state": p.evaluate("()=>document.documentElement.dataset.navGlass||'n/a'")}
                for f in (0.0, 0.5, 0.97):
                    scroll_to(p, f)
                    m0 = {x["name"]: x["value"] for x in cdp.send("Performance.getMetrics")["metrics"]}
                    fr = stats(p.evaluate(FRAME_JS, 6000))
                    m1 = {x["name"]: x["value"] for x in cdp.send("Performance.getMetrics")["metrics"]}
                    span = m1["Timestamp"] - m0["Timestamp"]
                    fr["main_thread_busy_pct"] = round(100 * (m1["TaskDuration"] - m0["TaskDuration"]) / span, 1)
                    run["frames"][f"scroll{f}"] = fr
                    shot = OUT / f"{key}-scroll{int(f*100):02d}.png"
                    p.screenshot(path=str(shot))
                    nb = p.locator("#nav").bounding_box()
                    pad = 18
                    p.screenshot(path=str(OUT / f"{key}-nav-scroll{int(f*100):02d}.png"),
                                 clip={"x": max(0, nb["x"] - pad), "y": max(0, nb["y"] - pad),
                                       "width": nb["width"] + pad * 2, "height": nb["height"] + pad * 2})
                    run.setdefault("contrast", {})[f"scroll{f}"] = nav_contrast(p, shot)
                run["nav_box"] = p.locator("#nav .pill").bounding_box()
                run["state_end"] = p.evaluate("()=>document.documentElement.dataset.navGlass||'n/a'")
                run["console"] = [l for l in logs if "nav" in l or "glass" in l or "error" in l.lower()][:20]
                report["runs"][key] = run
                (OUT / "report.json").write_text(json.dumps(report, indent=2))
                ctx.close()

        # Guard on a slow machine: without ?nav=glass the candidate should fall back to the solid nav here.
        ctx, p, logs = open_page(b, "after", {"width": 1440, "height": 900})
        p.wait_for_timeout(6000)
        report["guard_on_this_machine"] = p.evaluate("()=>document.documentElement.dataset.navGlass")
        ctx.close()

        # Isolated cost of the glass scene: the navbar alone on a black page vs the same page without it.
        iso = {}
        for name, html in ISO.items():
            f = OUT.parent / f"_iso_{name}.html"; f.write_text(html)
            ctx = b.new_context(viewport={"width": 1440, "height": 900}); p = ctx.new_page(); route(p)
            cdp = ctx.new_cdp_session(p); cdp.send("Performance.enable")
            p.goto(f.as_uri()); p.wait_for_timeout(3000)
            m0 = {x["name"]: x["value"] for x in cdp.send("Performance.getMetrics")["metrics"]}
            fr = stats(p.evaluate(FRAME_JS, 6000))
            m1 = {x["name"]: x["value"] for x in cdp.send("Performance.getMetrics")["metrics"]}
            fr["main_thread_busy_pct"] = round(100 * (m1["TaskDuration"] - m0["TaskDuration"]) / (m1["Timestamp"] - m0["Timestamp"]), 1)
            iso[name] = fr; ctx.close(); f.unlink()
        report["isolated_navbar"] = iso

        # Interactions on the candidate: hover, open/close Work and Contact, toggle sound, keyboard focus.
        ctx, p, logs = open_page(b, "after", {"width": 1440, "height": 900}, query="?nav=glass")
        checks = {}
        p.hover("#btnWork"); p.wait_for_timeout(500)
        p.screenshot(path=str(OUT / "desktop-after-hover.png"), clip={"x": 1100, "y": 0, "width": 340, "height": 110})
        p.click("#btnWork"); p.wait_for_timeout(900)
        checks["work_opens"] = p.evaluate("()=>document.getElementById('work').classList.contains('on')")
        p.keyboard.press("Escape"); p.wait_for_timeout(700)
        checks["work_closes"] = not p.evaluate("()=>document.getElementById('work').classList.contains('on')")
        p.click("#btnContact"); p.wait_for_timeout(900)
        checks["contact_opens"] = p.evaluate("()=>document.getElementById('contact').classList.contains('on')")
        p.keyboard.press("Escape"); p.wait_for_timeout(700)
        p.click("#btnSound"); p.wait_for_timeout(300)
        checks["sound_toggles"] = p.evaluate("()=>document.getElementById('btnSound').getAttribute('aria-pressed')") == "true"
        p.click("#btnSound")
        p.keyboard.press("Tab"); p.wait_for_timeout(300)
        checks["tab_focus"] = p.evaluate("()=>document.activeElement&&document.activeElement.id")
        p.mouse.move(200, 500)
        y0 = p.evaluate("scrollY"); p.mouse.wheel(0, 1500); p.wait_for_timeout(1200)
        checks["wheel_scrolls"] = p.evaluate("scrollY") > y0
        checks["state"] = p.evaluate("()=>document.documentElement.dataset.navGlass")
        report["interactions"] = checks
        ctx.close()

        # Fallbacks.
        fb = {}
        for name, kw in {"cdn_blocked": {"block_cdn": True}, "reduced_motion": {"reduced": True, "query": "?nav=glass"},
                         "forced_solid": {"query": "?nav=solid"}}.items():
            ctx, p, logs = open_page(b, "after", {"width": 1440, "height": 900}, **kw)
            p.wait_for_timeout(1000)
            fb[name] = {"state": p.evaluate("()=>document.documentElement.dataset.navGlass||'pending'"),
                        "pill_bg": p.evaluate("()=>getComputedStyle(document.querySelector('#nav .pill')).backgroundColor")}
            nb = p.locator("#nav").bounding_box()
            p.screenshot(path=str(OUT / f"fallback-{name}.png"),
                         clip={"x": nb["x"] - 18, "y": max(0, nb["y"] - 18), "width": nb["width"] + 36, "height": nb["height"] + 36})
            if name == "reduced_motion":
                clip = {"x": nb["x"], "y": nb["y"], "width": nb["width"], "height": nb["height"]}
                a = p.screenshot(clip=clip); p.wait_for_timeout(1500); bb = p.screenshot(clip=clip)
                fb[name]["still"] = a == bb
            ctx.close()
        # WebGL context loss on the glass while running.
        ctx, p, logs = open_page(b, "after", {"width": 1440, "height": 900}, query="?nav=glass")
        p.evaluate("""()=>{const c=document.getElementById('nav').shadowRoot.querySelector('canvas');
            const g=c.getContext('webgl2')||c.getContext('webgl'); g.getExtension('WEBGL_lose_context').loseContext();}""")
        p.wait_for_timeout(800)
        fb["context_lost"] = {"state": p.evaluate("()=>document.documentElement.dataset.navGlass"),
                              "is_component": p.evaluate("()=>document.getElementById('nav').tagName")}
        ctx.close()
        report["fallbacks"] = fb

        # Short recording of the candidate: hover, menu, scroll through.
        vid = OUT / "video"
        ctx, p, logs = open_page(b, "after", {"width": 1280, "height": 720}, video=vid, query="?nav=glass")
        p.mouse.move(1180, 40, steps=12); p.hover("#btnWork"); p.wait_for_timeout(700)
        p.hover("#btnContact"); p.wait_for_timeout(700)
        p.click("#btnWork"); p.wait_for_timeout(1400); p.keyboard.press("Escape"); p.wait_for_timeout(800)
        p.mouse.move(400, 400)
        for _ in range(16):
            p.mouse.wheel(0, 420); p.wait_for_timeout(260)
        p.wait_for_timeout(1500)
        ctx.close()
        b.close()
    (OUT / "report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=1))


main()
