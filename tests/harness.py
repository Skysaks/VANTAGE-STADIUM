"""Outils communs aux tests Playwright (GPU logiciel SwiftShader : seules les mesures relatives ont un sens)."""
import pathlib, time, json
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
DESKTOP = {'width': 1440, 'height': 900}
MOBILE = dict(viewport={'width': 390, 'height': 844}, device_scale_factor=1, is_mobile=True, has_touch=True)

def url(flavor='lab', query=''):
    name = {'public': 'vantage.html', 'presentation': 'vantage-presentation.html', 'lab': 'vantage-lab.html'}[flavor]
    return (ROOT / 'dist' / name).as_uri() + (('?' + query) if query else '')

class Page:
    def __init__(self, pw, flavor='lab', query='', mobile=False, viewport=None, reduced=False, nominal=False):
        self.b = pw.chromium.launch(args=ARGS)
        kw = dict(MOBILE) if mobile else dict(viewport=viewport or DESKTOP)
        if viewport and mobile: kw['viewport'] = viewport
        if reduced: kw['reduced_motion'] = 'reduce'
        # The built files carry a strict CSP; the test driver itself evaluates strings (wait_for_function,
        # axe-core injection), so its own scripts bypass the policy. CSP behaviour is covered by tests/csp.py.
        kw['bypass_csp'] = True
        self.ctx = self.b.new_context(**kw)
        self.p = self.ctx.new_page()
        self.errors = []
        self.p.on('pageerror', lambda e: self.errors.append(str(e)))
        self.p.on('console', lambda m: self.errors.append(m.text) if m.type == 'error' else None)
        self.p.goto(url(flavor, query))
        self.p.wait_for_function('window.__vantage && window.__vantage.ready', timeout=120000)
        # GPU logiciel : la qualité adaptative descend au minimum (résolution ×0,72). Les captures de référence
        # (nominal=True) se font au profil nominal de l'appareil simulé (bureau : High, téléphone : Mobile), résolution ×1.
        if nominal: self.p.evaluate("(m) => { const q = __vantage.e.quality; q.set(m ? 'mobile' : 'high'); q.tier = 'high'; q.resScale = 1; __vantage.e.applyQuality(); }", bool(mobile))
        self.cdp = self.ctx.new_cdp_session(self.p) if mobile else None

    def js(self, code, arg=None):
        return self.p.evaluate(code, arg) if arg is not None else self.p.evaluate(code)

    def wait(self, ms):
        self.p.wait_for_timeout(ms)

    def idle(self, timeout=90000):
        """Attend la fin des transitions caméra et des chargements."""
        self.p.wait_for_function('!window.__vantage.busy && !window.__vantage.d.busy', timeout=timeout)

    def frames(self, n=2):
        """Attend n images réellement rendues (GPU logiciel : une image peut prendre plus d'une seconde)."""
        self.p.evaluate('(n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); })', n)

    def shot(self, path, settle=350):
        self.frames(2); self.wait(settle); self.frames(2)
        self.p.screenshot(path=str(path), timeout=240000, animations='disabled')

    def tap(self, x, y):
        # horodatages explicites : le GPU logiciel retarde le traitement des événements, pas leur heure matérielle
        if self.cdp:
            t0 = time.time()
            for k, t in enumerate(('touchStart', 'touchEnd')):
                self.cdp.send('Input.dispatchTouchEvent', {'type': t, 'touchPoints': [{'x': x, 'y': y}] if t == 'touchStart' else [], 'timestamp': t0 + k * 0.06})
                self.wait(60)
        else:
            self.p.mouse.click(x, y)

    def drag(self, x0, y0, x1, y1, steps=8, step_ms=30):
        if self.cdp:
            t0 = time.time()
            self.cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x0, 'y': y0}], 'timestamp': t0})
            for k in range(1, steps + 1):
                self.wait(step_ms)
                self.cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x0 + (x1 - x0) * k / steps, 'y': y0 + (y1 - y0) * k / steps}], 'timestamp': t0 + k * step_ms / 1000})
            self.cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': [], 'timestamp': t0 + (steps + 1) * step_ms / 1000})
        else:
            m = self.p.mouse
            m.move(x0, y0); m.down()
            for k in range(1, steps + 1):
                self.wait(step_ms); m.move(x0 + (x1 - x0) * k / steps, y0 + (y1 - y0) * k / steps)
            m.up()

    def screen_of_seat(self, i):
        return self.js('''(i) => { const a = window.__vantage, v = a.e.venue, c = a.e.camera; const p = new (c.position.constructor)(v.px[i], v.py[i] + 0.55, v.pz[i]).project(c);
          const r = a.el.canvas.getBoundingClientRect(); return [r.left + (p.x * 0.5 + 0.5) * r.width, r.top + (-p.y * 0.5 + 0.5) * r.height, p.z]; }''', i)

    def close(self):
        self.b.close()
