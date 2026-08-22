"""Build the Arabic product catalogue.

Payload carries name / brand / code / category / origin / photo only —
no quantity, no cost, no price fields exist in the output at all.
"""
import json, re, html as H
from urllib.parse import quote
from derive_names import name_from

CAT = {'machinery':'الآلات والمعدات','premium':'أجهزة القياس والفحص',
       'other':'العدد والأدوات اليدوية','draper':'أدوات دريبر'}
CAT_SUB = {'machinery':'لحام، قطع، جلخ، خراطة وتشغيل المعادن',
           'premium':'قياس كهربائي وحراري وأدوات دقة',
           'other':'مفاتيح، زرديات، مفكات، ريش حفر وعدد ورش',
           'draper':'عدة يدوية بريطانية متعددة الاستخدامات'}
CAT_ORDER = ['machinery','premium','other','draper']
COO = {'GERMANY':'ألمانيا','USA':'الولايات المتحدة','UK':'المملكة المتحدة','SPAIN':'إسبانيا',
       'ITALY':'إيطاليا','AUSTRIA':'النمسا','JAPAN':'اليابان','SWEDEN':'السويد',
       'DENMARK':'الدنمارك','TW':'تايوان'}
AR_RUN = re.compile(r'[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]+')

def clean_spec(d):
    s = AR_RUN.sub(' ', d); s = re.sub(r'\s+',' ',s)
    s = re.sub(r'^[\s,.\-/:;]+|[\s,.\-/:;]+$','',s)
    s = re.sub(r'\s*,\s*', ', ', s)
    s = re.sub(r'(?<!\b[A-Za-z])\s+\d{1,2}$','',s)
    m = re.search(r'(?<!\b[A-Za-z])\s+(\d{3,})$', s)
    if m and m.group(1) in s[:m.start()]: s = s[:m.start()]
    return s if len(re.sub(r'[^A-Za-z0-9]','',s))>=2 else ''

def bucket(b):
    MACH={'EPS','SOLTER','SCANTOOL','GRIGGRIO','CITY','BUCO'}
    PREM={'FLUKE','KNIPEX','EXTECH','AMPROBE','KLAUKE','WAVETEK','B/K','ALNOR','MITUTOY','COLEPARME','BW'}
    b=b.strip().upper()
    if b in MACH: return 'machinery'
    if b in PREM: return 'premium'
    if b=='DRAPER': return 'draper'
    return 'other'

def main():
    rows = json.load(open('inventory_full.json', encoding='utf-8'))
    imgs = json.load(open('image_data.json', encoding='utf-8'))
    items=[]
    for r in rows:
        if float(r['qty']) <= 0:            # not offered, so not shown
            continue
        brand=(r['brand_clean'] or '').strip()
        desc=(r.get('description_ar_rich') or r.get('description_ar') or '').strip()
        code=(r['code'] or '').strip()
        items.append({
            'n': name_from(desc, code),                 # Arabic product name
            'b': brand,
            'c': code,
            's': clean_spec(re.sub(r'\s+',' ', r['descr'] or '').strip()),
            'd': desc,
            'o': COO.get(r.get('coo_clean') or '', ''),
            'g': bucket(brand),
            'p': imgs.get(r.get('image_url'), ''),
        })
    items.sort(key=lambda x:(CAT_ORDER.index(x['g']), x['b'], x['n']))

    cats=[{'id':g,'label':CAT[g],'sub':CAT_SUB[g],
           'n':sum(1 for i in items if i['g']==g)}
          for g in CAT_ORDER if any(i['g']==g for i in items)]
    bc={}
    for i in items:
        if i['b']: bc[i['b']]=bc.get(i['b'],0)+1
    brands=[{'b':b,'n':n} for b,n in sorted(bc.items(), key=lambda x:(-x[1],x[0]))]

    payload=json.dumps({'items':items,'cats':cats,'brands':brands},
                       ensure_ascii=False, separators=(',',':'))
    import hashlib
    ver = hashlib.sha1((str(len(items))+payload[:2000]+payload[-2000:]).encode('utf-8')).hexdigest()[:12]
    html = TPL.replace('__VER__', ver).replace('__DATA__', payload)\
              .replace('__TOTAL__', f"{len(items):,}")\
              .replace('__BRANDS__', f"{len(brands):,}")\
              .replace('__CATS__', str(len(cats)))\
              .replace('__PHOTOS__', f"{sum(1 for i in items if i['p']):,}")
    open('BELA-Catalogue.html','w',encoding='utf-8').write(html)

    # precise: JSON data keys, not incidental UI ids like id="q"
    for bad in ('"q":', '"u":', '"pp"', 'probable_price', 'الكمية',
                'تكلفة', 'السعر', 'ر.س', 'confidence'):
        assert bad not in html, f"leaked: {bad}"
    import os
    print(f"items {len(items)}  cats {len(cats)}  brands {len(brands)}  "
          f"photos {sum(1 for i in items if i['p'])}  "
          f"{os.path.getsize('BELA-Catalogue.html')/1048576:.1f} MB")

TPL = r"""<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>كتالوج المنتجات — عدد وأدوات ومعدات صناعية</title>
<style>
:root{
  --bg:#ffffff; --surface:#f7f8fa; --sink:#eef1f5;
  --ink:#14171a; --dim:#5c6672; --faint:#8b95a1;
  --line:#e4e8ed; --accent:#1f5673; --accent-2:#2b7ea1; --soft:#e9f0f4;
  --tan:#b5651d; --tanbg:#fdf4ec;
  --sh-1:0 1px 2px rgba(16,24,32,.06);
  --sh-2:0 4px 16px -6px rgba(16,24,32,.18);
  --sh-3:0 24px 60px -20px rgba(16,24,32,.35);
  --r:14px;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--ink);direction:rtl;
  font-family:"Segoe UI",Tahoma,"Geeza Pro","Noto Naskh Arabic","Noto Sans Arabic",Arial,sans-serif;
  line-height:1.75;-webkit-font-smoothing:antialiased}
.lat{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;direction:ltr;unicode-bidi:isolate}
.wrap{max-width:1340px;margin:0 auto;padding:0 clamp(1rem,3vw,2rem)}
:focus-visible{outline:2px solid var(--accent);outline-offset:3px;border-radius:6px}
button{font:inherit;color:inherit}

/* ── hero ───────────────────────────────────────── */
.hero{background:linear-gradient(180deg,var(--surface) 0%,#fff 100%);
  border-bottom:1px solid var(--line)}
.hero .wrap{padding-top:clamp(2.5rem,6vw,4.5rem);padding-bottom:2.4rem}
.brandmark{display:inline-flex;align-items:center;gap:.6rem;margin-bottom:1.4rem}
.brandmark i{width:34px;height:34px;border-radius:9px;background:var(--accent);
  display:grid;place-items:center;color:#fff}
.brandmark span{font-weight:800;letter-spacing:.02em;font-size:1.05rem}
h1{font-size:clamp(1.9rem,4.6vw,3.1rem);line-height:1.2;margin:0 0 .9rem;
  font-weight:800;letter-spacing:-.02em;max-width:19ch}
.lede{font-size:clamp(1rem,1.6vw,1.12rem);color:var(--dim);max-width:60ch;margin:0}
.stats{display:flex;flex-wrap:wrap;gap:clamp(1.4rem,4vw,3rem);margin-top:2.2rem;
  padding-top:1.6rem;border-top:1px solid var(--line)}
.stat b{display:block;font-size:clamp(1.4rem,2.6vw,1.9rem);font-weight:800;line-height:1.15;
  font-family:ui-monospace,monospace}
.stat span{font-size:.8rem;color:var(--dim)}

/* ── category cards ─────────────────────────────── */
.catwrap{padding:clamp(2rem,4vw,3rem) 0 .5rem}
.eyebrow{font-size:.74rem;font-weight:800;letter-spacing:.15em;color:var(--accent);margin:0 0 1rem}
.cats{display:grid;gap:.9rem;grid-template-columns:repeat(auto-fit,minmax(230px,1fr))}
.cat{position:relative;text-align:right;background:#fff;border:1px solid var(--line);
  border-radius:var(--r);padding:1.2rem 1.25rem 1.15rem;cursor:pointer;overflow:hidden;
  transition:transform .2s cubic-bezier(.3,1.2,.5,1),box-shadow .2s,border-color .2s}
.cat::before{content:"";position:absolute;inset-inline-start:0;top:0;bottom:0;width:4px;
  background:var(--accent);transform:scaleY(0);transform-origin:top;transition:transform .26s}
.cat:hover{transform:translateY(-3px);box-shadow:var(--sh-2);border-color:var(--accent-2)}
.cat[aria-pressed=true]{border-color:var(--accent);background:var(--soft)}
.cat[aria-pressed=true]::before{transform:scaleY(1)}
.cat h3{margin:0 0 .3rem;font-size:1.02rem;font-weight:800}
.cat p{margin:0 0 .7rem;font-size:.82rem;color:var(--dim);line-height:1.55;min-height:2.6em}
.cat b{font-size:.78rem;color:var(--accent);font-family:ui-monospace,monospace}

/* ── toolbar ────────────────────────────────────── */
.bar{position:sticky;top:0;z-index:30;background:rgba(255,255,255,.92);
  backdrop-filter:blur(12px);border-bottom:1px solid var(--line);margin-top:1.6rem}
.bar .wrap{display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;padding:.75rem clamp(1rem,3vw,2rem)}
.search{position:relative;flex:1;min-width:220px}
.search svg{position:absolute;inset-inline-start:.7rem;top:50%;transform:translateY(-50%);
  width:16px;height:16px;color:var(--faint);pointer-events:none}
#q{width:100%;padding:.6rem .8rem;padding-inline-start:2.4rem;border:1px solid var(--line);border-radius:10px;
  font:inherit;font-size:.92rem;background:#fff;color:var(--ink)}
#q:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--soft)}
.chip{padding:.45rem .95rem;border:1px solid var(--line);border-radius:99px;background:#fff;
  color:var(--dim);font-size:.85rem;cursor:pointer;white-space:nowrap;transition:.16s}
.chip:hover{border-color:var(--accent-2);color:var(--ink)}
.chip[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:700}
#brand{padding:.45rem .8rem;border:1px solid var(--line);border-radius:99px;background:#fff;
  font:inherit;font-size:.85rem;cursor:pointer;max-width:200px;color:var(--ink)}
#brand.on{background:var(--accent);color:#fff;border-color:var(--accent);font-weight:700}
#clear{padding:.45rem .85rem;border:0;border-radius:99px;background:#fdeceb;color:#a13c31;
  font-size:.82rem;font-weight:700;cursor:pointer;white-space:nowrap}
.tally{margin-inline-start:auto;font-size:.84rem;color:var(--dim);white-space:nowrap}

/* ── grid ───────────────────────────────────────── */
main{padding:1.8rem 0 5rem;min-height:60vh}
.sec{margin-bottom:2.6rem}
.sechd{display:flex;align-items:baseline;gap:.8rem;margin:0 0 1.1rem;
  padding-bottom:.55rem;border-bottom:2px solid var(--ink)}
.sechd h2{margin:0;font-size:1.18rem;font-weight:800}
.sechd em{font-style:normal;font-size:.82rem;color:var(--dim);font-family:ui-monospace,monospace}
.grid{display:grid;gap:1.05rem;grid-template-columns:repeat(auto-fill,minmax(238px,1fr))}
.card{background:#fff;border:1px solid var(--line);border-radius:var(--r);overflow:hidden;
  display:flex;flex-direction:column;cursor:pointer;text-align:right;padding:0;
  transition:transform .2s cubic-bezier(.3,1.2,.5,1),box-shadow .2s,border-color .2s}
.card:hover{transform:translateY(-4px);box-shadow:var(--sh-2);border-color:var(--accent-2)}
.ph{aspect-ratio:1/1;background:var(--sink);display:grid;place-items:center;overflow:hidden;
  border-bottom:1px solid var(--line);position:relative}
.ph img{width:100%;height:100%;object-fit:contain;padding:12px;mix-blend-mode:multiply;
  transition:transform .35s ease}
.card:hover .ph img{transform:scale(1.05)}
.ph .none{font-size:.74rem;color:var(--faint);text-align:center;padding:1rem;line-height:1.6}
.tag{position:absolute;top:.6rem;inset-inline-end:.6rem;background:rgba(255,255,255,.94);
  border:1px solid var(--line);border-radius:99px;padding:.16rem .55rem;font-size:.66rem;
  font-weight:700;color:var(--accent)}
.info{padding:.85rem .95rem 1rem;display:flex;flex-direction:column;gap:.4rem;flex:1}
.nm{font-size:.93rem;font-weight:700;line-height:1.5;margin:0;
  display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.meta{display:flex;align-items:center;justify-content:space-between;gap:.5rem;
  margin-top:auto;padding-top:.5rem;border-top:1px dashed var(--line)}
.bd{font-size:.7rem;font-weight:800;letter-spacing:.07em;color:var(--accent)}
.cd{font-size:.7rem;color:var(--faint)}
.org{font-size:.72rem;color:var(--dim)}

/* ── detail dialog ──────────────────────────────── */
.ov{position:fixed;inset:0;z-index:60;background:rgba(14,20,26,.62);backdrop-filter:blur(4px);
  display:none;align-items:center;justify-content:center;padding:clamp(.8rem,3vw,2rem)}
.ov.on{display:flex;animation:fade .18s}
@keyframes fade{from{opacity:0}to{opacity:1}}
.sheet{background:#fff;border-radius:18px;max-width:940px;width:100%;max-height:92vh;overflow:auto;
  box-shadow:var(--sh-3);animation:rise .26s cubic-bezier(.3,1.1,.5,1)}
@keyframes rise{from{opacity:0;transform:translateY(16px) scale(.985)}to{opacity:1;transform:none}}
.sheet .top{display:grid;grid-template-columns:minmax(0,300px) 1fr;gap:1.6rem;padding:1.5rem}
@media(max-width:720px){.sheet .top{grid-template-columns:1fr}}
.sheet .pic{background:var(--sink);border-radius:12px;aspect-ratio:1/1;display:grid;place-items:center;
  overflow:hidden;border:1px solid var(--line)}
.sheet .pic img{width:100%;height:100%;object-fit:contain;padding:16px;mix-blend-mode:multiply}
.sheet h3{margin:.2rem 0 .7rem;font-size:1.3rem;line-height:1.45;font-weight:800}
.kv{display:grid;grid-template-columns:auto 1fr;gap:.4rem 1rem;font-size:.88rem;margin:.9rem 0}
.kv dt{color:var(--faint);font-size:.78rem}
.kv dd{margin:0;font-weight:600}
.sheet .body{font-size:.92rem;color:#333b44;line-height:1.85;
  border-top:1px solid var(--line);padding-top:.9rem;margin-top:.4rem}
.acts{display:flex;gap:.6rem;flex-wrap:wrap;margin-top:1.1rem}
.btn{padding:.55rem 1.05rem;border-radius:10px;border:1px solid var(--line);background:#fff;
  font-size:.86rem;cursor:pointer;text-decoration:none;color:var(--ink);font-weight:600}
.btn.pri{background:var(--accent);border-color:var(--accent);color:#fff}
.x{position:sticky;top:0;float:left;margin:.7rem .7rem 0;background:#fff;border:1px solid var(--line);
  width:34px;height:34px;border-radius:50%;cursor:pointer;font-size:1.15rem;line-height:1;z-index:2}

.none-found{text-align:center;padding:5rem 1rem;color:var(--dim)}
footer{border-top:1px solid var(--line);background:var(--surface);padding:2rem 0;
  font-size:.84rem;color:var(--dim)}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}

/* ── shortlist ──────────────────────────────────── */
.pick{position:absolute;top:.6rem;inset-inline-start:.6rem;width:31px;height:31px;border-radius:50%;
  border:1px solid var(--line);background:rgba(255,255,255,.95);cursor:pointer;display:grid;
  place-items:center;z-index:3;transition:.16s;color:var(--accent);padding:0}
.pick svg{width:15px;height:15px}
.pick:hover{background:var(--accent);color:#fff;border-color:var(--accent);transform:scale(1.09)}
.card.on{border-color:var(--accent);box-shadow:0 0 0 2px var(--soft)}
.card.on .pick{background:var(--accent);color:#fff;border-color:var(--accent)}
.catadd{margin-top:.7rem;padding:.36rem .75rem;border:1px solid var(--line);border-radius:9px;
  background:#fff;font-size:.75rem;cursor:pointer;color:var(--accent);font-weight:700}
.catadd:hover{background:var(--accent);color:#fff;border-color:var(--accent)}
.btn.add{border-color:var(--accent);color:var(--accent);font-weight:700}
.btn.add.on{background:var(--accent);color:#fff}

.fab{position:fixed;inset-block-end:1.3rem;inset-inline-start:1.3rem;z-index:50;background:var(--accent);
  color:#fff;border:0;border-radius:99px;padding:.85rem 1.35rem;font-size:.92rem;font-weight:700;
  cursor:pointer;box-shadow:var(--sh-3);display:none;align-items:center;gap:.6rem}
.fab.show{display:inline-flex;animation:pop .3s cubic-bezier(.3,1.3,.5,1)}
@keyframes pop{from{transform:scale(.8);opacity:0}to{transform:none;opacity:1}}
.fab b{background:#fff;color:var(--accent);border-radius:99px;padding:.06rem .55rem;font-size:.85rem;
  font-family:ui-monospace,monospace}

.dw{position:fixed;inset:0;z-index:70;background:rgba(14,20,26,.55);backdrop-filter:blur(3px);display:none}
.dw.on{display:block;animation:fade .18s}
.dwbox{position:absolute;inset-block:0;inset-inline-start:0;width:min(500px,100%);background:#fff;
  display:flex;flex-direction:column;box-shadow:var(--sh-3);animation:slidein .28s cubic-bezier(.3,1.1,.5,1)}
@keyframes slidein{from{opacity:.4;transform:translateX(-6%)}to{opacity:1;transform:none}}
.dwhd{padding:1.1rem 1.2rem;border-bottom:1px solid var(--line);display:flex;align-items:center;
  justify-content:space-between;gap:1rem}
.dwhd h2{margin:0;font-size:1.08rem;font-weight:800}
.dwhd .sub{font-size:.78rem;color:var(--dim)}
.dwlist{flex:1;overflow:auto;padding:.6rem}
.li{display:grid;grid-template-columns:56px 1fr auto;gap:.75rem;align-items:center;padding:.6rem;
  border-bottom:1px solid var(--line)}
.li:last-child{border-bottom:0}
.li .im{width:56px;height:56px;border:1px solid var(--line);border-radius:9px;background:var(--sink);
  display:grid;place-items:center;overflow:hidden}
.li .im img{width:100%;height:100%;object-fit:contain;padding:5px;mix-blend-mode:multiply}
.li .im span{font-size:.55rem;color:var(--faint)}
.li h4{margin:0 0 .15rem;font-size:.83rem;font-weight:700;line-height:1.5;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.li small{font-size:.7rem;color:var(--dim)}
.li .rm{border:0;background:none;cursor:pointer;color:#a13c31;font-size:1.1rem;padding:.3rem}
.dwft{border-top:1px solid var(--line);padding:1rem 1.2rem;display:flex;flex-direction:column;gap:.6rem}
.exp{display:flex;gap:.55rem;flex-wrap:wrap}
.exp .btn{flex:1;min-width:130px;text-align:center;justify-content:center}
.hint{font-size:.74rem;color:var(--tan);background:var(--tanbg);border:1px solid #f0dcc6;
  border-radius:9px;padding:.5rem .65rem;line-height:1.6}
.empty2{text-align:center;padding:3rem 1rem;color:var(--dim);font-size:.9rem}
.toast{position:fixed;inset-block-end:1.3rem;inset-inline-end:1.3rem;z-index:90;background:var(--ink);
  color:#fff;padding:.7rem 1.1rem;border-radius:10px;font-size:.86rem;box-shadow:var(--sh-3);
  opacity:0;transform:translateY(8px);transition:.22s;pointer-events:none}
.toast.on{opacity:1;transform:none}

/* print: only the shortlist sheet */
#sheetprint{display:none}
@media print{
  body>*:not(#sheetprint){display:none!important}
  #sheetprint{display:block!important}
  @page{size:A4 portrait;margin:14mm 10mm}
  #sheetprint h1{font-size:17pt;margin:0 0 2mm}
  #sheetprint .meta{font-size:9pt;color:#555;margin:0 0 6mm;padding-bottom:3mm;border-bottom:1.5pt solid #111}
  #sheetprint table{width:100%;border-collapse:collapse;table-layout:fixed}
  #sheetprint thead{display:table-header-group}
  #sheetprint tr{page-break-inside:avoid}
  #sheetprint th{background:#1f5673;color:#fff;font-size:8.5pt;padding:2mm;border:.4pt solid #1f5673}
  #sheetprint td{border:.4pt solid #ccd3da;padding:1.6mm;font-size:8.5pt;vertical-align:middle}
  #sheetprint td.i{text-align:center}
  #sheetprint td.i img{max-width:100%;max-height:15mm;object-fit:contain}
  #sheetprint .lat{font-family:"DejaVu Sans Mono",monospace;direction:ltr;unicode-bidi:isolate}
}
</style>
</head>
<body>

<header class="hero"><div class="wrap">
  <div class="brandmark">
    <i><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round"><path d="M14.7 6.3a4 4 0 0 1 5 5L8.7 22.3a2.1 2.1 0 0 1-3-3L16.7 8.3"/>
      <path d="M14.7 6.3 18 3l3 3-3.3 3.3"/></svg></i>
    <span>BELA</span>
  </div>
  <h1>كتالوج العدد والأدوات والمعدات الصناعية</h1>
  <p class="lede">تشكيلة من العدد اليدوية وأجهزة القياس ومعدات اللحام والتشغيل من علامات
    أوروبية وأمريكية. تصفّح حسب الفئة أو ابحث عن المنتج الذي تحتاجه.</p>
  <div class="stats">
    <div class="stat"><b>__TOTAL__</b><span>منتج</span></div>
    <div class="stat"><b>__CATS__</b><span>فئات رئيسية</span></div>
    <div class="stat"><b>__BRANDS__</b><span>علامة تجارية</span></div>
    <div class="stat"><b>__PHOTOS__</b><span>منتج بصورة</span></div>
  </div>
</div></header>

<div class="wrap catwrap">
  <p class="eyebrow">تصفّح حسب الفئة</p>
  <div class="cats" id="cats"></div>
</div>

<div class="bar"><div class="wrap">
  <div class="search">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
    <input id="q" type="search" placeholder="ابحث باسم المنتج أو الكود أو العلامة…" autocomplete="off">
  </div>
  <button class="chip" data-g="all" aria-pressed="true">الكل</button>
  <span id="chips"></span>
  <select id="brand" aria-label="تصفية حسب العلامة التجارية"></select>
  <button id="clear" hidden>مسح ✕</button>
  <span class="tally" id="tally"></span>
</div></div>

<main><div class="wrap" id="out"></div></main>

<footer><div class="wrap">
  الصور استرشادية لتوضيح نوع المنتج وقد تختلف في التفاصيل عن الوحدة المعروضة.
  التوفر يخضع للتأكيد عند الطلب. للاستفسار عن أي منتج يُرجى التواصل معنا.
</div></footer>

<div class="ov" id="ov" role="dialog" aria-modal="true" aria-labelledby="dtitle">
  <div class="sheet" id="sheet"></div>
</div>

<button class="fab" id="fab" aria-label="عرض قائمة الاختيار">
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round"><path d="M3 4h2l2.4 11.4a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.55L21 8H6"/>
    <circle cx="10" cy="20" r="1.3"/><circle cx="18" cy="20" r="1.3"/></svg>
  قائمة الاختيار <b id="fabn">0</b>
</button>

<div class="dw" id="dw" role="dialog" aria-modal="true" aria-labelledby="dwt">
  <div class="dwbox">
    <div class="dwhd">
      <div><h2 id="dwt">قائمة الاختيار</h2><span class="sub" id="dwsub"></span></div>
      <button class="btn" data-dwclose>إغلاق</button>
    </div>
    <div class="dwlist" id="dwlist"></div>
    <div class="dwft">
      <div id="dwhint"></div>
      <div class="exp">
        <button class="btn pri" id="expPdf">تصدير PDF</button>
        <button class="btn" id="expXls">تصدير Excel</button>
        <button class="btn" id="expClear">تفريغ القائمة</button>
      </div>
    </div>
  </div>
</div>

<div id="sheetprint"></div>
<div class="toast" id="toast"></div>
<script>
const D=__DATA__, ITEMS=D.items, CATS=D.cats, BRANDS=D.brands;
const CATMAP=Object.fromEntries(CATS.map(c=>[c.id,c.label]));
let g='all', term='', brand='';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
const gs=it=>'https://www.google.com/search?tbm=isch&q='+encodeURIComponent(`${it.b} ${it.c} ${it.s}`.slice(0,110));

$('#cats').innerHTML=CATS.map(c=>`<button class="cat" data-g="${c.id}" aria-pressed="false">
  <h3>${esc(c.label)}</h3><p>${esc(c.sub)}</p><b>${c.n.toLocaleString('en-US')} منتج</b>
  <span class="catadd" role="button" tabindex="0" data-addcat="${c.id}">+ إضافة الفئة كاملة</span></button>`).join('');
$('#chips').innerHTML=CATS.map(c=>`<button class="chip" data-g="${c.id}" aria-pressed="false">${esc(c.label)}</button>`).join('');
$('#brand').innerHTML=`<option value="">كل العلامات (${BRANDS.length})</option>`+
  BRANDS.map(b=>`<option value="${esc(b.b)}">${esc(b.b)} — ${b.n}</option>`).join('');

function photo(it,cls){
  return it.p ? `<img loading="lazy" src="${it.p}" alt="${esc(it.n)}">`
              : `<span class="none">لا تتوفر صورة<br>لهذا المنتج</span>`;
}
function card(it,i){
  return `<button class="card ${PICK.has(i)?'on':''}" data-i="${i}">
    <span class="ph">${photo(it)}<span class="tag">${esc(CATMAP[it.g]||'')}</span>
      <span class="pick" role="button" tabindex="0" data-pick="${i}" aria-label="إضافة إلى قائمة الاختيار">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
          <path d="M12 5v14M5 12h14"/></svg></span></span>
    <span class="info">
      <span class="nm">${esc(it.n)}</span>
      <span class="meta">
        <span><span class="bd">${esc(it.b||'—')}</span><br><span class="cd lat">${esc(it.c)}</span></span>
        ${it.o?`<span class="org">${esc(it.o)}</span>`:''}
      </span>
    </span></button>`;
}
function sync(){
  document.querySelectorAll('.chip').forEach(x=>x.setAttribute('aria-pressed',String(x.dataset.g===g)));
  document.querySelectorAll('.cat').forEach(x=>x.setAttribute('aria-pressed',String(x.dataset.g===g)));
  $('#brand').classList.toggle('on',!!brand);
  $('#clear').hidden=!(brand||g!=='all'||term.trim());
}
function match(it){
  const t=term.trim().toLowerCase();
  if(g!=='all'&&it.g!==g) return false;
  if(brand&&it.b!==brand) return false;
  if(!t) return true;
  return it.n.includes(term.trim())||it.d.includes(term.trim())||
         it.c.toLowerCase().includes(t)||it.b.toLowerCase().includes(t)||
         (it.s||'').toLowerCase().includes(t);
}
function render(){
  sync();
  const sel=[]; ITEMS.forEach((it,i)=>{ if(match(it)) sel.push(i); });
  $('#tally').textContent=sel.length?`${sel.length.toLocaleString('en-US')} منتج`:'';
  const out=$('#out');
  if(!sel.length){ out.innerHTML=`<p class="none-found">لا توجد منتجات مطابقة.<br>جرّب كلمة أخرى أو امسح التصفية.</p>`; return; }
  let h='';
  for(const c of CATS){
    const part=sel.filter(i=>ITEMS[i].g===c.id);
    if(!part.length) continue;
    h+=`<section class="sec"><div class="sechd"><h2>${esc(c.label)}</h2>
      <em>${part.length.toLocaleString('en-US')} منتج</em></div>
      <div class="grid">${part.map(i=>card(ITEMS[i],i)).join('')}</div></section>`;
  }
  out.innerHTML=h;
}
function open(i){
  const it=ITEMS[i];
  $('#sheet').innerHTML=`<button class="x" aria-label="إغلاق">✕</button>
    <div class="top">
      <div class="pic">${photo(it)}</div>
      <div>
        <span class="bd">${esc(it.b||'—')}</span>
        <h3 id="dtitle">${esc(it.n)}</h3>
        <dl class="kv">
          <dt>كود الصنف</dt><dd class="lat">${esc(it.c)}</dd>
          <dt>الفئة</dt><dd>${esc(CATMAP[it.g]||'')}</dd>
          ${it.s?`<dt>المواصفة</dt><dd class="lat">${esc(it.s)}</dd>`:''}
          ${it.o?`<dt>بلد المنشأ</dt><dd>${esc(it.o)}</dd>`:''}
        </dl>
        <div class="body">${esc(it.d)}</div>
        <div class="acts">
          <button class="btn add ${PICK.has(i)?'on':''}" data-add="${i}">${PICK.has(i)?'✓ في قائمة الاختيار':'+ أضف إلى قائمة الاختيار'}</button>
          <a class="btn pri" href="${gs(it)}" target="_blank" rel="noopener">عرض صور مشابهة ↗</a>
          <button class="btn" data-close>إغلاق</button>
        </div>
      </div>
    </div>`;
  $('#ov').classList.add('on'); document.body.style.overflow='hidden';
}
function close(){ $('#ov').classList.remove('on'); document.body.style.overflow=''; }

document.addEventListener('click',e=>{
  const card=e.target.closest('.card'); if(card){ open(+card.dataset.i); return; }
  const nav=e.target.closest('.chip,.cat');
  if(nav){ g=nav.dataset.g; render();
    (nav.classList.contains('cat')?$('.bar'):document.body).scrollIntoView({behavior:'smooth',block:'start'});
    return; }
  if(e.target.closest('.x,[data-close]')||e.target.id==='ov') close();
});
$('#brand').addEventListener('change',e=>{brand=e.target.value;render()});
$('#clear').addEventListener('click',()=>{g='all';brand='';term='';$('#brand').value='';$('#q').value='';render()});
let t; $('#q').addEventListener('input',e=>{clearTimeout(t);t=setTimeout(()=>{term=e.target.value;render()},150)});
addEventListener('keydown',e=>{ if(e.key==='Escape') close(); });
/* ── shortlist ─────────────────────────────────────────────────────── */
/* Selections are keyed by row index. Product codes are NOT unique in this
   catalogue (the same code appears under different sizes), so a code-based key
   would silently select two products at once. VER invalidates a stored list if
   the catalogue contents change. */
const KEY='bela.shortlist.v2', VER='__VER__';
let PICK=new Set();
try{ const st=JSON.parse(localStorage.getItem(KEY)||'null');
     if(st && st.v===VER && Array.isArray(st.ids)) PICK=new Set(st.ids.filter(i=>ITEMS[i])); }catch(_){}
const save=()=>{ try{ localStorage.setItem(KEY,JSON.stringify({v:VER,ids:[...PICK]})); }catch(_){} };
const picked=()=>[...PICK].sort((a,b)=>a-b).map(i=>ITEMS[i]).filter(Boolean);

let tt;
function toast(msg){
  const el=$('#toast'); el.textContent=msg; el.classList.add('on');
  clearTimeout(tt); tt=setTimeout(()=>el.classList.remove('on'),2200);
}
function syncPick(){
  const n=PICK.size;
  $('#fabn').textContent=n; $('#fab').classList.toggle('show',n>0);
  document.querySelectorAll('.card').forEach(c=>{
    c.classList.toggle('on',PICK.has(+c.dataset.i));
  });
  const btn=document.querySelector('.btn.add');
  if(btn){ const on=PICK.has(+btn.dataset.add);
    btn.classList.toggle('on',on); btn.textContent=on?'✓ في قائمة الاختيار':'+ أضف إلى قائمة الاختيار'; }
}
function toggle(i){
  if(PICK.has(i)){ PICK.delete(i); } else { PICK.add(i); }
  save(); syncPick();
}
function addCat(g){
  let n=0;
  ITEMS.forEach((it,i)=>{ if(it.g===g && !PICK.has(i)){ PICK.add(i); n++; } });
  save(); syncPick(); drawer();
  toast(n?`أُضيف ${n.toLocaleString('en-US')} منتج من ${CATMAP[g]}`:'كل منتجات هذه الفئة مضافة');
}

/* drawer */
function drawer(){
  const list=picked();
  $('#dwsub').textContent=list.length?`${list.length.toLocaleString('en-US')} منتج مختار`:'لا توجد منتجات بعد';
  const idx=[...PICK].sort((a,b)=>a-b);
  $('#dwlist').innerHTML = list.length ? list.map((it,j)=>`
    <div class="li">
      <span class="im">${it.p?`<img src="${it.p}" alt="">`:`<span>لا صورة</span>`}</span>
      <span><h4>${esc(it.n)}</h4>
        <small>${esc(it.b||'—')} · <span class="lat">${esc(it.c)}</span> · ${esc(CATMAP[it.g]||'')}</small></span>
      <button class="rm" data-rm="${idx[j]}" aria-label="إزالة">✕</button>
    </div>`).join('')
    : `<p class="empty2">لم تختر أي منتج بعد.<br>اضغط زر + على أي منتج أو أضف فئة كاملة.</p>`;
  const embedded = window.self!==window.top;
  $('#dwhint').innerHTML = embedded
    ? `<div class="hint">داخل هذه المعاينة يتم الحفظ عبر نافذة تأكيد، وقد يُصدَّر Excel بصيغة CSV.
       للحصول على ملف <b>xlsx</b> كامل، افتح نسخة الكتالوج المحفوظة على جهازك.</div>` : '';
  ['#expPdf','#expXls','#expClear'].forEach(sl=>$(sl).disabled=!list.length);
}

/* ── file helpers ──────────────────────────────────────────────────── */
function directSave(name, blob){
  try{
    const u=URL.createObjectURL(blob), a=document.createElement('a');
    a.href=u; a.download=name; document.body.appendChild(a); a.click();
    setTimeout(()=>{URL.revokeObjectURL(u); a.remove();},1500);
    return true;
  }catch(_){ return false; }
}
/* Inside the claude.ai artifact viewer a page cannot start its own download;
   the host mediates it. .xlsx is not an allowed extension there, so fall back
   to CSV (BOM-prefixed so Excel reads the Arabic correctly). */
async function hostSave(){
  try{ return (typeof claude!=='undefined' && claude.use) ? await claude.use('downloads') : null; }
  catch(_){ return null; }
}
async function offer(name, blob, fb){
  const dl = await hostSave();
  if(dl){
    try{ await dl.save({filename:name, data:blob}); return 'ok'; }
    catch(e){
      const c=e&&e.code;
      if((c==='rejected_extension'||c==='extension_not_enabled') && fb){
        try{ await dl.save({filename:fb.name, data:fb.blob}); return 'fallback'; }
        catch(e2){ return (e2&&e2.code)||'unavailable'; }
      }
      return c||'unavailable';
    }
  }
  return directSave(name, blob) ? 'ok' : 'blocked';
}
function csvBlob(rows, headers){
  const q=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
  const body=[headers.map(q).join(',')].concat(rows.map(r=>r.map(q).join(','))).join('\r\n');
  return new Blob(['﻿'+body],{type:'text/csv;charset=utf-8'});
}

/* minimal .xlsx writer: a stored (uncompressed) ZIP of the required parts.
   Excel accepts store-method entries, so no deflate implementation is needed. */
const CRCT=(()=>{const t=new Uint32Array(256);
  for(let i=0;i<256;i++){let c=i;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);t[i]=c>>>0}
  return t})();
function crc32(u8){let c=0xFFFFFFFF;for(let i=0;i<u8.length;i++)c=CRCT[(c^u8[i])&255]^(c>>>8);return (c^0xFFFFFFFF)>>>0}
function zip(files){
  const enc=new TextEncoder(), chunks=[], central=[]; let off=0;
  const u16=n=>[n&255,(n>>8)&255], u32=n=>[n&255,(n>>8)&255,(n>>16)&255,(n>>24)&255];
  for(const f of files){
    const name=enc.encode(f.name), data=enc.encode(f.data), crc=crc32(data);
    const hdr=[...u32(0x04034b50),...u16(20),...u16(0x800),...u16(0),...u16(0),...u16(0),
      ...u32(crc),...u32(data.length),...u32(data.length),...u16(name.length),...u16(0)];
    chunks.push(new Uint8Array(hdr),name,data);
    central.push({name,crc,len:data.length,off});
    off += hdr.length+name.length+data.length;
  }
  const cd=[];
  for(const c of central){
    cd.push(new Uint8Array([...u32(0x02014b50),...u16(20),...u16(20),...u16(0x800),...u16(0),
      ...u16(0),...u16(0),...u32(c.crc),...u32(c.len),...u32(c.len),...u16(c.name.length),
      ...u16(0),...u16(0),...u16(0),...u16(0),...u32(0),...u32(c.off)]), c.name);
  }
  const cdLen=cd.reduce((a,b)=>a+b.length,0);
  const eocd=new Uint8Array([...u32(0x06054b50),...u16(0),...u16(0),
    ...u16(central.length),...u16(central.length),...u32(cdLen),...u32(off),...u16(0)]);
  return new Blob([...chunks,...cd,eocd],
    {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
const xe=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[m]));
function xlsx(rows, headers){
  const col=i=>{let s='',n=i+1;while(n){s=String.fromCharCode(65+(n-1)%26)+s;n=Math.floor((n-1)/26)}return s};
  const cell=(c,r,v,st)=>`<c r="${c}${r}" t="inlineStr"${st?` s="${st}"`:''}><is><t xml:space="preserve">${xe(v)}</t></is></c>`;
  let sh=`<row r="1" ht="22" customHeight="1">`+headers.map((h,i)=>cell(col(i),1,h,1)).join('')+`</row>`;
  rows.forEach((r,ri)=>{
    sh+=`<row r="${ri+2}">`+r.map((v,i)=>cell(col(i),ri+2,v,0)).join('')+`</row>`;
  });
  const cols=[38,52,18,20,26,34,18].map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('');
  const sheet=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView rightToLeft="1" workbookViewId="0" tabSelected="1">
<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${cols}</cols><sheetData>${sh}</sheetData>
<autoFilter ref="A1:${col(headers.length-1)}${rows.length+1}"/></worksheet>`;
  const styles=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF1F5673"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1">
<alignment vertical="center" wrapText="1" readingOrder="2"/></xf>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1">
<alignment horizontal="center" vertical="center" wrapText="1" readingOrder="2"/></xf></cellXfs>
</styleSheet>`;
  return zip([
    {name:'[Content_Types].xml',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`},
    {name:'_rels/.rels',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`},
    {name:'xl/workbook.xml',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="قائمة الاختيار" sheetId="1" r:id="rId1"/></sheets></workbook>`},
    {name:'xl/_rels/workbook.xml.rels',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`},
    {name:'xl/styles.xml',data:styles},
    {name:'xl/worksheets/sheet1.xml',data:sheet},
  ]);
}

const HEAD=['اسم المنتج','الوصف والاستخدام','العلامة التجارية','كود الصنف','الفئة','المواصفة الفنية','بلد المنشأ'];
async function exportXls(){
  const list=picked(); if(!list.length) return;
  const rows=list.map(it=>[it.n,it.d,it.b||'',it.c,CATMAP[it.g]||'',it.s||'',it.o||'']);
  toast('جارٍ تجهيز الملف…');
  const r=await offer('BELA-shortlist.xlsx', xlsx(rows,HEAD),
                      {name:'BELA-shortlist.csv', blob:csvBlob(rows,HEAD)});
  toast(r==='ok' ? 'تم تجهيز ملف Excel'
      : r==='fallback' ? 'تم التصدير بصيغة CSV (يفتح في Excel)'
      : r==='declined' ? 'تم إلغاء الحفظ'
      : 'تعذّر الحفظ هنا — افتح نسخة الكتالوج على جهازك');
}
function exportPdf(){
  const list=picked(); if(!list.length) return;
  const d=new Date(), stamp=`${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
  $('#sheetprint').innerHTML=`
    <h1>قائمة الاختيار — عدد وأدوات ومعدات</h1>
    <p class="meta">${list.length.toLocaleString('en-US')} منتج · ${stamp}</p>
    <table><thead><tr>
      <th style="width:20mm">الصورة</th><th style="width:52mm">اسم المنتج</th>
      <th style="width:24mm">العلامة</th><th style="width:24mm">كود الصنف</th>
      <th>الوصف والاستخدام</th><th style="width:22mm">بلد المنشأ</th>
    </tr></thead><tbody>${list.map(it=>`<tr>
      <td class="i">${it.p?`<img src="${it.p}">`:'—'}</td>
      <td>${esc(it.n)}</td><td>${esc(it.b||'—')}</td>
      <td class="lat">${esc(it.c)}</td><td>${esc(it.d)}</td><td>${esc(it.o||'—')}</td>
    </tr>`).join('')}</tbody></table>`;
  setTimeout(async ()=>{
    try{ window.print(); }
    catch(_){
      // printing is blocked in some embedded viewers — hand over an HTML sheet instead
      const doc='<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8">'+
        '<title>قائمة الاختيار</title>'+
        document.querySelector('style').outerHTML+
        '<body onload="window.print()">'+$('#sheetprint').outerHTML+'</body></html>';
      const r=await offer('BELA-shortlist.html', new Blob([doc],{type:'text/html'}));
      toast(r==='ok' ? 'تم حفظ الملف — افتحه ثم اطبعه كـ PDF'
                     : 'تعذّر فتح الطباعة هنا — افتح نسخة الكتالوج على جهازك');
    }
  },120);
}

/* wiring */
document.addEventListener('click',e=>{
  const pk=e.target.closest('[data-pick]');
  if(pk){ e.stopPropagation(); toggle(+pk.dataset.pick); drawer(); return; }
  const ac=e.target.closest('[data-addcat]');
  if(ac){ e.stopPropagation(); addCat(ac.dataset.addcat); return; }
  const ab=e.target.closest('[data-add]');
  if(ab){ toggle(+ab.dataset.add); drawer(); return; }
  const rm=e.target.closest('[data-rm]');
  if(rm){ PICK.delete(+rm.dataset.rm); save(); syncPick(); drawer(); return; }
  if(e.target.closest('#fab')){ $('#dw').classList.add('on'); drawer(); document.body.style.overflow='hidden'; return; }
  if(e.target.closest('[data-dwclose]')||e.target.id==='dw'){
    $('#dw').classList.remove('on'); document.body.style.overflow=''; }
},true);
$('#expXls').addEventListener('click',exportXls);
$('#expPdf').addEventListener('click',exportPdf);
$('#expClear').addEventListener('click',()=>{ PICK.clear(); save(); syncPick(); drawer(); toast('تم تفريغ القائمة'); });
addEventListener('keydown',e=>{ if(e.key==='Escape'&&$('#dw').classList.contains('on')){
  $('#dw').classList.remove('on'); document.body.style.overflow=''; } });

render();
syncPick();
drawer();
</script>


</body>
</html>
"""

if __name__ == "__main__":
    main()
