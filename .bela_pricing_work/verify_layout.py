"""Drive headless Chromium over CDP to verify the sticky header does not
overlap the controls bar, at several real viewport widths."""
import json, subprocess, time, urllib.request, os, base64, socket
from urllib.request import urlopen

CHROME = os.path.expanduser("~/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome")
URL = "http://localhost:8933/"
PW = "BELA226$"


def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p


class CDP:
    def __init__(self, ws):
        from websocket import create_connection          # websocket-client
        self.ws = create_connection(ws, timeout=60)
        self.i = 0

    def send(self, method, **params):
        self.i += 1
        self.ws.send(json.dumps({"id": self.i, "method": method, "params": params}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == self.i:
                if "error" in msg:
                    raise RuntimeError(msg["error"])
                return msg.get("result", {})

    def js(self, expr, awaits=False):
        r = self.send("Runtime.evaluate", expression=expr, returnByValue=True,
                      awaitPromise=awaits, userGesture=True)
        return r.get("result", {}).get("value")


def main():
    port = free_port()
    proc = subprocess.Popen(
        [CHROME, f"--remote-debugging-port={port}", "--headless=new", "--no-sandbox",
         "--disable-gpu", "--hide-scrollbars", "--window-size=1280,900",
         "--remote-allow-origins=*", "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        ws = None
        for _ in range(60):
            try:
                tabs = json.loads(urlopen(f"http://127.0.0.1:{port}/json").read())
                page = [t for t in tabs if t["type"] == "page"]
                if page:
                    ws = page[0]["webSocketDebuggerUrl"]; break
            except Exception:
                pass
            time.sleep(0.4)
        if not ws:
            raise SystemExit("chrome did not expose a page target")

        c = CDP(ws)
        c.send("Page.enable"); c.send("Runtime.enable")

        results = {}
        for label, w, h in [("desktop", 1280, 900), ("laptop", 1024, 800), ("tablet", 900, 800)]:
            c.send("Emulation.setDeviceMetricsOverride", width=w, height=h,
                   deviceScaleFactor=1, mobile=False)
            c.send("Page.navigate", url=URL + "?v=" + str(time.time()))
            time.sleep(3.0)
            c.js(f"document.getElementById('pw').value={json.dumps(PW)};"
                 "document.getElementById('gform').dispatchEvent(new Event('submit',{cancelable:true}));")
            time.sleep(6.0)
            c.js("document.getElementById('brand').value='KNIPEX';"
                 "document.getElementById('brand').dispatchEvent(new Event('change'));"
                 "[...document.querySelectorAll('#seg button')].find(b=>b.dataset.v==='list').click();")
            time.sleep(1.2)
            c.js("scrollTo(0,1400)")
            time.sleep(0.8)

            results[label] = c.js("""(()=>{
              const bar=document.querySelector('.controls').getBoundingClientRect();
              const hd=document.querySelector('.listhead');
              if(!hd) return {note:'listhead hidden at this width'};
              const h=hd.getBoundingClientRect();
              const row=document.querySelector('.row').getBoundingClientRect();
              const cs=getComputedStyle(hd);
              return {
                stick:getComputedStyle(document.documentElement).getPropertyValue('--stick').trim(),
                controlsH:Math.round(bar.height), controlsBottom:Math.round(bar.bottom),
                headTop:Math.round(h.top), headBottom:Math.round(h.bottom),
                headDisplay:cs.display,
                gapToControls:Math.round(h.top-bar.bottom),
                OVERLAP: h.top < bar.bottom-1,
                rowClearsHeader: row.top >= h.bottom-1,
                headerVisible: h.height>0 && h.top>=0
              };})()""")

            if label == "desktop":
                shot = c.send("Page.captureScreenshot", format="png")
                open("layout_desktop.png", "wb").write(base64.b64decode(shot["data"]))
                c.js("scrollTo(0,0)"); time.sleep(0.5)
                c.js("[...document.querySelectorAll('#seg button')].find(b=>b.dataset.v==='grid').click();")
                time.sleep(1.0)
                shot = c.send("Page.captureScreenshot", format="png")
                open("layout_hero.png", "wb").write(base64.b64decode(shot["data"]))

        print(json.dumps(results, indent=2, ensure_ascii=False))
    finally:
        proc.terminate()


if __name__ == "__main__":
    main()
