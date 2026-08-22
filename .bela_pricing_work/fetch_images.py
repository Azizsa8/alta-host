"""Download every unique product image once, downscale to a catalog thumbnail,
and store as a base64 data URI keyed by original URL."""
import json, io, base64, urllib.request
from concurrent.futures import ThreadPoolExecutor
from PIL import Image

HDRS = {'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36'}
MAX = (190, 190)

results = json.load(open("photo_results.json", encoding="utf-8"))
urls = sorted({r['image_url'] for r in results
               if r.get('photo_found') and str(r.get('image_url', '')).startswith('http')})
print("unique urls:", len(urls))

def grab(u):
    try:
        req = urllib.request.Request(u, headers=HDRS)
        raw = urllib.request.urlopen(req, timeout=20).read()
        if len(raw) > 12_000_000:
            return u, None
        im = Image.open(io.BytesIO(raw))
        im.load()
        if im.mode in ('RGBA', 'LA', 'P'):
            bg = Image.new('RGB', im.size, (255, 255, 255))
            im = im.convert('RGBA')
            bg.paste(im, mask=im.split()[-1])
            im = bg
        else:
            im = im.convert('RGB')
        im.thumbnail(MAX, Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, 'JPEG', quality=64, optimize=True)
        return u, "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
    except Exception:
        return u, None

out = {}
with ThreadPoolExecutor(max_workers=16) as ex:
    for i, (u, d) in enumerate(ex.map(grab, urls), 1):
        if d:
            out[u] = d
        if i % 100 == 0:
            print(f"  {i}/{len(urls)} ... {len(out)} ok")

json.dump(out, open("image_data.json", "w", encoding="utf-8"))
total_kb = sum(len(v) for v in out.values()) / 1024
print(f"downloaded {len(out)}/{len(urls)}  payload {total_kb/1024:.1f} MB")
