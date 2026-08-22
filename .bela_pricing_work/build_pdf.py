"""Render the catalog to PDF through headless Chromium.

Chromium is used deliberately: it applies Arabic contextual shaping and the
bidi algorithm correctly, which naive PDF libraries do not. Real <table>
elements are used so the column header repeats on every printed page.
"""
import json, re, io, os, time, base64, socket, subprocess, html as H
from collections import defaultdict
from urllib.request import urlopen

import glob as _glob
_c = sorted(_glob.glob(os.path.expanduser("~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome")))
CHROME = _c[-1] if _c else "chromium"

CAT = {'machinery':'الآلات والمعدات','premium':'أجهزة القياس والفحص',
       'other':'العدد والأدوات اليدوية','draper':'أدوات دريبر'}
CAT_ORDER = ['machinery','premium','other','draper']
COO_AR = {'GERMANY':'ألمانيا','USA':'الولايات المتحدة','UK':'المملكة المتحدة','SPAIN':'إسبانيا',
          'ITALY':'إيطاليا','AUSTRIA':'النمسا','JAPAN':'اليابان','SWEDEN':'السويد',
          'DENMARK':'الدنمارك','TW':'تايوان'}
UOM_AR = {'EA':'حبة','PKT':'باكيت','SET':'طقم','KIT':'طقم','PC':'قطعة','PCS':'قطعة',
          'ROLL':'لفة','BOX':'علبة','PAIR':'زوج','MTR':'متر','M':'متر'}
AR_RUN = re.compile(r'[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]+')


def clean_spec(d):
    s = AR_RUN.sub(' ', d); s = re.sub(r'\s+', ' ', s)
    s = re.sub(r'^[\s,.\-/:;]+|[\s,.\-/:;]+$', '', s)
    s = re.sub(r'\s*,\s*', ', ', s)
    s = re.sub(r'(?<!\b[A-Za-z])\s+\d{1,2}$', '', s)
    m = re.search(r'(?<!\b[A-Za-z])\s+(\d{3,})$', s)
    if m and m.group(1) in s[:m.start()]:
        s = s[:m.start()]
    return s if len(re.sub(r'[^A-Za-z0-9]', '', s)) >= 2 else ''


def bucket_of(b):
    MACH={'EPS','SOLTER','SCANTOOL','GRIGGRIO','CITY','BUCO'}
    PREM={'FLUKE','KNIPEX','EXTECH','AMPROBE','KLAUKE','WAVETEK','B/K','ALNOR','MITUTOY','COLEPARME','BW'}
    b=b.strip().upper()
    if b in MACH: return 'machinery'
    if b in PREM: return 'premium'
    if b=='DRAPER': return 'draper'
    return 'other'


def esc(s): return H.escape(str(s) if s is not None else '')


def load(drop_empty):
    rows = json.load(open("inventory_full.json", encoding="utf-8"))
    imgs = json.load(open("image_data.json", encoding="utf-8"))
    out=[]
    for r in rows:
        q=float(r['qty'])
        if drop_empty and q<=0: continue
        brand=(r['brand_clean'] or '').strip()
        uom=(r.get('uom') or '').strip().upper()
        out.append({'code':(r['code'] or '').strip(),'brand':brand,
            'spec':clean_spec(re.sub(r'\s+',' ',r['descr'] or '').strip()),
            'desc':(r.get('description_ar_rich') or r.get('description_ar') or '').strip(),
            'qty':int(q),'uom':UOM_AR.get(uom,uom.title() if uom else 'وحدة'),
            'origin':COO_AR.get(r.get('coo_clean') or '','—'),
            'catid':bucket_of(brand),
            'cost':float(r['uc']),'price':r.get('probable_price_sar'),
            'conf':r.get('confidence') or '','review':bool(r.get('needs_review')),
            'img':imgs.get(r.get('image_url'),'')})
    out.sort(key=lambda x:(CAT_ORDER.index(x['catid']), x['brand'], -x['qty']))
    return out


CSS = """
@page { size: %(size)s; margin: 14mm 10mm 16mm 10mm; }
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{font-family:"Noto Naskh Arabic","Noto Sans Arabic",Tahoma,sans-serif;
  direction:rtl;color:#15181c;font-size:9pt;line-height:1.55;
  -webkit-print-color-adjust:exact;print-color-adjust:exact}
.mono{font-family:"DejaVu Sans Mono",monospace;direction:ltr;unicode-bidi:isolate}

/* cover */
.cover{height:%(coverh)s;display:flex;flex-direction:column;justify-content:center;
  page-break-after:always;padding:0 6mm}
.cover .eyebrow{font-size:10pt;letter-spacing:.12em;color:#1f5673;font-weight:700;margin-bottom:6mm}
.cover h1{font-size:30pt;margin:0 0 4mm;font-weight:700;line-height:1.25}
.cover .sub{font-size:11pt;color:#5f6873;max-width:150mm;margin:0 0 10mm}
.kpis{display:flex;gap:12mm;flex-wrap:wrap;border-top:1.5pt solid #15181c;padding-top:6mm}
.kpi .v{font-size:19pt;font-weight:700;font-family:"DejaVu Sans",sans-serif;direction:ltr}
.kpi .l{font-size:8.5pt;color:#5f6873}
.cover .note{margin-top:10mm;font-size:8.5pt;color:#5f6873;border-right:2pt solid #1f5673;
  padding-right:4mm;max-width:160mm}

/* section */
h2.cat{font-size:14pt;margin:0 0 3mm;padding-bottom:2mm;border-bottom:1.5pt solid #15181c;
  page-break-after:avoid;page-break-before:always}
h2.cat span{font-size:9pt;color:#5f6873;font-weight:400;font-family:"DejaVu Sans",sans-serif}
section:first-of-type h2.cat{page-break-before:avoid}

/* the table: fixed layout keeps every column in the same place on every page */
table{width:100%%;border-collapse:collapse;table-layout:fixed}
thead{display:table-header-group}          /* repeat header on each page */
tr{page-break-inside:avoid}
th{background:#1f5673;color:#fff;font-size:8pt;font-weight:700;padding:2mm 1.5mm;
  text-align:center;border:.4pt solid #1f5673}
td{border:.4pt solid #d8dee4;padding:1.6mm;vertical-align:middle;font-size:8.5pt}
tbody tr:nth-child(even) td{background:#fafbfc}
td.c{text-align:center}
td.code{font-family:"DejaVu Sans Mono",monospace;direction:ltr;text-align:left;
  font-size:8pt;font-weight:700;word-break:break-all}
td.spec{font-family:"DejaVu Sans Mono",monospace;direction:ltr;text-align:right;
  font-size:7.5pt;color:#5f6873;word-break:break-word}
td.desc{font-size:8pt;line-height:1.5}
td.qty{text-align:center;font-weight:700;color:#9a5518;background:#fdf3e9;
  font-family:"DejaVu Sans",sans-serif;direction:ltr}
td.money{font-family:"DejaVu Sans",sans-serif;direction:ltr;text-align:left;font-size:8pt}
.thumb{width:100%%;height:15mm;display:flex;align-items:center;justify-content:center;overflow:hidden}
.thumb img{max-width:100%%;max-height:15mm;object-fit:contain}
.noimg{font-size:6.5pt;color:#b4bcc5}
.conf{font-size:7pt;font-weight:700;padding:.6mm 1.4mm;border-radius:2pt;display:inline-block}
.c-good{background:#e3ece4;color:#2f5c36}
.c-warn{background:#f3e9d2;color:#7a5a10}
.c-bad{background:#f3dedb;color:#7c2e24}
.flag{color:#7c2e24;font-weight:700}
"""

CONF_CLS = {'مرتفع':'c-good','متوسط':'c-warn','منخفض':'c-bad'}


def build_html(items, internal):
    size = "A4 landscape" if internal else "A4 portrait"
    coverh = "170mm" if internal else "250mm"
    css = CSS % {'size': size, 'coverh': coverh}

    if internal:
        colgroup = ("<col style='width:22mm'><col style='width:26mm'><col style='width:24mm'>"
                    "<col style='width:38mm'><col style='width:auto'><col style='width:16mm'>"
                    "<col style='width:14mm'><col style='width:20mm'><col style='width:20mm'>"
                    "<col style='width:20mm'><col style='width:18mm'>")
        head = ("<th>الصورة</th><th>كود الصنف</th><th>العلامة</th><th>المواصفة الفنية</th>"
                "<th>الوصف والاستخدام</th><th>الكمية</th><th>الوحدة</th><th>بلد المنشأ</th>"
                "<th>تكلفة الوحدة</th><th>السعر المحتمل</th><th>الثقة</th>")
    else:
        colgroup = ("<col style='width:20mm'><col style='width:24mm'><col style='width:22mm'>"
                    "<col style='width:34mm'><col style='width:auto'><col style='width:15mm'>"
                    "<col style='width:13mm'><col style='width:20mm'>")
        head = ("<th>الصورة</th><th>كود الصنف</th><th>العلامة</th><th>المواصفة الفنية</th>"
                "<th>الوصف والاستخدام</th><th>الكمية</th><th>الوحدة</th><th>بلد المنشأ</th>")

    total=len(items); units=sum(i['qty'] for i in items)
    brands=len({i['brand'] for i in items if i['brand']}); photos=sum(1 for i in items if i['img'])
    kpis=[('عدد الأصناف',f"{total:,}"),('إجمالي الوحدات',f"{units:,}"),
          ('العلامات التجارية',f"{brands:,}"),('أصناف بصورة',f"{photos:,}")]
    if internal:
        kpis.append(('إجمالي التكلفة',f"{sum(i['cost']*i['qty'] for i in items):,.0f} ر.س"))

    note = ("ملاحظة: «السعر المحتمل» تقدير سوقي مبني على بحث مستقل لكل صنف، وليس عرض سعر نهائي. "
            "العملة مفترضة بالريال السعودي إذ لا يذكرها الملف المصدر صراحةً. هذا المستند داخلي.")\
           if internal else \
           ("الكميات تعكس المخزون المتوفر وقت إصدار القائمة وقابلة للتغيير. الصور استرشادية لتوضيح "
            "نوع المنتج وقد تختلف في التفاصيل عن الوحدة المعروضة. الأسعار غير مدرجة — تُقدَّم عند الطلب.")

    parts=[f"<!doctype html><html lang='ar' dir='rtl'><head><meta charset='utf-8'>"
           f"<title>قائمة المعروضات</title><style>{css}</style></head><body>"]

    parts.append("<div class='cover'>"
        f"<div class='eyebrow'>{'مستند داخلي — لا يُوزَّع' if internal else 'قائمة معروضات — متاحة للبيع'}</div>"
        "<h1>عدد وأدوات ومعدات صناعية</h1>"
        "<p class='sub'>مخزون متكامل من العدد اليدوية وأجهزة القياس ومعدات اللحام والتشغيل، "
        "من علامات أوروبية وأمريكية. لكل صنف وصفه واستخدامه والكمية المتوفرة.</p>"
        "<div class='kpis'>" +
        "".join(f"<div class='kpi'><div class='v'>{v}</div><div class='l'>{l}</div></div>"
                for l,v in kpis) +
        f"</div><div class='note'>{note}</div></div>")

    for cid in CAT_ORDER:
        part=[i for i in items if i['catid']==cid]
        if not part: continue
        parts.append(f"<section><h2 class='cat'>{CAT[cid]} "
                     f"<span>{len(part):,} صنف</span></h2>"
                     f"<table><colgroup>{colgroup}</colgroup><thead><tr>{head}</tr></thead><tbody>")
        for it in part:
            img = (f"<div class='thumb'><img src='{it['img']}'></div>" if it['img']
                   else "<div class='thumb'><span class='noimg'>لا تتوفر صورة</span></div>")
            row=[f"<td class='c'>{img}</td>",
                 f"<td class='code'>{esc(it['code'])}</td>",
                 f"<td class='c'>{esc(it['brand'])}</td>",
                 f"<td class='spec'>{esc(it['spec'])}</td>",
                 f"<td class='desc'>{esc(it['desc'])}</td>",
                 f"<td class='qty'>{it['qty']:,}</td>",
                 f"<td class='c'>{esc(it['uom'])}</td>",
                 f"<td class='c'>{esc(it['origin'])}</td>"]
            if internal:
                pr = f"{it['price']:,.0f}" if it['price'] is not None else '—'
                cls = CONF_CLS.get(it['conf'],'')
                flag = " <span class='flag'>⚑</span>" if it['review'] else ""
                row += [f"<td class='money'>{it['cost']:,.0f}</td>",
                        f"<td class='money'>{pr}{flag}</td>",
                        f"<td class='c'><span class='conf {cls}'>{esc(it['conf'])}</span></td>"]
            parts.append("<tr>"+"".join(row)+"</tr>")
        parts.append("</tbody></table></section>")

    parts.append("</body></html>")
    return "".join(parts)


# ── Chromium render ────────────────────────────────────────────────────
def free_port():
    s=socket.socket(); s.bind(('127.0.0.1',0)); p=s.getsockname()[1]; s.close(); return p


class CDP:
    def __init__(self, ws):
        from websocket import create_connection
        self.ws=create_connection(ws, timeout=900, max_size=None); self.i=0
    def send(self, method, **params):
        self.i+=1
        self.ws.send(json.dumps({"id":self.i,"method":method,"params":params}))
        while True:
            m=json.loads(self.ws.recv())
            if m.get("id")==self.i:
                if "error" in m: raise RuntimeError(m["error"])
                return m.get("result",{})


FOOTER = ("<div style='width:100%;font-size:8px;font-family:sans-serif;color:#5f6873;"
          "padding:0 10mm;display:flex;justify-content:space-between;direction:rtl'>"
          "<span>قائمة المعروضات — عدد وأدوات ومعدات</span>"
          "<span>صفحة <span class='pageNumber'></span> من <span class='totalPages'></span></span>"
          "</div>")


def render(html_path, pdf_path, landscape):
    port=free_port()
    proc=subprocess.Popen([CHROME,f"--remote-debugging-port={port}","--headless=new",
        "--no-sandbox","--disable-gpu","--remote-allow-origins=*",
        "--font-render-hinting=none","about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        ws=None
        for _ in range(80):
            try:
                tabs=json.loads(urlopen(f"http://127.0.0.1:{port}/json").read())
                pg=[t for t in tabs if t["type"]=="page"]
                if pg: ws=pg[0]["webSocketDebuggerUrl"]; break
            except Exception: pass
            time.sleep(0.4)
        c=CDP(ws); c.send("Page.enable")
        c.send("Page.navigate", url="file://"+os.path.abspath(html_path))
        time.sleep(1.5)
        # wait until every embedded image has decoded, else rows print blank
        for _ in range(120):
            r=c.send("Runtime.evaluate", expression=
                "(()=>{const i=[...document.images];"
                "return i.length? i.filter(x=>x.complete).length/i.length : 1})()",
                returnByValue=True)
            if (r.get("result",{}).get("value") or 0) >= 1: break
            time.sleep(1.0)
        time.sleep(2.0)
        # Orientation comes from the CSS @page rule only. Passing landscape=True
        # as well makes Chromium handle the rotation twice, which leaves some
        # rasterisers drawing the RTL runs unshaped and reversed.
        res=c.send("Page.printToPDF", printBackground=True, landscape=False,
                   preferCSSPageSize=True, displayHeaderFooter=True,
                   headerTemplate="<div></div>", footerTemplate=FOOTER,
                   transferMode="ReturnAsBase64")
        open(pdf_path,"wb").write(base64.b64decode(res["data"]))
    finally:
        proc.terminate()


if __name__ == "__main__":
    for internal, hname, pname in [
        (False, "_print_buyers.html",   "BELA-Catalog-BUYERS.pdf"),
        (True,  "_print_internal.html", "BELA-Inventory-INTERNAL.pdf")]:
        items = load(drop_empty=not internal)
        open(hname,"w",encoding="utf-8").write(build_html(items, internal))
        render(hname, pname, landscape=internal)
        print(f"{pname:34} {len(items):>5} items  {os.path.getsize(pname)/1024/1024:.1f} MB")
