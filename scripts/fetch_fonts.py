"""Download the app's three Google Fonts into fonts/ so the page needs no network (and the iPhone app works offline).

Keeps the latin and latin-ext subsets, writes fonts/fonts.css pointing at the local files, and saves each
family's SIL Open Font License next to them. Pure standard library:
    python3 scripts/fetch_fonts.py
"""
import os
import re
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'fonts')
# Also used by scripts/build_single.py, whose single-file builds load the fonts from Google.
CSS_URL = ('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600'
           '&family=Barlow+Semi+Condensed:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap')
LICENSES = {
    'barlow': 'https://raw.githubusercontent.com/google/fonts/main/ofl/barlow/OFL.txt',
    'barlow-semi-condensed': 'https://raw.githubusercontent.com/google/fonts/main/ofl/barlowsemicondensed/OFL.txt',
    'ibm-plex-mono': 'https://raw.githubusercontent.com/google/fonts/main/ofl/ibmplexmono/OFL.txt',
}
SUBSETS = ('latin-ext', 'latin')
# Google serves woff2 only to browsers it recognises.
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA})) as r:
        return r.read()


def main():
    os.makedirs(OUT, exist_ok=True)
    css = get(CSS_URL).decode('utf-8')
    faces = []
    for subset, body in re.findall(r'/\* ([\w-]+) \*/\s*@font-face \{(.*?)\}', css, re.S):
        if subset not in SUBSETS:
            continue
        family = re.search(r"font-family: '([^']+)'", body).group(1)
        weight = re.search(r'font-weight: (\d+)', body).group(1)
        src = re.search(r'url\((\S+?\.woff2)\)', body).group(1)
        rng = re.search(r'unicode-range: ([^;]+);', body).group(1)
        name = f"{family.lower().replace(' ', '-')}-{weight}-{subset}.woff2"
        with open(os.path.join(OUT, name), 'wb') as f:
            f.write(get(src))
        faces.append(f"/* {family} {weight}, {subset} */\n@font-face {{\n  font-family: '{family}';\n  font-style: normal;\n"
                     f"  font-weight: {weight};\n  font-display: swap;\n  src: url({name}) format('woff2');\n"
                     f"  unicode-range: {rng};\n}}\n")
        print('wrote fonts/' + name)
    with open(os.path.join(OUT, 'fonts.css'), 'w', encoding='utf-8') as f:
        f.write('/* Barlow, Barlow Semi Condensed and IBM Plex Mono from Google Fonts, under the SIL Open Font License\n'
                '   (OFL-*.txt). Regenerate with python3 scripts/fetch_fonts.py. */\n' + '\n'.join(faces))
    for fam, url in LICENSES.items():
        with open(os.path.join(OUT, f'OFL-{fam}.txt'), 'wb') as f:
            f.write(get(url))
    print(f'wrote fonts/fonts.css ({len(faces)} faces) and {len(LICENSES)} licenses')


if __name__ == '__main__':
    main()
