"""Build the BELA inventory workbook.

Two files, deliberately separated so pricing can never leak to a buyer:
  BELA-Inventory-INTERNAL.xlsx  full data: cost, researched price, confidence, sources
  BELA-Catalog-BUYERS.xlsx      no pricing at all — safe to send out
"""
import json, io, base64, re
from collections import defaultdict
import xlsxwriter
from PIL import Image

CAT = {'machinery':'الآلات والمعدات','premium':'أجهزة القياس والفحص',
       'other':'العدد والأدوات اليدوية','draper':'أدوات دريبر'}
CAT_ORDER = ['machinery','premium','other','draper']
COO_AR = {'GERMANY':'ألمانيا','USA':'الولايات المتحدة','UK':'المملكة المتحدة','SPAIN':'إسبانيا',
          'ITALY':'إيطاليا','AUSTRIA':'النمسا','JAPAN':'اليابان','SWEDEN':'السويد',
          'DENMARK':'الدنمارك','TW':'تايوان'}
UOM_AR = {'EA':'حبة','PKT':'باكيت','SET':'طقم','KIT':'طقم','PC':'قطعة','PCS':'قطعة',
          'ROLL':'لفة','BOX':'علبة','PAIR':'زوج','MTR':'متر','M':'متر'}
AR_RUN = re.compile(r'[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]+')

ROW_H   = 46          # points
IMG_PX  = 56          # target image height in pixels
PALETTE = {'ink':'#15181C','accent':'#1F5673','soft':'#E8EFF3','line':'#D8DEE4',
           'amber':'#9A5518','amberbg':'#FDF3E9','good':'#2F5C36','goodbg':'#E3ECE4',
           'warn':'#7A5A10','warnbg':'#F3E9D2','bad':'#7C2E24','badbg':'#F3DEDB',
           'zebra':'#FAFBFC'}


def clean_spec(d):
    s = AR_RUN.sub(' ', d)
    s = re.sub(r'\s+', ' ', s)
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


def gs_link(b, c, t):
    from urllib.parse import quote
    return "https://www.google.com/search?tbm=isch&q=" + quote(f"{b} {c} {t}"[:100])


def load():
    rows = json.load(open("inventory_full.json", encoding="utf-8"))
    imgs = json.load(open("image_data.json", encoding="utf-8"))
    out = []
    for r in rows:
        q = float(r['qty'])
        brand = (r['brand_clean'] or '').strip()
        uom = (r.get('uom') or '').strip().upper()
        out.append({
            'code': (r['code'] or '').strip(),
            'brand': brand,
            'spec': clean_spec(re.sub(r'\s+',' ', r['descr'] or '').strip()),
            'desc': (r.get('description_ar_rich') or r.get('description_ar') or '').strip(),
            'qty': int(q),
            'uom': UOM_AR.get(uom, uom.title() if uom else 'وحدة'),
            'origin': COO_AR.get(r.get('coo_clean') or '', 'غير محدد'),
            'cat': CAT[bucket_of(brand)],
            'catid': bucket_of(brand),
            'cost': float(r['uc']),
            'total_cost': float(r['tc']),
            'price': r.get('probable_price_sar'),
            'conf': r.get('confidence') or '',
            'src': r.get('source_name') or '',
            'srcurl': r.get('source_url') or '',
            'why': r.get('justification_ar') or '',
            'review': bool(r.get('needs_review')),
            'page': r.get('page'),
            'img': imgs.get(r.get('image_url'), ''),
        })
    out.sort(key=lambda x: (CAT_ORDER.index(x['catid']), x['brand'], -x['qty']))
    return out


_img_cache = {}
def thumb(data_uri):
    """Decode the stored data URI once and re-scale for a spreadsheet row."""
    if not data_uri:
        return None
    if data_uri in _img_cache:
        return _img_cache[data_uri]
    try:
        raw = base64.b64decode(data_uri.split(',', 1)[1])
        im = Image.open(io.BytesIO(raw)); im.load()
        im.thumbnail((IMG_PX, IMG_PX), Image.LANCZOS)
        buf = io.BytesIO(); im.convert('RGB').save(buf, 'JPEG', quality=70)
        buf.seek(0)
        _img_cache[data_uri] = (buf.getvalue(), im.size)
        return _img_cache[data_uri]
    except Exception:
        return None


def fmts(wb):
    base = {'font_name':'Segoe UI','font_size':10,'valign':'vcenter','border':1,
            'border_color':PALETTE['line']}
    f = {}
    f['hdr'] = wb.add_format({**base,'bold':True,'font_size':10,'bg_color':PALETTE['accent'],
                              'font_color':'white','align':'center','text_wrap':True,'border_color':PALETTE['accent']})
    f['txt'] = wb.add_format({**base,'text_wrap':True,'align':'right'})
    f['desc']= wb.add_format({**base,'text_wrap':True,'align':'right','font_size':9})
    f['mono']= wb.add_format({**base,'font_name':'Consolas','align':'left'})
    f['ctr'] = wb.add_format({**base,'align':'center'})
    f['qty'] = wb.add_format({**base,'align':'center','bold':True,'font_size':11,
                              'font_color':PALETTE['amber'],'bg_color':PALETTE['amberbg'],
                              'num_format':'#,##0'})
    f['money']= wb.add_format({**base,'align':'left','num_format':'#,##0 "ر.س"'})
    f['money_b']= wb.add_format({**base,'align':'left','num_format':'#,##0 "ر.س"','bold':True})
    f['link']= wb.add_format({**base,'font_color':PALETTE['accent'],'underline':1,'align':'center','font_size':9})
    f['img'] = wb.add_format({**base,'align':'center'})
    f['good']= wb.add_format({**base,'align':'center','bg_color':PALETTE['goodbg'],'font_color':PALETTE['good'],'bold':True})
    f['warn']= wb.add_format({**base,'align':'center','bg_color':PALETTE['warnbg'],'font_color':PALETTE['warn'],'bold':True})
    f['bad'] = wb.add_format({**base,'align':'center','bg_color':PALETTE['badbg'],'font_color':PALETTE['bad'],'bold':True})
    f['title']=wb.add_format({'font_name':'Segoe UI','font_size':18,'bold':True,'font_color':PALETTE['ink']})
    f['sub']  =wb.add_format({'font_name':'Segoe UI','font_size':10,'font_color':'#5F6873'})
    f['kpi']  =wb.add_format({'font_name':'Segoe UI','font_size':20,'bold':True,
                              'font_color':PALETTE['accent'],'align':'center','valign':'vcenter',
                              'bg_color':PALETTE['soft'],'border':1,'border_color':PALETTE['line'],
                              'num_format':'#,##0'})
    f['kpil'] =wb.add_format({'font_name':'Segoe UI','font_size':9,'font_color':'#5F6873',
                              'align':'center','valign':'vcenter','bg_color':PALETTE['soft'],
                              'border':1,'border_color':PALETTE['line']})
    f['sec']  =wb.add_format({'font_name':'Segoe UI','font_size':12,'bold':True,'font_color':PALETTE['accent']})
    f['note'] =wb.add_format({'font_name':'Segoe UI','font_size':9,'font_color':'#7A5A10',
                              'bg_color':'#FDF6E6','text_wrap':True,'valign':'top','border':1,
                              'border_color':'#EBD9AE'})
    return f


def write_items(wb, f, items, name, internal):
    ws = wb.add_worksheet(name)
    ws.right_to_left()
    ws.set_zoom(100)

    cols = [('الصورة',10),('كود الصنف',16),('العلامة التجارية',15),('المواصفة الفنية',26),
            ('الوصف والاستخدام',62),('الكمية',9),('الوحدة',9),('بلد المنشأ',13),('الفئة',18),
            ('بحث بالصور',11)]
    if internal:
        cols += [('تكلفة الوحدة',13),('إجمالي التكلفة',15),('السعر المحتمل',14),
                 ('مستوى الثقة',12),('المصدر',26),('رابط المصدر',11),
                 ('تبرير السعر',52),('مراجعة؟',10),('صفحة PDF',9)]

    for i,(t,w) in enumerate(cols):
        ws.set_column(i,i,w)
    ws.set_row(0, 34)
    for i,(t,_) in enumerate(cols):
        ws.write(0,i,t,f['hdr'])
    ws.freeze_panes(1,0)
    ws.autofilter(0,0,len(items),len(cols)-1)
    ws.set_default_row(ROW_H)

    conf_fmt={'مرتفع':f['good'],'متوسط':f['warn'],'منخفض':f['bad']}
    imgs_placed=0
    for r,it in enumerate(items, start=1):
        ws.set_row(r, ROW_H)
        th = thumb(it['img'])
        if th:
            data,(iw,ih) = th
            ws.insert_image(r,0,'p.jpg',{'image_data':io.BytesIO(data),
                'x_offset':max(2,(70-iw)//2),'y_offset':max(1,(int(ROW_H*4/3)-ih)//2),
                'object_position':1})
            imgs_placed+=1
        else:
            ws.write(r,0,'—',f['ctr'])
        ws.write(r,1,it['code'],f['mono'])
        ws.write(r,2,it['brand'],f['txt'])
        ws.write(r,3,it['spec'],f['mono'])
        ws.write(r,4,it['desc'],f['desc'])
        ws.write_number(r,5,it['qty'],f['qty'])
        ws.write(r,6,it['uom'],f['ctr'])
        ws.write(r,7,it['origin'],f['ctr'])
        ws.write(r,8,it['cat'],f['txt'])
        ws.write_url(r,9,gs_link(it['brand'],it['code'],it['spec']),f['link'],'صور ↗')
        if internal:
            ws.write_number(r,10,it['cost'],f['money'])
            ws.write_number(r,11,it['total_cost'],f['money'])
            if it['price'] is not None:
                ws.write_number(r,12,it['price'],f['money_b'])
            else:
                ws.write(r,12,'—',f['ctr'])
            ws.write(r,13,it['conf'],conf_fmt.get(it['conf'],f['ctr']))
            ws.write(r,14,it['src'],f['desc'])
            if it['srcurl'].startswith('http'):
                ws.write_url(r,15,it['srcurl'],f['link'],'المصدر ↗')
            else:
                ws.write(r,15,'—',f['ctr'])
            ws.write(r,16,it['why'],f['desc'])
            ws.write(r,17,'نعم' if it['review'] else '',
                     f['bad'] if it['review'] else f['ctr'])
            ws.write(r,18,it['page'],f['ctr'])

    last=len(items)
    # visual weight on quantity, so stock depth reads at a glance
    ws.conditional_format(1,5,last,5,{'type':'data_bar','bar_color':'#D9A066',
                                      'bar_solid':True,'bar_only':False})
    if internal:
        ws.conditional_format(1,17,last,17,{'type':'cell','criteria':'==',
                                            'value':'"نعم"','format':f['bad']})
    ws.print_area(0,0,last,len(cols)-1)
    ws.repeat_rows(0)
    ws.fit_to_pages(1,0)
    ws.set_landscape()
    return ws, imgs_placed


def write_dashboard(wb, f, items, internal):
    ws = wb.add_worksheet('لوحة المعلومات')
    ws.right_to_left()
    ws.hide_gridlines(2)
    ws.set_column(0,0,3)
    for c in range(1,9): ws.set_column(c,c,15)

    ws.write(1,1,'مخزون بيلا — عدد وأدوات ومعدات صناعية',f['title'])
    ws.write(2,1,'ملف داخلي: يحتوي على التكاليف والأسعار المدروسة' if internal
                  else 'نسخة العملاء: لا تحتوي على أي أسعار',f['sub'])

    total=len(items); units=sum(i['qty'] for i in items)
    brands=len({i['brand'] for i in items if i['brand']})
    photos=sum(1 for i in items if i['img'])
    kpis=[('عدد الأصناف',total),('إجمالي الوحدات',units),
          ('العلامات التجارية',brands),('أصناف بصورة',photos)]
    if internal:
        kpis.append(('إجمالي التكلفة (ر.س)',round(sum(i['total_cost'] for i in items))))
        kpis.append(('القيمة السوقية المقدرة (ر.س)',
                     round(sum((i['price'] or 0)*i['qty'] for i in items))))
    r0=4
    for n,(lab,val) in enumerate(kpis):
        c=1+n
        ws.set_row(r0,30); ws.set_row(r0+1,16)
        ws.write_number(r0,c,val,f['kpi'])
        ws.write(r0+1,c,lab,f['kpil'])

    # ---- data blocks the charts read from -------------------------------
    cs=defaultdict(lambda:{'n':0,'u':0,'cost':0.0,'val':0.0})
    for i in items:
        d=cs[i['cat']]; d['n']+=1; d['u']+=i['qty']
        d['cost']+=i['total_cost']; d['val']+=(i['price'] or 0)*i['qty']
    bs=defaultdict(lambda:{'n':0,'u':0,'cost':0.0})
    for i in items:
        if i['brand']:
            d=bs[i['brand']]; d['n']+=1; d['u']+=i['qty']; d['cost']+=i['total_cost']
    top=sorted(bs.items(), key=lambda x:-x[1]['n'])[:10]
    os_=defaultdict(int)
    for i in items: os_[i['origin']]+=1
    origins=sorted(os_.items(), key=lambda x:-x[1])[:8]

    ws.write(8,1,'التوزيع حسب الفئة',f['sec'])
    ws.write_row(9,1,['الفئة','عدد الأصناف','الوحدات'],f['hdr'])
    for n,(k,v) in enumerate(cs.items()):
        ws.write(10+n,1,k,f['txt']); ws.write_number(10+n,2,v['n'],f['ctr'])
        ws.write_number(10+n,3,v['u'],f['ctr'])
    cat_end=10+len(cs)-1

    ws.write(16,1,'أكبر 10 علامات تجارية',f['sec'])
    ws.write_row(17,1,['العلامة','عدد الأصناف'],f['hdr'])
    for n,(k,v) in enumerate(top):
        ws.write(18+n,1,k,f['txt']); ws.write_number(18+n,2,v['n'],f['ctr'])
    brand_end=18+len(top)-1

    ws.write(30,1,'بلد المنشأ',f['sec'])
    ws.write_row(31,1,['البلد','عدد الأصناف'],f['hdr'])
    for n,(k,v) in enumerate(origins):
        ws.write(32+n,1,k,f['txt']); ws.write_number(32+n,2,v,f['ctr'])
    o_end=32+len(origins)-1

    sh="'لوحة المعلومات'"
    c1=wb.add_chart({'type':'column'})
    c1.add_series({'name':'عدد الأصناف',
        'categories':f"={sh}!$B$11:$B${cat_end+1}",
        'values':f"={sh}!$C$11:$C${cat_end+1}",
        'fill':{'color':PALETTE['accent']},'data_labels':{'value':True}})
    c1.set_title({'name':'الأصناف حسب الفئة'}); c1.set_legend({'none':True})
    c1.set_size({'width':430,'height':260})
    ws.insert_chart(8,5,c1)

    c2=wb.add_chart({'type':'bar'})
    c2.add_series({'name':'عدد الأصناف',
        'categories':f"={sh}!$B$19:$B${brand_end+1}",
        'values':f"={sh}!$C$19:$C${brand_end+1}",
        'fill':{'color':'#B5651D'},'data_labels':{'value':True}})
    c2.set_title({'name':'أكبر 10 علامات تجارية'}); c2.set_legend({'none':True})
    c2.set_size({'width':430,'height':300})
    ws.insert_chart(22,5,c2)

    c3=wb.add_chart({'type':'pie'})
    c3.add_series({'name':'بلد المنشأ',
        'categories':f"={sh}!$B$33:$B${o_end+1}",
        'values':f"={sh}!$C$33:$C${o_end+1}",
        'data_labels':{'percentage':True}})
    c3.set_title({'name':'التوزيع حسب بلد المنشأ'})
    c3.set_size({'width':430,'height':300})
    ws.insert_chart(30,5,c3)

    if internal:
        conf=defaultdict(int)
        for i in items: conf[i['conf'] or 'غير مسعّر']+=1
        ws.write(43,1,'مستوى الثقة في الأسعار',f['sec'])
        ws.write_row(44,1,['المستوى','عدد الأصناف'],f['hdr'])
        for n,(k,v) in enumerate(sorted(conf.items(), key=lambda x:-x[1])):
            ws.write(45+n,1,k,f['txt']); ws.write_number(45+n,2,v,f['ctr'])
        cend=45+len(conf)-1
        c4=wb.add_chart({'type':'doughnut'})
        c4.add_series({'name':'مستوى الثقة',
            'categories':f"={sh}!$B$46:$B${cend+1}",
            'values':f"={sh}!$C$46:$C${cend+1}",
            'points':[{'fill':{'color':'#C0392B'}},{'fill':{'color':'#D9A066'}},
                      {'fill':{'color':'#4B7A51'}},{'fill':{'color':'#999999'}}],
            'data_labels':{'percentage':True}})
        c4.set_title({'name':'مستوى الثقة في الأسعار المدروسة'})
        c4.set_size({'width':430,'height':280})
        ws.insert_chart(43,5,c4)

        ws.merge_range(53,1,56,8,
            'ملاحظة: "السعر المحتمل" هو سعر سوقي مُقدَّر من بحث مستقل لكل صنف، وليس عرض سعر '
            'نهائي. الأصناف المعلّمة "نعم" في عمود المراجعة يوجد فيها فارق كبير بين التكلفة '
            'والسعر المقدّر ويُنصح بمراجعتها يدويًا. العملة مفترضة بالريال السعودي — الملف '
            'المصدر لا يذكر العملة صراحةً.', f['note'])
    else:
        ws.merge_range(43,1,45,8,
            'هذه النسخة مخصّصة للعملاء ولا تحتوي على أي بيانات أسعار أو تكاليف. '
            'الكميات تعكس المخزون وقت الإصدار. الصور استرشادية لتوضيح نوع المنتج.', f['note'])
    ws.set_first_sheet(); ws.activate()
    return ws


def summaries(wb, f, items):
    ws=wb.add_worksheet('ملخص العلامات'); ws.right_to_left()
    ws.set_column(0,0,24); ws.set_column(1,5,16)
    heads=['العلامة التجارية','عدد الأصناف','إجمالي الوحدات','إجمالي التكلفة',
           'القيمة السوقية المقدرة','الفرق']
    ws.set_row(0,28)
    for i,h in enumerate(heads): ws.write(0,i,h,f['hdr'])
    ws.freeze_panes(1,0)
    b=defaultdict(lambda:{'n':0,'u':0,'c':0.0,'v':0.0})
    for i in items:
        if not i['brand']: continue
        d=b[i['brand']]; d['n']+=1; d['u']+=i['qty']; d['c']+=i['total_cost']
        d['v']+=(i['price'] or 0)*i['qty']
    for r,(k,v) in enumerate(sorted(b.items(), key=lambda x:-x[1]['c']), start=1):
        ws.write(r,0,k,f['txt']); ws.write_number(r,1,v['n'],f['ctr'])
        ws.write_number(r,2,v['u'],f['ctr']); ws.write_number(r,3,v['c'],f['money'])
        ws.write_number(r,4,v['v'],f['money']); ws.write_number(r,5,v['v']-v['c'],f['money'])
    ws.autofilter(0,0,len(b),5)
    ws.conditional_format(1,3,len(b),3,{'type':'3_color_scale'})
    return ws


def build(path, internal):
    items = load()
    if not internal:
        items = [i for i in items if i['qty'] > 0]
    wb = xlsxwriter.Workbook(path, {'constant_memory': False, 'strings_to_urls': False})
    wb.set_properties({'title':'مخزون بيلا — عدد وأدوات ومعدات',
                       'subject':'قائمة المخزون', 'company':'BELA',
                       'comments':'داخلي — يحتوي أسعار' if internal else 'نسخة العملاء — بدون أسعار'})
    f = fmts(wb)
    write_dashboard(wb, f, items, internal)
    _, placed = write_items(wb, f, items,
                            'القائمة الكاملة' if internal else 'قائمة المعروضات', internal)
    if internal:
        summaries(wb, f, items)
    wb.close()
    return len(items), placed


if __name__ == "__main__":
    import os
    for path, internal in [("BELA-Inventory-INTERNAL.xlsx", True),
                           ("BELA-Catalog-BUYERS.xlsx", False)]:
        n, p = build(path, internal)
        mb = os.path.getsize(path)/1024/1024
        print(f"{path:32} rows {n:>5}  images {p:>5}  {mb:.1f} MB")
