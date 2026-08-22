"""Derive a short Arabic product NAME from the researched description.

Descriptions open with what the product is, then pivot to its use
("يستخدمه ...", "تُستخدم ل..."). Cutting at that hinge yields a clean
catalogue name without inventing anything.
"""
import json, re

# Connectors must start a WORD, otherwise a pattern like "وي" matches inside
# ordinary words (e.g. the وي in طويل) and truncates the name mid-word.
USE = re.compile(
    r'(?:^|(?<=[\s،.؛]))(?:'
    r'يستخدم\w*|يُستخدم\w*|تستخدم\w*|تُستخدم\w*|'
    r'يستعمل\w*|يُستعمل\w*|تستعمل\w*|تُستعمل\w*|'
    r'للاستخدام|مخصص\w*|مصمم\w*|مصمّم\w*|'
    r'وي(?:ستخدم|ُستخدم)\w*|وت(?:ستخدم|ُستخدم)\w*|'
    r'وهي\b|وهو\b'
    r')')

def name_from(desc, fallback):
    if not desc:
        return fallback
    s = re.sub(r'\s+', ' ', desc).strip()
    m = USE.search(s)
    if m and m.start() > 8:
        s = s[:m.start()]
    s = s.strip(' ،.؛-')
    if len(s) > 72:
        head = re.split(r'[،؛.]', s)[0].strip()
        s = head if 12 <= len(head) <= 72 else s
    if len(s) > 72:
        s = s[:72].rsplit(' ', 1)[0]
    s = s.strip(' ،.؛-')
    # a name should not end on a dangling connector
    s = re.sub(r'\s+(?:أو|و|من|على|في|مع|إلى|عن|ذات|ذو)$', '', s).strip(' ،.؛-')
    return s or fallback

if __name__ == "__main__":
    rows = json.load(open('inventory_full.json', encoding='utf-8'))
    names = [name_from((r.get('description_ar_rich') or r.get('description_ar') or '').strip(),
                       (r['code'] or '').strip()) for r in rows]
    lens=[len(n) for n in names]
    print(f"names {len(names)}  avg {sum(lens)/len(lens):.0f}  max {max(lens)}  short(<8) {sum(1 for n in names if len(n)<8)}")
    # a name must not end mid-word: last token should also appear in the source
    bad=0
    for r,n in zip(rows,names):
        src=(r.get('description_ar_rich') or '')
        if n and src and not src.startswith(n[:12]): bad+=1
    print(f"names not matching start of description: {bad}")
    print()
    for i in [0,1,2,3,4,400,900,1500,2100,2500,2589]:
        print("  "+names[i])
