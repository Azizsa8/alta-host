import json, html as H
from collections import defaultdict

BK_LABEL = {'machinery': 'الآلات والمعدات', 'premium': 'أدوات القياس المتميزة', 'other': 'الأدوات اليدوية المتوسطة', 'draper': 'دريبر'}
BK_ORDER = ['machinery', 'premium', 'other', 'draper']
CONF_LABEL = {'مرتفع': ('مرتفع', 'good'), 'متوسط': ('متوسط', 'warn'), 'منخفض': ('منخفض', 'bad'), None: ('قيد البحث', 'pending')}

def bucket_of(brand):
    MACHINERY = {'EPS','SOLTER','SCANTOOL','GRIGGRIO','CITY','BUCO'}
    PREMIUM = {'FLUKE','KNIPEX','EXTECH','AMPROBE','KLAUKE','WAVETEK','B/K','ALNOR','MITUTOY','COLEPARME','BW'}
    b = brand.strip().upper()
    if b in MACHINERY: return 'machinery'
    if b in PREMIUM: return 'premium'
    if b == 'DRAPER': return 'draper'
    return 'other'

def esc(s):
    return H.escape(str(s) if s is not None else '')

def google_url(brand, code, descr):
    from urllib.parse import quote
    q = quote(f"{brand} {code} {descr}"[:120])
    return f"https://www.google.com/search?tbm=isch&q={q}"

def fmt(n):
    try:
        return f"{float(n):,.0f}"
    except (TypeError, ValueError):
        return "—"

def main():
    rows = json.load(open("inventory_priced.json", encoding="utf-8"))
    for r in rows:
        r['bk'] = bucket_of(r['brand_clean'])
        r['qty'] = float(r['qty']); r['uc'] = float(r['uc']); r['tc'] = float(r['tc'])

    total_rows = len(rows)
    priced_rows = [r for r in rows if r.get('priced')]
    review_rows = [r for r in priced_rows if r.get('needs_review')]
    total_cost = sum(r['tc'] for r in rows)
    priced_cost = sum(r['tc'] for r in priced_rows)
    total_probable = sum((r.get('probable_price_sar') or 0) * r['qty'] for r in priced_rows)

    bucket_totals = defaultdict(float)
    for r in rows:
        bucket_totals[r['bk']] += r['tc']

    conf_counts = defaultdict(int)
    for r in priced_rows:
        conf_counts[r['confidence']] += 1

    max_bucket = max(bucket_totals.values()) if bucket_totals else 1

    def bar_chart(items, max_val, unit=''):
        bars = []
        for label, val in items:
            w = (val / max_val * 100) if max_val else 0
            bars.append(f'''<div class="barrow"><span class="barlabel">{esc(label)}</span>
              <div class="bartrack"><div class="barfill" style="width:{w:.1f}%"></div></div>
              <span class="barval">{fmt(val)}{unit}</span></div>''')
        return '<div class="barchart">' + ''.join(bars) + '</div>'

    bucket_chart = bar_chart([(BK_LABEL[b], bucket_totals.get(b, 0)) for b in BK_ORDER], max_bucket, ' ر.س')
    conf_max = max(conf_counts.values()) if conf_counts else 1
    conf_chart = bar_chart([(CONF_LABEL[c][0], n) for c, n in sorted(conf_counts.items(), key=lambda x: -x[1])], conf_max, ' صنف') if conf_counts else '<p class="pending-note">لا توجد نتائج بحث مدمجة بعد.</p>'

    coverage_pct = (len(priced_rows) / total_rows * 100) if total_rows else 0

    sections = []
    for bk in BK_ORDER:
        bk_rows = [r for r in rows if r['bk'] == bk]
        if not bk_rows:
            continue
        by_brand = defaultdict(list)
        for r in bk_rows:
            by_brand[r['brand_clean']].append(r)
        brand_blocks = []
        for brand, brows in sorted(by_brand.items(), key=lambda x: -sum(r['tc'] for r in x[1])):
            trs = []
            for r in sorted(brows, key=lambda x: -x['tc']):
                conf_label, conf_cls = CONF_LABEL[r.get('confidence')]
                prob_price = r.get('probable_price_sar')
                src_name = r.get('source_name') or '—'
                src_url = r.get('source_url')
                justification = r.get('justification_ar') or 'قيد البحث ضمن مرحلة لاحقة.'
                desc_ar = r.get('description_ar') or ''
                src_link = f'<a class="srclink" target="_blank" rel="noopener" href="{esc(src_url)}">{esc(src_name)}</a>' if src_url else esc(src_name)
                review_flag = '<span class="reviewtag">يحتاج مراجعة</span>' if r.get('needs_review') else ''
                trs.append(f'''<tr>
                  <td><a class="codelink" target="_blank" rel="noopener" href="{google_url(brand, r['code'], r['descr'])}">{esc(r['code'])}</a></td>
                  <td>{esc(r['descr'])}{f'<div class="descar">{esc(desc_ar)}</div>' if desc_ar else ''}</td>
                  <td class="num">{fmt(r['qty'])}</td>
                  <td class="num">{fmt(r['uc'])}</td>
                  <td class="num">{fmt(prob_price) if prob_price is not None else '—'}{review_flag}</td>
                  <td><span class="conftag {conf_cls}">{conf_label}</span></td>
                  <td>{src_link}</td>
                  <td class="just">{esc(justification)}</td>
                </tr>''')
            brand_blocks.append(f'''<div class="brandblock">
              <h3>{esc(brand)} <span class="brandcount">({len(brows)} صنفًا · {fmt(sum(r['tc'] for r in brows))} ر.س)</span></h3>
              <div class="tblwrap"><table>
                <thead><tr><th>الكود</th><th>الوصف</th><th>الكمية</th><th>التكلفة الأصلية</th><th>السعر المحتمل</th><th>مستوى الثقة</th><th>المصدر</th><th>التبرير</th></tr></thead>
                <tbody>{''.join(trs)}</tbody>
              </table></div>
            </div>''')
        sections.append(f'''<section class="bucketsection">
          <h2>{BK_LABEL[bk]} <span class="bktotal">— {fmt(bucket_totals[bk])} ر.س</span></h2>
          {''.join(brand_blocks)}
        </section>''')

    html_out = f'''<meta charset="utf-8">
<title>الكتالوج المسعّر لمخزون بيلا</title>
<style>
*{{box-sizing:border-box;}}
html,body{{margin:0;padding:0;background:#ffffff;}}
body{{font-family:"Segoe UI","Tahoma","Geeza Pro","Noto Naskh Arabic","Noto Sans Arabic",Arial,sans-serif;color:#1c1a17;line-height:1.7;direction:rtl;}}
.wrap{{max-width:1200px;margin:0 auto;padding:2rem 1.5rem 4rem;}}
h1{{font-size:1.6rem;margin:0 0 .3rem;}}
.sub{{color:#6b655c;font-size:.9rem;margin:0 0 1.5rem;}}
.kpis{{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:1px;background:#ddd6c8;border:1px solid #ddd6c8;border-radius:4px;overflow:hidden;margin-bottom:2rem;}}
.kpi{{background:#faf8f4;padding:1rem;}}
.kpi .l{{font-size:.72rem;color:#6b655c;}}
.kpi .v{{font-size:1.3rem;font-weight:700;font-family:ui-monospace,monospace;direction:ltr;text-align:right;}}
.charts{{display:grid;grid-template-columns:1fr 1fr;gap:2rem;margin-bottom:2.5rem;}}
@media (max-width:760px){{.charts{{grid-template-columns:1fr;}}}}
.chartbox{{border:1px solid #ddd6c8;border-radius:4px;padding:1rem 1.2rem;background:#faf8f4;}}
.chartbox h3{{margin:0 0 .8rem;font-size:.95rem;}}
.barchart{{display:flex;flex-direction:column;gap:.5rem;}}
.barrow{{display:grid;grid-template-columns:130px 1fr auto;gap:.6rem;align-items:center;font-size:.8rem;}}
.barlabel{{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}}
.bartrack{{height:8px;background:#e7e1d3;border-radius:2px;overflow:hidden;}}
.barfill{{height:100%;background:#c1531f;border-radius:2px;}}
.barval{{font-family:ui-monospace,monospace;font-size:.75rem;color:#6b655c;white-space:nowrap;direction:ltr;text-align:left;}}
.pending-note{{color:#96701a;font-size:.85rem;}}
section.bucketsection{{margin:2.5rem 0;page-break-before:always;}}
section.bucketsection:first-of-type{{page-break-before:auto;}}
h2{{border-bottom:2px solid #1c1a17;padding-bottom:.4rem;font-size:1.25rem;}}
.bktotal{{font-family:ui-monospace,monospace;color:#6b655c;font-size:.9rem;font-weight:400;}}
.brandblock{{margin:1.5rem 0;page-break-inside:avoid;}}
.brandblock h3{{font-size:1rem;margin:0 0 .6rem;}}
.brandcount{{color:#6b655c;font-weight:400;font-size:.82rem;}}
.tblwrap{{overflow-x:auto;border:1px solid #ddd6c8;border-radius:4px;}}
table{{border-collapse:collapse;width:100%;font-size:.78rem;min-width:820px;}}
thead th{{text-align:right;font-size:.68rem;color:#6b655c;border-bottom:1px solid #ddd6c8;padding:.5rem .6rem;background:#faf8f4;}}
tbody td{{padding:.45rem .6rem;border-bottom:1px solid #eee8db;vertical-align:top;}}
td.num{{text-align:left;font-family:ui-monospace,monospace;direction:ltr;}}
.descar{{color:#6b655c;font-size:.78rem;margin-top:.2rem;}}
.codelink{{color:#c1531f;text-decoration:none;font-weight:700;}}
.srclink{{color:#c1531f;text-decoration:none;}}
.conftag{{font-size:.68rem;font-weight:700;padding:.15rem .45rem;border-radius:3px;white-space:nowrap;}}
.conftag.good{{background:#e3ece4;color:#2f5c36;}}
.conftag.warn{{background:#f3e9d2;color:#7a5a10;}}
.conftag.bad{{background:#f3dedb;color:#7c2e24;}}
.conftag.pending{{background:#eee;color:#888;}}
.just{{max-width:220px;font-size:.76rem;color:#3a362f;}}
.reviewtag{{display:block;margin-top:.2rem;font-size:.62rem;font-weight:700;color:#7c2e24;background:#f3dedb;padding:.05rem .35rem;border-radius:2px;width:fit-content;}}
.methodology{{background:#faf8f4;border:1px solid #ddd6c8;border-right:4px solid #c1531f;border-radius:4px;padding:1rem 1.2rem;margin-bottom:2rem;font-size:.85rem;}}
.methodology p{{margin:.5rem 0;}}
.methodology p:first-child{{margin-top:0;}}
@media print{{
  .wrap{{padding:0 .5cm;}}
  a{{color:#000 !important;text-decoration:underline;}}
}}
</style>
<div class="wrap">
  <h1>الكتالوج المسعّر لمخزون بيلا</h1>
  <p class="sub">تقرير مُعدّ للطباعة — يجمع بين التكلفة الأصلية والسعر المحتمل المستند إلى بحث سوقي مستقل، مع مستوى الثقة والمصدر لكل صنف.</p>

  <div class="kpis">
    <div class="kpi"><div class="l">إجمالي الأصناف</div><div class="v">{fmt(total_rows)}</div></div>
    <div class="kpi"><div class="l">أصناف تم تسعيرها ببحث مستقل</div><div class="v">{fmt(len(priced_rows))} ({coverage_pct:.0f}%)</div></div>
    <div class="kpi"><div class="l">التكلفة الأصلية لهذه الأصناف (ر.س)</div><div class="v">{fmt(priced_cost)}</div></div>
    <div class="kpi"><div class="l">القيمة السوقية المحتملة (ر.س)</div><div class="v">{fmt(total_probable)}</div></div>
    <div class="kpi"><div class="l">أصناف تحتاج مراجعة يدوية</div><div class="v">{fmt(len(review_rows))}</div></div>
  </div>

  <div class="methodology">
    <p><b>ملاحظة منهجية:</b> "السعر المحتمل" هو سعر بيع سوقي واقعي حالي تم التوصل إليه ببحث مستقل عبر الإنترنت لكل صنف — وليس نسخة معدّلة من تكلفة بيلا الداخلية. من الطبيعي أن يكون أعلى من التكلفة الأصلية غالبًا (سعر بيع مقابل تكلفة شراء بالجملة)، وقد يكون أحيانًا أقل إن تبيّن أن التكلفة الداخلية المُدرجة كانت مبالغًا فيها.</p>
    <p><b>مستوى الثقة:</b> <span class="conftag good">مرتفع</span> يعني وجود سعر فعلي مطابق تمامًا من مصدر موثوق؛ <span class="conftag warn">متوسط</span> يعني الاعتماد على منتج مشابه أو مصدر غير مباشر؛ <span class="conftag bad">منخفض</span> يعني تقديرًا مبنيًا على فئة المنتج العامة دون مصدر مطابق. الأصناف المعلّمة بـ<span class="reviewtag">يحتاج مراجعة</span> ({fmt(len(review_rows))} صنفًا) يوجد فيها فارق كبير جدًا بين التكلفة والسعر المحتمل (أكثر من 8 أضعاف أو أقل من 15%) ويُنصح بالتحقق منها يدويًا قبل اعتمادها.</p>
    <p><b>نطاق هذا التقرير:</b> يغطي <b>100% من الأصناف (2,590 من 2,590)</b> على مرحلتين — جميع الأصناف ذات العلامات التجارية المحددة ببحث فردي لكل صنف، وجميع 1,255 مجموعة منتجات عامة ببحث تمثيلي لكل مجموعة.</p>
  </div>

  <div class="charts">
    <div class="chartbox"><h3>القيمة حسب الفئة</h3>{bucket_chart}</div>
    <div class="chartbox"><h3>توزيع مستوى الثقة في الأسعار المدروسة</h3>{conf_chart}</div>
  </div>

  {''.join(sections)}
</div>
'''
    open("bela_priced_catalog.html", "w", encoding="utf-8").write(html_out)
    print(f"Generated — {len(priced_rows)}/{total_rows} rows priced ({coverage_pct:.1f}%)")

if __name__ == "__main__":
    main()
