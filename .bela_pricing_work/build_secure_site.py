"""Build the deployable, password-protected buyer catalog.

The item payload (including embedded photos) is encrypted with AES-256-GCM using
a key derived from the passphrase via PBKDF2-SHA256. The passphrase itself is
never written into the output, so the published file reveals nothing without it.
"""
import json, re, os, base64, hashlib, secrets
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

PASSPHRASE = os.environ["CATALOG_PASSPHRASE"]
ITERATIONS = 210_000
OUTDIR = "site"

CAT = {
    'machinery': 'الآلات والمعدات',
    'premium':   'أجهزة القياس والفحص',
    'other':     'العدد والأدوات اليدوية',
    'draper':    'أدوات دريبر',
}
CAT_ORDER = ['machinery', 'premium', 'other', 'draper']
COO_AR = {
    'GERMANY':'ألمانيا','USA':'الولايات المتحدة','UK':'المملكة المتحدة','SPAIN':'إسبانيا',
    'ITALY':'إيطاليا','AUSTRIA':'النمسا','JAPAN':'اليابان','SWEDEN':'السويد',
    'DENMARK':'الدنمارك','TW':'تايوان',
}
AR_RUN = re.compile(r'[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]+')


def clean_spec(descr):
    s = AR_RUN.sub(' ', descr)
    s = re.sub(r'\s+', ' ', s)
    s = re.sub(r'^[\s,.\-/:;]+|[\s,.\-/:;]+$', '', s)
    s = re.sub(r'\s*,\s*', ', ', s)
    s = re.sub(r'(?<!\b[A-Za-z])\s+\d{1,2}$', '', s)
    m = re.search(r'(?<!\b[A-Za-z])\s+(\d{3,})$', s)
    if m and m.group(1) in s[:m.start()]:
        s = s[:m.start()]
    return s if len(re.sub(r'[^A-Za-z0-9]', '', s)) >= 2 else ''


def bucket_of(brand):
    MACH = {'EPS','SOLTER','SCANTOOL','GRIGGRIO','CITY','BUCO'}
    PREM = {'FLUKE','KNIPEX','EXTECH','AMPROBE','KLAUKE','WAVETEK','B/K','ALNOR','MITUTOY','COLEPARME','BW'}
    b = brand.strip().upper()
    if b in MACH: return 'machinery'
    if b in PREM: return 'premium'
    if b == 'DRAPER': return 'draper'
    return 'other'


def main():
    rows = json.load(open("inventory_full.json", encoding="utf-8"))
    imgs = json.load(open("image_data.json", encoding="utf-8"))

    items = []
    for r in rows:
        qty = float(r['qty'])
        if qty <= 0:
            continue
        brand = (r['brand_clean'] or '').strip()
        items.append({
            "c": (r['code'] or '').strip(),
            "b": brand,
            "q": int(qty),
            "u": (r.get('uom') or '').strip(),
            "o": COO_AR.get(r.get('coo_clean') or '', ''),
            "t": clean_spec(re.sub(r'\s+', ' ', r['descr'] or '').strip()),
            "d": (r.get('description_ar_rich') or r.get('description_ar') or '').strip(),
            "g": bucket_of(brand),
            "p": imgs.get(r.get('image_url'), ""),
        })
    items.sort(key=lambda x: (CAT_ORDER.index(x['g']), x['b'], -x['q']))

    cats = [{"id": g, "label": CAT[g], "n": sum(1 for i in items if i['g'] == g)}
            for g in CAT_ORDER if any(i['g'] == g for i in items)]

    # brands, biggest first — the practical second axis once a category is picked
    bcount = {}
    for i in items:
        if i['b']:
            bcount[i['b']] = bcount.get(i['b'], 0) + 1
    brands = [{"b": b, "n": n} for b, n in sorted(bcount.items(), key=lambda x: (-x[1], x[0]))]
    stats = {
        "total": len(items),
        "units": sum(i['q'] for i in items),
        "brands": len({i['b'] for i in items if i['b']}),
        "photos": sum(1 for i in items if i['p']),
    }

    plaintext = json.dumps({"items": items, "cats": cats, "brands": brands},
                           ensure_ascii=False, separators=(',', ':')).encode('utf-8')

    salt = secrets.token_bytes(16)
    iv = secrets.token_bytes(12)
    key = hashlib.pbkdf2_hmac('sha256', PASSPHRASE.encode('utf-8'), salt, ITERATIONS, 32)
    blob = AESGCM(key).encrypt(iv, plaintext, None)

    enc = {
        "v": 1,
        "kdf": {"name": "PBKDF2", "hash": "SHA-256", "iterations": ITERATIONS,
                "salt": base64.b64encode(salt).decode()},
        "iv": base64.b64encode(iv).decode(),
        "ct": base64.b64encode(blob).decode(),
    }

    os.makedirs(OUTDIR, exist_ok=True)
    with open(f"{OUTDIR}/data.json", "w", encoding="utf-8") as f:
        json.dump(enc, f)

    html = TEMPLATE
    for k, v in stats.items():
        html = html.replace(f"__{k.upper()}__", f"{v:,}")
    with open(f"{OUTDIR}/index.html", "w", encoding="utf-8") as f:
        f.write(html)

    with open(f"{OUTDIR}/_headers", "w", encoding="utf-8") as f:
        f.write("/*\n"
                "  X-Frame-Options: SAMEORIGIN\n"
                "  X-Content-Type-Options: nosniff\n"
                "  Referrer-Policy: no-referrer\n"
                "  X-Robots-Tag: noindex, nofollow\n")
    with open(f"{OUTDIR}/robots.txt", "w", encoding="utf-8") as f:
        f.write("User-agent: *\nDisallow: /\n")

    # the passphrase must never be recoverable from what we publish
    for fn in ("index.html", "data.json"):
        body = open(f"{OUTDIR}/{fn}", encoding="utf-8").read()
        assert PASSPHRASE not in body, f"passphrase leaked into {fn}"
    probe = json.dumps(items[:40], ensure_ascii=False)[:400]
    assert probe not in open(f"{OUTDIR}/data.json", encoding="utf-8").read()

    print(f"items {stats['total']}  photos {stats['photos']}  brands {stats['brands']}")
    print(f"data.json {os.path.getsize(OUTDIR+'/data.json')/1024/1024:.1f} MB (encrypted)")
    print(f"index.html {os.path.getsize(OUTDIR+'/index.html')/1024:.0f} KB")


TEMPLATE = r"""<!-- catalog -->
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>قائمة المعروضات — عدد وأدوات ومعدات</title>
<style>
:root{
  --bg:#ffffff; --surface:#f6f7f9; --ink:#15181c; --dim:#5f6873;
  --line:#e3e7ec; --accent:#1f5673; --soft:#e8eff3; --amber:#b5651d;
  --shadow:0 1px 2px rgba(16,24,32,.05), 0 8px 24px -12px rgba(16,24,32,.16);
}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:var(--bg)}
body{font-family:"Segoe UI","Tahoma","Geeza Pro","Noto Naskh Arabic","Noto Sans Arabic",Arial,sans-serif;
  color:var(--ink);line-height:1.7;direction:rtl;-webkit-font-smoothing:antialiased}
.n{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-variant-numeric:tabular-nums;
  direction:ltr;unicode-bidi:isolate}
.wrap{max-width:1280px;margin:0 auto;padding:0 1.25rem}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}

/* ── gate ─────────────────────────────────── */
#gate{position:fixed;inset:0;z-index:100;background:var(--surface);
  display:flex;align-items:center;justify-content:center;padding:1.5rem}
.gatebox{width:100%;max-width:400px;background:#fff;border:1px solid var(--line);
  border-radius:14px;padding:2rem 1.9rem;box-shadow:var(--shadow);text-align:center}
.lock{width:46px;height:46px;border-radius:50%;background:var(--soft);color:var(--accent);
  display:flex;align-items:center;justify-content:center;margin:0 auto 1rem}
.gatebox h1{font-size:1.2rem;margin:0 0 .35rem}
.gatebox p{color:var(--dim);font-size:.88rem;margin:0 0 1.3rem}
#pw{width:100%;padding:.7rem .85rem;border:1px solid var(--line);border-radius:8px;
  font-size:1rem;font-family:inherit;text-align:center;letter-spacing:.06em;background:#fff;color:var(--ink)}
#pw:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--soft)}
#go{width:100%;margin-top:.7rem;padding:.7rem;border:0;border-radius:8px;background:var(--accent);
  color:#fff;font-size:.95rem;font-weight:700;font-family:inherit;cursor:pointer;transition:opacity .15s}
#go:hover{opacity:.9} #go:disabled{opacity:.55;cursor:progress}
#err{color:#a6342a;font-size:.85rem;margin-top:.7rem;min-height:1.2em}
.shake{animation:shake .35s}
@keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-7px)}75%{transform:translateX(7px)}}

/* ── app ──────────────────────────────────── */
#app{display:none}
.masthead{border-bottom:1px solid var(--line);background:var(--surface)}
.masthead .wrap{padding:2.4rem 1.25rem 1.9rem}
.eyebrow{font-size:.75rem;letter-spacing:.16em;color:var(--accent);font-weight:700;margin:0 0 .5rem}
h1.title{font-size:clamp(1.5rem,3.4vw,2.2rem);margin:0 0 .5rem;font-weight:800;letter-spacing:-.01em}
.lede{color:var(--dim);max-width:62ch;margin:0;font-size:.98rem}
.facts{display:flex;flex-wrap:wrap;gap:2.2rem;margin-top:1.6rem}
.fact .v{font-size:1.5rem;font-weight:800;line-height:1.2;font-family:ui-monospace,monospace}
.fact .l{font-size:.74rem;color:var(--dim)}

/* category tiles — the fast way in */
.cattiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:.7rem;margin-top:1.8rem}
.cattiles button{position:relative;text-align:right;background:#fff;border:1px solid var(--line);
  border-radius:11px;padding:.85rem .95rem;cursor:pointer;font-family:inherit;
  display:flex;flex-direction:column;gap:.15rem;overflow:hidden;
  transition:border-color .18s,box-shadow .22s,transform .18s}
.cattiles button::after{content:"";position:absolute;inset-inline-start:0;top:0;bottom:0;width:3px;
  background:var(--accent);transform:scaleY(0);transform-origin:top;transition:transform .24s}
.cattiles button:hover{border-color:var(--accent);box-shadow:var(--shadow);transform:translateY(-2px)}
.cattiles button[aria-pressed="true"]{border-color:var(--accent);background:var(--soft)}
.cattiles button[aria-pressed="true"]::after{transform:scaleY(1)}
.cattiles .cl{font-size:.92rem;font-weight:700;color:var(--ink)}
.cattiles .cn{font-size:.76rem;color:var(--dim);font-family:ui-monospace,monospace}

/* view switch */
.switchrow{display:flex;flex-wrap:wrap;align-items:center;gap:1rem;margin-top:1.7rem;
  padding-top:1.4rem;border-top:1px solid var(--line)}
.seg{position:relative;display:inline-flex;background:#fff;border:1px solid var(--line);
  border-radius:11px;padding:4px;box-shadow:var(--shadow)}
.seg .pill{position:absolute;top:4px;bottom:4px;border-radius:8px;background:var(--accent);
  transition:transform .34s cubic-bezier(.34,1.4,.5,1),width .34s cubic-bezier(.34,1.4,.5,1);z-index:0}
.seg button{position:relative;z-index:1;display:inline-flex;align-items:center;gap:.45rem;
  border:0;background:none;padding:.5rem .95rem;border-radius:8px;cursor:pointer;
  font-family:inherit;font-size:.88rem;font-weight:600;color:var(--dim);
  transition:color .22s;white-space:nowrap}
.seg button[aria-pressed="true"]{color:#fff}
.seg svg{width:16px;height:16px;flex:none}
.switchnote{font-size:.84rem;color:var(--dim);max-width:44ch;transition:opacity .2s}
.switchnote b{color:var(--ink);font-weight:700}

/* controls */
.controls{position:sticky;top:0;z-index:20;background:rgba(255,255,255,.94);
  backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
.controls .wrap{display:flex;flex-wrap:wrap;gap:.6rem;align-items:center;padding:.7rem 1.25rem}
#q{flex:1;min-width:200px;padding:.55rem .8rem;border:1px solid var(--line);border-radius:6px;
  font-family:inherit;font-size:.9rem;background:#fff;color:var(--ink)}
#q:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--soft)}
.tab{padding:.4rem .85rem;border:1px solid var(--line);border-radius:99px;background:#fff;
  color:var(--dim);font-size:.83rem;cursor:pointer;white-space:nowrap;font-family:inherit;transition:.15s}
.tab:hover{border-color:var(--accent)}
.tab[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:700}
#brand{padding:.42rem .7rem;border:1px solid var(--line);border-radius:99px;background:#fff;
  color:var(--ink);font-family:inherit;font-size:.83rem;cursor:pointer;max-width:210px}
#brand:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--soft)}
#brand.on{background:var(--accent);color:#fff;border-color:var(--accent);font-weight:700}
.clear{padding:.4rem .8rem;border:1px solid transparent;border-radius:99px;background:#fbeceb;
  color:#a6342a;font-size:.8rem;font-weight:700;font-family:inherit;cursor:pointer;white-space:nowrap}
.clear:hover{background:#f7dedb}
.count{font-size:.82rem;color:var(--dim);margin-inline-start:auto;white-space:nowrap}

main{padding:1.6rem 0 4rem}
.cathead{display:flex;align-items:baseline;gap:.7rem;margin:2.2rem 0 1rem;
  border-bottom:2px solid var(--ink);padding-bottom:.45rem}
.cathead h2{font-size:1.15rem;margin:0}
.cathead .c{font-size:.8rem;color:var(--dim);font-family:ui-monospace,monospace}

/* view: grid */
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(215px,1fr));gap:1rem}
.card{border:1px solid var(--line);border-radius:9px;overflow:hidden;background:#fff;
  display:flex;flex-direction:column;break-inside:avoid;animation:fade .3s both}
.shot{aspect-ratio:4/3;background:var(--surface);display:flex;align-items:center;justify-content:center;
  border-bottom:1px solid var(--line);overflow:hidden;text-decoration:none}
.shot img{max-width:100%;max-height:100%;object-fit:contain;mix-blend-mode:multiply}
.noshot{color:#b4bcc5;font-size:.72rem;text-align:center;padding:.5rem;line-height:1.5}
.body{padding:.75rem .85rem .85rem;display:flex;flex-direction:column;gap:.4rem;flex:1}
.tophead{display:flex;justify-content:space-between;align-items:flex-start;gap:.5rem}
.brand{font-size:.68rem;letter-spacing:.09em;color:var(--accent);font-weight:800}
.qty{font-size:.72rem;font-weight:800;color:var(--amber);background:#fbf1e8;
  padding:.12rem .5rem;border-radius:5px;white-space:nowrap;font-family:ui-monospace,monospace}
.code{font-family:ui-monospace,monospace;font-size:.88rem;font-weight:700;color:var(--ink);
  text-decoration:none;direction:ltr;display:block;word-break:break-word}
.code:hover{color:var(--accent);text-decoration:underline}
.spec{font-size:.72rem;color:var(--dim);direction:ltr;text-align:right;word-break:break-word;
  font-family:ui-monospace,monospace;line-height:1.5}
.desc{font-size:.83rem;color:#39414a;margin-top:auto;padding-top:.2rem}
.origin{font-size:.7rem;color:var(--dim)}

/* view: list */
.list{display:flex;flex-direction:column;border:1px solid var(--line);border-radius:9px;overflow:hidden}
.row{display:grid;grid-template-columns:64px minmax(120px,1.1fr) minmax(180px,2.4fr) auto;
  gap:.9rem;align-items:center;padding:.6rem .85rem;border-bottom:1px solid var(--line);
  background:#fff;animation:fade .3s both}
.row:last-child{border-bottom:0}
.row:nth-child(even){background:#fcfdfd}
.row:hover{background:var(--soft)}
.thumb{width:64px;height:52px;background:var(--surface);border:1px solid var(--line);border-radius:6px;
  display:flex;align-items:center;justify-content:center;overflow:hidden;text-decoration:none}
.thumb img{max-width:100%;max-height:100%;object-fit:contain;mix-blend-mode:multiply}
.thumb span{font-size:.58rem;color:#b4bcc5;text-align:center;line-height:1.3;padding:2px}
.rid .code{font-size:.84rem}
.rid .brand{display:block;margin-bottom:.1rem}
.rid .spec{text-align:right}
.rdesc{font-size:.82rem;color:#39414a}
.rmeta{display:flex;flex-direction:column;align-items:flex-end;gap:.25rem}
.rmeta .origin{white-space:nowrap}
@media (max-width:780px){
  .row{grid-template-columns:56px 1fr;grid-template-areas:"t i" "d d" "m m";row-gap:.45rem}
  .thumb{grid-area:t;width:56px} .rid{grid-area:i} .rdesc{grid-area:d}
  .rmeta{grid-area:m;flex-direction:row;align-items:center;gap:.6rem}
}
@keyframes fade{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}

.empty{text-align:center;padding:4rem 1rem;color:var(--dim)}
footer{border-top:1px solid var(--line);background:var(--surface);padding:1.6rem 0;
  font-size:.82rem;color:var(--dim)}

@media print{
  #gate{display:none!important}
  .controls,.switchrow{display:none}
  .masthead{background:#fff}
  .grid{grid-template-columns:repeat(3,1fr);gap:.5rem}
  .card,.row{break-inside:avoid;page-break-inside:avoid;animation:none}
  .cathead{page-break-after:avoid}
  a{color:#000!important;text-decoration:none}
}
</style>

<div id="gate">
  <form class="gatebox" id="gform">
    <div class="lock"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>
    <h1>قائمة المعروضات</h1>
    <p>هذه القائمة خاصة. يُرجى إدخال كلمة المرور للاطلاع على الأصناف.</p>
    <input id="pw" type="password" placeholder="كلمة المرور" autocomplete="current-password"
           autofocus aria-label="كلمة المرور">
    <button id="go" type="submit">دخول</button>
    <div id="err" role="alert"></div>
  </form>
</div>

<div id="app">
  <header class="masthead"><div class="wrap">
    <p class="eyebrow">قائمة معروضات — متاحة للبيع</p>
    <h1 class="title">عدد وأدوات ومعدات صناعية</h1>
    <p class="lede">مخزون متكامل من العدد اليدوية وأجهزة القياس ومعدات اللحام والتشغيل، من علامات أوروبية وأمريكية.
      تشمل القائمة وصفًا لكل صنف واستخدامه والكمية المتوفرة. للاستفسار عن الأسعار يُرجى التواصل مباشرة.</p>
    <div class="facts">
      <div class="fact"><div class="v n">__TOTAL__</div><div class="l">صنف معروض</div></div>
      <div class="fact"><div class="v n">__UNITS__</div><div class="l">وحدة متوفرة</div></div>
      <div class="fact"><div class="v n">__BRANDS__</div><div class="l">علامة تجارية</div></div>
      <div class="fact"><div class="v n">__PHOTOS__</div><div class="l">صنف بصورة</div></div>
    </div>

    <nav class="cattiles" id="cattiles" aria-label="تصفية حسب الفئة"></nav>

    <div class="switchrow">
      <div class="seg" id="seg" role="group" aria-label="طريقة العرض">
        <span class="pill" id="pill"></span>
        <button type="button" data-v="grid" aria-pressed="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
          عرض البطاقات</button>
        <button type="button" data-v="list" aria-pressed="false">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>
          عرض الجدول</button>
      </div>
      <p class="switchnote" id="note"><b>عرض البطاقات:</b> صور أكبر لتصفّح الأصناف بصريًا.</p>
    </div>
  </div></header>

  <div class="controls"><div class="wrap">
    <input id="q" type="search" placeholder="ابحث بالكود أو العلامة أو نوع الأداة…" autocomplete="off">
    <button class="tab" data-g="all" aria-pressed="true">كل الفئات</button>
    <span id="tabs"></span>
    <select id="brand" aria-label="تصفية حسب العلامة التجارية"></select>
    <button class="clear" id="clear" hidden>مسح التصفية ✕</button>
    <span class="count" id="count"></span>
  </div></div>

  <main><div class="wrap" id="out"></div></main>

  <footer><div class="wrap">
    الكميات المذكورة تعكس المخزون المتوفر وقت إصدار القائمة وقابلة للتغيير. الصور استرشادية لتوضيح نوع المنتج
    وقد تختلف في التفاصيل عن الوحدة المعروضة. الأسعار غير مدرجة — تُقدَّم عند الطلب.
  </div></footer>
</div>

<script>
const B64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
let ITEMS = [], CATS = [], BRANDS = [], view = 'grid', g = 'all', term = '', brand = '';

const NOTES = {
  grid: '<b>عرض البطاقات:</b> صور أكبر لتصفّح الأصناف بصريًا.',
  list: '<b>عرض الجدول:</b> صفوف مضغوطة لمراجعة عدد كبير من الأصناف بسرعة.'
};

/* ── unlock ───────────────────────────────── */
async function unlock(pass){
  const meta = await (await fetch('data.json', {cache:'no-store'})).json();
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass),
                 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    {name:'PBKDF2', salt:B64(meta.kdf.salt), iterations:meta.kdf.iterations, hash:meta.kdf.hash},
    base, {name:'AES-GCM', length:256}, false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({name:'AES-GCM', iv:B64(meta.iv)}, key, B64(meta.ct));
  return JSON.parse(new TextDecoder().decode(plain));
}

document.getElementById('gform').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = document.getElementById('go'), err = document.getElementById('err'),
        box = document.querySelector('.gatebox');
  err.textContent=''; btn.disabled=true; btn.textContent='جارٍ فتح القائمة…';
  try{
    const data = await unlock(document.getElementById('pw').value);
    ITEMS = data.items; CATS = data.cats; BRANDS = data.brands || [];
    try{ sessionStorage.setItem('k', document.getElementById('pw').value); }catch(_){}
    boot();
  }catch(_){
    err.textContent = 'كلمة المرور غير صحيحة. حاول مرة أخرى.';
    box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake');
    btn.disabled=false; btn.textContent='دخول';
    document.getElementById('pw').select();
  }
});

function boot(){
  document.getElementById('gate').style.display='none';
  document.getElementById('app').style.display='block';
  document.getElementById('tabs').innerHTML =
    CATS.map(c=>`<button class="tab" data-g="${c.id}" aria-pressed="false">${c.label}</button>`).join(' ');
  document.getElementById('cattiles').innerHTML =
    [{id:'all', label:'كل الفئات', n:ITEMS.length}].concat(CATS).map(c=>
      `<button data-g="${c.id}" aria-pressed="${c.id==='all'}">
         <span class="cl">${c.label}</span>
         <span class="cn">${c.n.toLocaleString('en-US')} صنف</span></button>`).join('');
  document.getElementById('brand').innerHTML =
    `<option value="">كل العلامات (${BRANDS.length})</option>` +
    BRANDS.map(b=>`<option value="${b.b}">${b.b} — ${b.n}</option>`).join('');
  movePill(); render();
}

/* keep every category control in sync, wherever it was clicked */
function setCategory(id){
  g = id;
  document.querySelectorAll('.tab').forEach(x=>x.setAttribute('aria-pressed', String(x.dataset.g===id)));
  document.querySelectorAll('#cattiles button').forEach(x=>x.setAttribute('aria-pressed', String(x.dataset.g===id)));
  render();
}
function syncChrome(){
  const sel=document.getElementById('brand'), cl=document.getElementById('clear');
  sel.classList.toggle('on', !!brand);
  cl.hidden = !(brand || g!=='all' || term.trim());
}

/* ── view switch ──────────────────────────── */
function movePill(){
  const seg=document.getElementById('seg'), pill=document.getElementById('pill');
  const on=seg.querySelector('button[aria-pressed="true"]'); if(!on) return;
  pill.style.width = on.offsetWidth+'px';
  pill.style.transform = `translateX(${on.offsetLeft - 4}px)`;
}
document.getElementById('seg').addEventListener('click', e=>{
  const b=e.target.closest('button[data-v]'); if(!b||b.getAttribute('aria-pressed')==='true') return;
  document.querySelectorAll('#seg button').forEach(x=>x.setAttribute('aria-pressed', String(x===b)));
  view=b.dataset.v; movePill();
  const note=document.getElementById('note');
  note.style.opacity=0;
  setTimeout(()=>{ note.innerHTML=NOTES[view]; note.style.opacity=1; },140);
  render();
});
addEventListener('resize', movePill);

/* ── render ───────────────────────────────── */
const esc = s => String(s).replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
const gs = it => 'https://www.google.com/search?tbm=isch&q='+
  encodeURIComponent(`${it.b} ${it.c} ${it.t}`.slice(0,110));
const qtyTag = it => `<span class="qty">${it.q}${it.u?' '+esc(it.u):''}</span>`;

function card(it){
  const shot = it.p
    ? `<div class="shot"><img loading="lazy" src="${it.p}" alt="${esc(it.d||it.t)}"></div>`
    : `<a class="shot" href="${gs(it)}" target="_blank" rel="noopener">
         <span class="noshot">لا تتوفر صورة<br>اضغط للبحث عن صور</span></a>`;
  return `<article class="card">${shot}<div class="body">
    <div class="tophead"><span class="brand">${esc(it.b||'—')}</span>${qtyTag(it)}</div>
    <a class="code" href="${gs(it)}" target="_blank" rel="noopener">${esc(it.c)}</a>
    ${it.t?`<div class="spec">${esc(it.t)}</div>`:''}
    ${it.d?`<p class="desc">${esc(it.d)}</p>`:''}
    ${it.o?`<div class="origin">بلد المنشأ: ${esc(it.o)}</div>`:''}
  </div></article>`;
}

function row(it){
  const th = it.p
    ? `<div class="thumb"><img loading="lazy" src="${it.p}" alt=""></div>`
    : `<a class="thumb" href="${gs(it)}" target="_blank" rel="noopener"><span>بحث<br>عن صورة</span></a>`;
  return `<div class="row">${th}
    <div class="rid"><span class="brand">${esc(it.b||'—')}</span>
      <a class="code" href="${gs(it)}" target="_blank" rel="noopener">${esc(it.c)}</a>
      ${it.t?`<div class="spec">${esc(it.t)}</div>`:''}</div>
    <div class="rdesc">${esc(it.d||'')}</div>
    <div class="rmeta">${qtyTag(it)}${it.o?`<span class="origin">${esc(it.o)}</span>`:''}</div>
  </div>`;
}

function render(){
  const t=term.trim().toLowerCase(), out=document.getElementById('out');
  const sel = ITEMS.filter(it =>
    (g==='all'||it.g===g) &&
    (!brand || it.b===brand) &&
    (!t || it.c.toLowerCase().includes(t) || it.b.toLowerCase().includes(t)
        || it.t.toLowerCase().includes(t) || (it.d||'').includes(term.trim())));

  syncChrome();
  document.getElementById('count').textContent = sel.length ? `${sel.length.toLocaleString('en-US')} صنف` : '';
  if(!sel.length){
    out.innerHTML='<p class="empty">لا توجد أصناف مطابقة للتصفية الحالية.<br>جرّب توسيع البحث أو مسح التصفية.</p>';
    return; }

  let html='';
  for(const c of CATS){
    const part = sel.filter(i=>i.g===c.id);
    if(!part.length) continue;
    html += `<section><div class="cathead"><h2>${c.label}</h2>
      <span class="c">${part.length.toLocaleString('en-US')} صنف</span></div>` +
      (view==='grid'
        ? `<div class="grid">${part.map(card).join('')}</div>`
        : `<div class="list">${part.map(row).join('')}</div>`) + `</section>`;
  }
  out.innerHTML = html;
}

/* category: sticky chips scroll to results, hero tiles jump you straight there */
document.addEventListener('click', e=>{
  const chip=e.target.closest('.tab');
  if(chip){ setCategory(chip.dataset.g); scrollTo({top:0,behavior:'smooth'}); return; }
  const tile=e.target.closest('#cattiles button');
  if(tile){
    setCategory(tile.dataset.g);
    document.querySelector('.controls').scrollIntoView({behavior:'smooth', block:'start'});
  }
});
document.getElementById('brand').addEventListener('change', e=>{ brand=e.target.value; render(); });
document.getElementById('clear').addEventListener('click', ()=>{
  brand=''; term=''; document.getElementById('brand').value='';
  document.getElementById('q').value=''; setCategory('all');
});
let deb; document.getElementById('q').addEventListener('input', e=>{
  clearTimeout(deb); deb=setTimeout(()=>{ term=e.target.value; render(); },160); });

/* resume within the same tab without retyping */
(async ()=>{ try{ const k=sessionStorage.getItem('k'); if(!k) return;
  const d=await unlock(k); ITEMS=d.items; CATS=d.cats; BRANDS=d.brands||[]; boot(); }catch(_){}} )();
</script>
"""

if __name__ == "__main__":
    main()
