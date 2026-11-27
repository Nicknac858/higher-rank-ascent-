"""Render review frames of the arena build with headless Chrome + SwiftShader.

usage: python3 -I tools/shoot.py <dist_dir> <out_dir> [desktop|mobile|both] [T values comma-separated]
"""
import sys, os, time, json, subprocess, socket
from playwright.sync_api import sync_playwright

dist, out = sys.argv[1], sys.argv[2]
which = sys.argv[3] if len(sys.argv) > 3 else 'both'
Ts = [float(x) for x in (sys.argv[4] if len(sys.argv) > 4 else '0,1,2,3,4').split(',')]
extra = sys.argv[5] if len(sys.argv) > 5 else ''
os.makedirs(out, exist_ok=True)

def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p

port = free_port()
srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1', '--directory', dist],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(0.8)
args = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl']
log = []
try:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=args, headless=True)
        configs = []
        if which in ('desktop', 'both'):
            configs.append(('desktop', dict(viewport={'width': 1280, 'height': 720}, device_scale_factor=1)))
        if which in ('mobile', 'both'):
            configs.append(('mobile', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=1, is_mobile=True, has_touch=True)))
        for name, cfg in configs:
            ctx = b.new_context(**cfg)
            page = ctx.new_page()
            page.on('console', lambda m, n=name: log.append(f'[{n}] {m.type}: {m.text}'))
            page.on('pageerror', lambda e, n=name: log.append(f'[{n}] PAGEERROR: {e}'))
            t0 = time.time()
            page.goto(f'http://127.0.0.1:{port}/index.html?test{extra}', wait_until='load')
            page.wait_for_function('window.__hrReady === true || document.documentElement.classList.contains("no-gl")', timeout=240000)
            log.append(f'[{name}] ready in {time.time()-t0:.1f}s fallback={page.evaluate("document.documentElement.dataset.fallback")}')
            if page.evaluate('document.documentElement.classList.contains("no-gl")'):
                page.screenshot(path=f'{out}/{name}-fallback.png'); continue
            log.append(f'[{name}] quality ' + json.dumps(page.evaluate('window.__hr.quality')))
            for T in Ts:
                unit = page.evaluate('document.querySelector(".probe").offsetHeight')
                page.evaluate(f'window.scrollTo(0, {T} * {unit})')
                t1 = time.time()
                page.evaluate(f'window.__hr.renderAt({{T: {T}, frames: 2}})')
                page.screenshot(path=f'{out}/{name}-T{T:.2f}.png')
                log.append(f'[{name}] T={T} rendered in {time.time()-t1:.1f}s')
            ctx.close()
        b.close()
finally:
    srv.terminate()
print('\n'.join(log[-60:]))
