"""Build the Arabic, buyer-facing catalog. NO PRICING of any kind is emitted —
the payload carries only code, brand, quantity, origin, description and photo."""
import json, re, html as H
from urllib.parse import quote

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
    """The PDF stored Arabic with reversed character order, which cannot be
    reliably repaired. Keep the Latin technical spec (sizes / model / type),
    which is unambiguous, and let the researched Arabic description carry the
    meaning."""
    s = AR_RUN.sub(' ', descr)
    s = re.sub(r'\s+', ' ', s)
    s = re.sub(r'^[\s,.\-/:;]+|[\s,.\-/:;]+$', '', s)
    s = re.sub(r'\s*,\s*', ', ', s)
    # Stripping the Arabic can leave an orphaned digit behind ("...20INCH 3").
    # Drop it, but never when it follows a lone size-prefix letter ("EYE BOLT M 12").
    s = re.sub(r'(?<!\b[A-Za-z])\s+\d{1,2}$', '', s)
    # ...or a longer trailing number that merely repeats one already shown
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
            continue                      # don't advertise what isn't in stock
        brand = (r['brand_clean'] or '').strip()
        code  = (r['code'] or '').strip()
        descr = re.sub(r'\s+', ' ', r['descr'] or '').strip()
        desc_ar = (r.get('description_ar_rich') or r.get('description_ar') or '').strip()
        coo = r.get('coo_clean') or ''
        coo_ar = COO_AR.get(coo, '')
        items.append({
            "c": code,
            "b": brand,
            "q": int(qty),
            "u": (r.get('uom') or '').strip(),
            "o": coo_ar,
            "t": clean_spec(descr),        # Latin technical spec (sizes / model)
            "d": desc_ar,                  # Arabic description + use
            "g": bucket_of(brand),
            "p": imgs.get(r.get('image_url'), ""),
        })

    # stable, browsable order: category, then brand, then biggest stock first
    items.sort(key=lambda x: (CAT_ORDER.index(x['g']), x['b'], -x['q']))

    cats = []
    for g in CAT_ORDER:
        n = sum(1 for i in items if i['g'] == g)
        if n:
            cats.append({"id": g, "label": CAT[g], "n": n})

    brands = sorted({i['b'] for i in items if i['b']})
    with_photo = sum(1 for i in items if i['p'])

    payload = json.dumps(items, ensure_ascii=False, separators=(',', ':'))
    cats_json = json.dumps(cats, ensure_ascii=False)

    html = TEMPLATE.replace("__ITEMS__", payload)\
                   .replace("__CATS__", cats_json)\
                   .replace("__TOTAL__", f"{len(items):,}")\
                   .replace("__BRANDS__", f"{len(brands):,}")\
                   .replace("__UNITS__", f"{sum(i['q'] for i in items):,}")\
                   .replace("__PHOTOS__", f"{with_photo:,}")
    open("bela_buyer_catalog.html", "w", encoding="utf-8").write(html)

    assert 'probable_price' not in html and '"uc"' not in html
    print(f"items: {len(items)}  brands: {len(brands)}  photos: {with_photo}")
    import os; print(f"file: {os.path.getsize('bela_buyer_catalog.html')/1024/1024:.1f} MB")


TEMPLATE = r"""<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>قائمة المعروضات — عدد وأدوات ومعدات</title>
<style>
:root{
  --bg:#ffffff; --surface:#f6f7f9; --ink:#15181c; --ink-dim:#5f6873;
  --line:#e3e7ec; --accent:#1f5673; --accent-soft:#e8eff3; --amber:#b5651d;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:var(--bg)}
body{
  font-family:"Segoe UI","Tahoma","Geeza Pro","Noto Naskh Arabic","Noto Sans Arabic",Arial,sans-serif;
  color:var(--ink);line-height:1.7;direction:rtl;-webkit-font-smoothing:antialiased;
}
.n{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-variant-numeric:tabular-nums;direction:ltr;unicode-bidi:isolate}
.wrap{max-width:1280px;margin:0 auto;padding:0 1.25rem}

/* ── masthead ─────────────────────────────── */
.masthead{border-bottom:1px solid var(--line);background:var(--surface)}
.masthead .wrap{padding-top:2.4rem;padding-bottom:1.8rem}
.eyebrow{font-size:.75rem;letter-spacing:.16em;color:var(--accent);font-weight:700;margin:0 0 .5rem}
h1{font-size:clamp(1.5rem,3.4vw,2.2rem);margin:0 0 .5rem;font-weight:800;letter-spacing:-.01em}
.lede{color:var(--ink-dim);max-width:60ch;margin:0;font-size:.98rem}
.facts{display:flex;flex-wrap:wrap;gap:2.2rem;margin-top:1.6rem}
.fact .v{font-size:1.5rem;font-weight:800;line-height:1.2;font-family:ui-monospace,monospace}
.fact .l{font-size:.74rem;color:var(--ink-dim)}

/* ── controls ─────────────────────────────── */
.controls{position:sticky;top:0;z-index:20;background:rgba(255,255,255,.94);
  backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
.controls .wrap{display:flex;flex-wrap:wrap;gap:.6rem;align-items:center;padding-top:.7rem;padding-bottom:.7rem}
#q{flex:1;min-width:200px;padding:.55rem .8rem;border:1px solid var(--line);border-radius:6px;
  font-family:inherit;font-size:.9rem;background:#fff;color:var(--ink)}
#q:focus{outline:2px solid var(--accent-soft);border-color:var(--accent)}
.tab{padding:.4rem .85rem;border:1px solid var(--line);border-radius:99px;background:#fff;
  color:var(--ink-dim);font-size:.83rem;cursor:pointer;white-space:nowrap;font-family:inherit}
.tab:hover{border-color:var(--accent)}
.tab[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:700}
.count{font-size:.82rem;color:var(--ink-dim);margin-inline-start:auto;white-space:nowrap}

/* ── grid ─────────────────────────────────── */
main{padding:1.6rem 0 4rem}
.cathead{display:flex;align-items:baseline;gap:.7rem;margin:2.2rem 0 1rem;
  border-bottom:2px solid var(--ink);padding-bottom:.45rem}
.cathead h2{font-size:1.15rem;margin:0}
.cathead .c{font-size:.8rem;color:var(--ink-dim);font-family:ui-monospace,monospace}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(215px,1fr));gap:1rem}
.card{border:1px solid var(--line);border-radius:9px;overflow:hidden;background:#fff;
  display:flex;flex-direction:column;break-inside:avoid}
.shot{aspect-ratio:4/3;background:var(--surface);display:flex;align-items:center;justify-content:center;
  border-bottom:1px solid var(--line);overflow:hidden}
.shot img{max-width:100%;max-height:100%;object-fit:contain;mix-blend-mode:multiply}
.noshot{color:#b4bcc5;font-size:.72rem;text-align:center;padding:.5rem;line-height:1.5}
.body{padding:.75rem .85rem .85rem;display:flex;flex-direction:column;gap:.4rem;flex:1}
.tophead{display:flex;justify-content:space-between;align-items:flex-start;gap:.5rem}
.brand{font-size:.68rem;letter-spacing:.09em;color:var(--accent);font-weight:800}
.qty{font-size:.7rem;font-weight:800;color:var(--amber);background:#fbf1e8;
  padding:.1rem .45rem;border-radius:4px;white-space:nowrap;font-family:ui-monospace,monospace}
.code{font-family:ui-monospace,monospace;font-size:.88rem;font-weight:700;color:var(--ink);
  text-decoration:none;direction:ltr;display:block;word-break:break-word}
.code:hover{color:var(--accent);text-decoration:underline}
.spec{font-size:.72rem;color:var(--ink-dim);direction:ltr;text-align:right;word-break:break-word;
  font-family:ui-monospace,monospace;line-height:1.5}
.desc{font-size:.83rem;color:#39414a;margin-top:auto;padding-top:.2rem}
.origin{font-size:.7rem;color:var(--ink-dim)}
.empty{text-align:center;padding:4rem 1rem;color:var(--ink-dim)}
footer{border-top:1px solid var(--line);background:var(--surface);padding:1.6rem 0;
  font-size:.82rem;color:var(--ink-dim)}

@media print{
  .controls{display:none}
  .masthead{background:#fff}
  .grid{grid-template-columns:repeat(3,1fr);gap:.5rem}
  .card{break-inside:avoid;page-break-inside:avoid}
  .cathead{page-break-after:avoid}
  a{color:#000!important;text-decoration:none}
}
</style>

<header class="masthead"><div class="wrap">
  <p class="eyebrow">قائمة معروضات — متاحة للبيع</p>
  <h1>عدد وأدوات ومعدات صناعية</h1>
  <p class="lede">مخزون متكامل من العدد اليدوية وأجهزة القياس ومعدات اللحام والتشغيل، من علامات أوروبية وأمريكية.
     تشمل القائمة وصفًا لكل صنف واستخدامه والكمية المتوفرة. للاستفسار عن الأسعار يُرجى التواصل مباشرة.</p>
  <div class="facts">
    <div class="fact"><div class="v n">__TOTAL__</div><div class="l">صنف معروض</div></div>
    <div class="fact"><div class="v n">__UNITS__</div><div class="l">وحدة متوفرة</div></div>
    <div class="fact"><div class="v n">__BRANDS__</div><div class="l">علامة تجارية</div></div>
    <div class="fact"><div class="v n">__PHOTOS__</div><div class="l">صنف بصورة</div></div>
  </div>
</div></header>

<div class="controls"><div class="wrap">
  <input id="q" type="search" placeholder="ابحث بالكود أو العلامة أو نوع الأداة…" autocomplete="off">
  <button class="tab" data-g="all" aria-pressed="true">الكل</button>
  <span id="tabs"></span>
  <span class="count" id="count"></span>
</div></div>

<main><div class="wrap" id="out"></div></main>

<footer><div class="wrap">
  الكميات المذكورة تعكس المخزون المتوفر وقت إصدار القائمة وقابلة للتغيير. الصور استرشادية لتوضيح نوع المنتج
  وقد تختلف في التفاصيل عن الوحدة المعروضة. الأسعار غير مدرجة — تُقدَّم عند الطلب.
</div></footer>

<script>
const ITEMS = __ITEMS__, CATS = __CATS__;
const out=document.getElementById('out'), qEl=document.getElementById('q'),
      countEl=document.getElementById('count'), tabsEl=document.getElementById('tabs');
let g='all', term='';

tabsEl.innerHTML = CATS.map(c=>`<button class="tab" data-g="${c.id}" aria-pressed="false">${c.label}</button>`).join(' ');

const esc = s => String(s).replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
const gsearch = it => 'https://www.google.com/search?tbm=isch&q=' +
      encodeURIComponent(`${it.b} ${it.c} ${it.t}`.slice(0,110));

function card(it){
  const shot = it.p
    ? `<div class="shot"><img loading="lazy" src="${it.p}" alt="${esc(it.d||it.t)}"></div>`
    : `<a class="shot" href="${gsearch(it)}" target="_blank" rel="noopener">
         <span class="noshot">لا تتوفر صورة<br>اضغط للبحث عن صور</span></a>`;
  return `<article class="card">${shot}<div class="body">
    <div class="tophead"><span class="brand">${esc(it.b||'—')}</span>
      <span class="qty">${it.q} ${esc(it.u||'')}</span></div>
    <a class="code" href="${gsearch(it)}" target="_blank" rel="noopener">${esc(it.c)}</a>
    ${it.t?`<div class="spec">${esc(it.t)}</div>`:''}
    ${it.d?`<p class="desc">${esc(it.d)}</p>`:''}
    ${it.o?`<div class="origin">بلد المنشأ: ${esc(it.o)}</div>`:''}
  </div></article>`;
}

function render(){
  const t = term.trim().toLowerCase();
  const sel = ITEMS.filter(it =>
    (g==='all' || it.g===g) &&
    (!t || it.c.toLowerCase().includes(t) || it.b.toLowerCase().includes(t)
        || it.t.toLowerCase().includes(t) || (it.d||'').includes(term.trim())));

  countEl.textContent = sel.length ? `${sel.length.toLocaleString('en-US')} صنف` : '';
  if(!sel.length){ out.innerHTML = '<p class="empty">لا توجد أصناف مطابقة لبحثك.</p>'; return; }

  let html='';
  for(const c of CATS){
    const part = sel.filter(i=>i.g===c.id);
    if(!part.length) continue;
    html += `<section><div class="cathead"><h2>${c.label}</h2>
             <span class="c">${part.length.toLocaleString('en-US')} صنف</span></div>
             <div class="grid">${part.map(card).join('')}</div></section>`;
  }
  out.innerHTML = html;
}

document.addEventListener('click', e=>{
  const b = e.target.closest('.tab'); if(!b) return;
  g = b.dataset.g;
  document.querySelectorAll('.tab').forEach(x=>x.setAttribute('aria-pressed', String(x===b)));
  render(); window.scrollTo({top:0,behavior:'smooth'});
});
let deb; qEl.addEventListener('input', e=>{ clearTimeout(deb);
  deb=setTimeout(()=>{ term=e.target.value; render(); },160); });

render();
</script>
"""

if __name__ == "__main__":
    main()
