#!/usr/bin/env python3
"""
VibeCheck PWA icon renderer — pure Python, zero dependencies.

Renders the VibeCheck mark: a "V" + checkmark ("✓") formed from horizontal
sound-wave / WiFi-style bars. Purple -> cyan gradient on a dark tile.

Usage:
  python3 scripts/render_icon.py --preview        # ASCII silhouette preview
  python3 scripts/render_icon.py                  # write public/icon-{192,512}.png
"""
import math
import os
import struct
import sys
import zlib

# ─── Brand palette ───────────────────────────────────────────────
PURPLE = (139, 92, 246)    # #8b5cf6
CYAN   = (6, 182, 212)     # #06b6d4
BG_TOP = (20, 20, 31)      # subtle vertical lift on the tile
BG_BOT = (15, 15, 26)      # ~#0F0F1A

MARK_CENTER = (256.0, 256.0)   # where the mark's bbox center lands (512 space)
MARK_SCALE  = 0.90             # global scale so the mark sits in the maskable safe zone


# ─── Geometry ────────────────────────────────────────────────────
def build_bars():
    """Return list of pills (cx, cy, half_len, half_h) in 512 space."""
    bars = []
    B = 30          # bar height
    HALF_H = B / 2.0

    def add(cx, cy, length):
        bars.append((cx, cy, length / 2.0, HALF_H))

    # Left leg ("V"): axis from top-left down to the heel (bottom center).
    ax0, ay0, ax1, ay1 = 128.0, 172.0, 252.0, 398.0
    n = 6
    for i in range(n):
        y = 186 + 40 * i
        t = (y - 186) / 200.0                       # 0 at top, 1 at heel
        x = ax0 + (ax1 - ax0) * (y - ay0) / (ay1 - ay0)
        length = 44 - 28 * t                        # taper toward the heel
        add(x, y, length)

    # Right leg (the check's long stroke): taller than the left leg, and
    # one extra bar so both legs reach the same heel height.
    bx0, by0, bx1, by1 = 382.0, 146.0, 258.0, 398.0
    n = 7
    for i in range(n):
        y = 166 + 37 * i
        t = (y - 166) / 222.0
        x = bx0 + (bx1 - bx0) * (y - by0) / (by1 - by0)
        length = 44 - 28 * t
        add(x, y, length)

    # Check tick: elbow bar + short tip bar rising to the top-right.
    add(398.0, 152.0, 44)
    add(412.0, 110.0, 20)

    # Normalize: scale about the bbox center, then center the mark.
    xs = [b[0] for b in bars]
    ys = [b[1] for b in bars]
    bx0_, by0_ = min(xs), min(ys)
    bx1_, by1_ = max(xs), max(ys)
    cxm, cym = (bx0_ + bx1_) / 2, (by0_ + by1_) / 2
    scaled = []
    for cx, cy, hl, hh in bars:
        nx = (cx - cxm) * MARK_SCALE + MARK_CENTER[0]
        ny = (cy - cym) * MARK_SCALE + MARK_CENTER[1]
        scaled.append((nx, ny, hl * MARK_SCALE, hh * MARK_SCALE))
    return scaled


def mark_bbox(bars):
    xs0 = min(b[0] - b[2] for b in bars)
    xs1 = max(b[0] + b[2] for b in bars)
    ys0 = min(b[1] - b[3] for b in bars)
    ys1 = max(b[1] + b[3] for b in bars)
    return xs0, ys0, xs1, ys1


# ─── Math helpers ────────────────────────────────────────────────
def clamp01(v):
    return 0.0 if v < 0.0 else (1.0 if v > 1.0 else v)


def lerp(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t)


def pill_sdf(px, py, cx, cy, hl, hh):
    """Signed distance to a pill (rounded rect, r = hh). Negative = inside."""
    qx = abs(px - cx) - hl + hh
    qy = abs(py - cy) - hh + hh
    if qx < 0.0:
        qx = 0.0
    if qy < 0.0:
        qy = 0.0
    return math.sqrt(qx * qx + qy * qy) - hh


# ─── Rasterizer ──────────────────────────────────────────────────
def render(size, bars, ss=2):
    """Render at `size` with ss x ss supersampling. Returns list of RGB rows.

    `bars` are in 512-space; they are scaled into the target space here so
    the same geometry renders at any size.
    """
    k = size / 512.0
    bars = [(cx * k, cy * k, hl * k, hh * k) for cx, cy, hl, hh in bars]
    center = (MARK_CENTER[0] * k, MARK_CENTER[1] * k)
    glow_sigma = 190.0 * k
    bx0, by0, bx1, by1 = mark_bbox(bars)
    # gradient bounds across the mark (diagonal, top-left -> bottom-right)
    gw = max(bx1 - bx0, 1.0)
    gh = max(by1 - by0, 1.0)

    rows = []
    half = 0.5 / ss
    for py in range(size):
        row = bytearray(size * 3)
        for px in range(size):
            r_acc = g_acc = b_acc = 0.0
            # background sample (same for all sub-samples; reuse)
            for sy in range(ss):
                fy = (py + (sy + 0.5) / ss) / size
                base = lerp(BG_TOP, BG_BOT, clamp01(fy))
                for sx in range(ss):
                    fx = (px + (sx + 0.5) / ss) / size
                    # background with subtle center glow
                    gx = fx * size - center[0]
                    gy = fy * size - center[1]
                    glow = math.exp(-(gx * gx + gy * gy) / (2.0 * glow_sigma * glow_sigma)) * 0.16
                    bg = (base[0] + PURPLE[0] * glow, base[1] + PURPLE[1] * glow,
                          base[2] + PURPLE[2] * glow)
                    # mark coverage
                    cov = 0.0
                    for cx, cy, hl, hh in bars:
                        d = pill_sdf(fx * size, fy * size, cx, cy, hl, hh)
                        if d <= 0.0:
                            cov = 1.0
                            break
                        # 1px soft edge
                        if d < 1.5:
                            cov = max(cov, clamp01(0.5 - d))
                    if cov > 0.0:
                        # gradient across mark bbox
                        t = clamp01(((fx * size - bx0) / gw + (fy * size - by0) / gh) / 2.0)
                        t = t * t * (3.0 - 2.0 * t)  # smoothstep
                        mc = lerp(PURPLE, CYAN, t)
                        r_acc += bg[0] * (1 - cov) + mc[0] * cov
                        g_acc += bg[1] * (1 - cov) + mc[1] * cov
                        b_acc += bg[2] * (1 - cov) + mc[2] * cov
                    else:
                        r_acc += bg[0]
                        g_acc += bg[1]
                        b_acc += bg[2]
            n = ss * ss
            row[px * 3] = int(min(255, r_acc / n + 0.5))
            row[px * 3 + 1] = int(min(255, g_acc / n + 0.5))
            row[px * 3 + 2] = int(min(255, b_acc / n + 0.5))
        rows.append(bytes(row))
    return rows


def write_png(path, size, rows):
    def chunk(typ, data):
        c = struct.pack(">I", len(data)) + typ + data
        c += struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF)
        return c

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)  # 8-bit RGB
    raw = b"".join(b"\x00" + r for r in rows)
    png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) +
           chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)
    print(f"wrote {path} ({size}x{size}, {len(png)} bytes)")


# ─── ASCII preview (terminal silhouette check) ───────────────────
def preview(bars, cols=58, rows_=26):
    bx0, by0, bx1, by1 = mark_bbox(bars)
    out = []
    for r in range(rows_):
        line = []
        for c in range(cols):
            fx = (c + 0.5) / cols
            fy = (r + 0.5) / rows_
            px = bx0 + fx * (bx1 - bx0)
            py = by0 + fy * (by1 - by0)
            inside = any(pill_sdf(px, py, cx, cy, hl, hh) <= 0 for cx, cy, hl, hh in bars)
            line.append("#" if inside else ".")
        out.append("".join(line))
    print("\n".join(out))


def main():
    bars = build_bars()
    if "--preview" in sys.argv:
        preview(bars)
        bb = mark_bbox(bars)
        cx, cy = (bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2
        print(f"\nbbox=({bb[0]:.0f},{bb[1]:.0f})-({bb[2]:.0f},{bb[3]:.0f}) "
              f"size=({bb[2]-bb[0]:.0f}x{bb[3]-bb[1]:.0f}) center=({cx:.0f},{cy:.0f})")
        # maskable safe-zone check: every mark point within r=205 of tile center
        worst = 0.0
        for b in bars:
            for ex, ey in ((b[0]-b[2], b[1]-b[3]), (b[0]+b[2], b[1]-b[3]),
                           (b[0]-b[2], b[1]+b[3]), (b[0]+b[2], b[1]+b[3])):
                worst = max(worst, math.hypot(ex-256, ey-256))
        print(f"worst corner distance from tile center: {worst:.1f} (safe zone r=205)")
        return

    here = os.path.dirname(os.path.abspath(__file__))
    outdir = os.path.normpath(os.path.join(here, "..", "public"))
    for size in (512, 192):
        rows = render(size, bars)
        write_png(os.path.join(outdir, f"icon-{size}.png"), size, rows)


if __name__ == "__main__":
    main()
