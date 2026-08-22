# BELA Buyer Catalog — Deployment

## Live URL
https://brilliant-baklava-fe0183.netlify.app

## Passwords (two layers)
1. Netlify drop password: `My-Drop-Site`   — temporary; remove after claiming
2. Catalog password:      `BELA226$`       — yours; actually decrypts the data

## CLAIM WITHIN 60 MINUTES or Netlify deletes the site
https://app.netlify.com/drop/brilliant-baklava-fe0183#drop_token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpYXQiOjE3ODYyODY1MjcsImV4cCI6MTc4NjI5MDEyNywiaXNzIjoiTmV0bGlmeSIsInNlc3Npb25faWQiOiJkMjViNDliMC0xMGU2LTQzMzMtODM4YS0yMzMwYWZkZmQ2NzEifQ.5H56W3JfkfPXwBgMgkZWO063I8t22cvdtygrOFR9qm8

Then: Site settings -> Access & security -> Visitor access -> remove site password,
so buyers only need BELA226$.

## Rebuild + redeploy
    cd .bela_pricing_work
    CATALOG_PASSPHRASE='BELA226$' python3 build_all.py
    npx netlify deploy --dir=site --prod

build_all.py is the single source and emits BOTH:
  site/index.html + site/data.json   -> encrypted, for Netlify
  bela_buyer_catalog.html            -> standalone, offline/email

## Verify layout after any CSS change
    python3 verify_layout.py     # headless Chromium, checks header overlap at 3 widths
                                 # writes layout_desktop.png / layout_hero.png

## Changing the catalog password
    CATALOG_PASSPHRASE='NewPass' python3 build_all.py    # then redeploy
Never stored anywhere — it only derives the AES key. No recovery if lost.
