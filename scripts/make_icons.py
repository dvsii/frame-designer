"""Draw the Frame Designer app icons (a mitered corner in tape-measure yellow) as PNGs.

Writes the web icons to icons/ and, when the Capacitor iOS project is there, the 1024 px App Store icon
(opaque, as Apple requires) into it. Pure standard library, so it runs anywhere Python 3 does:
    python3 scripts/make_icons.py
"""
import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INK = (28, 33, 30)
TAPE = (243, 194, 47)

# The mark on a 40-unit grid, matching icons/icon.svg.
MARK = [(7, 7), (33, 7), (25, 15), (15, 15), (15, 25), (7, 33)]


def inside(poly, x, y):
    hit = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            hit = not hit
        j = i
    return hit


def near_seg(x, y, a, b, half):
    (ax, ay), (bx, by) = a, b
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
    px, py = ax + t * dx, ay + t * dy
    return (x - px) ** 2 + (y - py) ** 2 <= half * half


def draw(size, safe):
    """safe: fraction of the icon the 40-unit mark grid spans (smaller for maskable safe zones)."""
    ss = 4
    off = (1 - safe) / 2 * 40
    scale = safe
    rows = []
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            acc = [0, 0, 0]
            for sy in range(ss):
                for sx in range(ss):
                    gx = ((px + (sx + 0.5) / ss) / size * 40 - off) / scale
                    gy = ((py + (sy + 0.5) / ss) / size * 40 - off) / scale
                    col = INK
                    if inside(MARK, gx, gy) and not near_seg(gx, gy, (7, 7), (15, 15), 0.8):
                        col = TAPE
                    acc[0] += col[0]; acc[1] += col[1]; acc[2] += col[2]
            n = ss * ss
            row += bytes((acc[0] // n, acc[1] // n, acc[2] // n))
        rows.append(bytes(row))
    return b''.join(rows)


def png(path, size, safe):
    raw = draw(size, safe)

    def chunk(kind, data):
        c = struct.pack('>I', len(data)) + kind + data
        return c + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)

    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
    data += chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(data)
    print('wrote', os.path.relpath(path, ROOT))


if __name__ == '__main__':
    out = os.path.join(ROOT, 'icons')
    os.makedirs(out, exist_ok=True)
    png(os.path.join(out, 'icon-192.png'), 192, 1.0)
    png(os.path.join(out, 'icon-512.png'), 512, 1.0)
    png(os.path.join(out, 'icon-maskable-512.png'), 512, 0.78)
    png(os.path.join(out, 'apple-touch-icon.png'), 180, 0.9)
    ios = os.path.join(ROOT, 'ios', 'App', 'App', 'Assets.xcassets', 'AppIcon.appiconset')
    if os.path.isdir(ios):
        png(os.path.join(ios, 'AppIcon-512@2x.png'), 1024, 0.9)
