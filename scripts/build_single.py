"""Bundle Frame Designer into one self-contained HTML file.

    python3 scripts/build_single.py            # dist/frame-designer.html, a full standalone page
    python3 scripts/build_single.py --fragment # dist/frame-designer-fragment.html, body-only for hosts
                                               # that wrap the page in their own <html>/<head>

The scripts are inlined and the PWA links (manifest, icons, service worker) are dropped,
so the file works when opened straight from disk or e-mailed.
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def main():
    fragment = '--fragment' in sys.argv
    html = read('index.html')
    html = re.sub(r'<!-- standalone:start -->.*?<!-- standalone:end -->\n?', '', html, flags=re.S)

    def inline(m):
        src = read(m.group(1))
        if '</script' in src:
            raise SystemExit(f'{m.group(1)} contains "</script"; cannot inline it safely')
        return f'<script>\n{src}</script>'

    html = re.sub(r'<script src="([^"]+)"></script>', inline, html)

    if fragment:
        title = re.search(r'<title>.*?</title>', html, re.S).group(0)
        fit = re.search(r'<meta name="claude:viewport-fit-sides"[^>]*>', html).group(0)
        links = ''.join(re.findall(r'<link [^>]*>\n?', html))
        style = re.search(r'<style>.*?</style>', html, re.S).group(0)
        body = re.search(r'<body>(.*)</body>', html, re.S).group(1)
        html = f'{title}\n{fit}\n{links}{style}\n{body.strip()}\n'
        out = 'dist/frame-designer-fragment.html'
    else:
        out = 'dist/frame-designer.html'

    os.makedirs(os.path.join(ROOT, 'dist'), exist_ok=True)
    with open(os.path.join(ROOT, out), 'w', encoding='utf-8') as f:
        f.write(html)
    print(f'wrote {out} ({len(html.encode("utf-8")) / 1024:.0f} KB)')


if __name__ == '__main__':
    main()
