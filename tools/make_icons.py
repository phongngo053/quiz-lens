#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Sinh icon PNG cho Quiz Lens mà không cần thư viện ngoài.
Dùng thuần zlib + struct để ghi file PNG.

Biểu tượng: nền bo góc gradient xanh -> tím, bên trong là một
"trang bài kiểm tra" màu trắng với dải đáp án và một dấu check.
"""
import math
import os
import struct
import zlib

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "icons")
OUT_DIR = os.path.normpath(OUT_DIR)


def lerp(a, b, t):
    return a + (b - a) * t


def mix(c1, c2, t):
    return tuple(int(round(lerp(c1[i], c2[i], t))) for i in range(3))


def write_png(path, width, height, pixels):
    """pixels: list of rows, mỗi row là list của (r,g,b,a)"""
    raw = bytearray()
    for row in pixels:
        raw.append(0)  # filter type 0
        for (r, g, b, a) in row:
            raw += bytes((r, g, b, a))

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        c += struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        return c

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")

    with open(path, "wb") as f:
        f.write(png)
    return len(png)


def rounded_rect(x, y, w, h, r):
    """Signed coverage test cho hình chữ nhật bo góc."""
    cx = min(max(x, r), w - r)
    cy = min(max(y, r), h - r)
    dx = x - cx
    dy = y - cy
    return dx * dx + dy * dy <= r * r


def coverage(x, y, w, h, r, samples=4):
    """Ước lượng anti-alias bằng siêu lấy mẫu 4x4."""
    hits = 0
    for sy in range(samples):
        for sx in range(samples):
            px = x + (sx + 0.5) / samples
            py = y + (sy + 0.5) / samples
            if rounded_rect(px, py, w, h, r):
                hits += 1
    return hits / (samples * samples)


def build(size):
    S = size
    px = [[(0, 0, 0, 0)] * S for _ in range(S)]
    ss = 4  # supersampling cho hình nền

    blue = (79, 156, 249)
    purple = (124, 92, 255)

    # --- Nền bo góc gradient chéo ---
    for y in range(S):
        for x in range(S):
            cov = coverage(x, y, S, S, S * 0.22, ss)
            if cov <= 0:
                continue
            t = (x + y) / (2.0 * S)
            # làm dịu gradient bằng smoothstep
            ts = t * t * (3 - 2 * t)
            r, g, b = mix(blue, purple, ts)
            px[y][x] = (r, g, b, int(round(255 * cov)))

    # --- Nội dung: trang bài kiểm tra trắng ---
    card_w = S * 0.50
    card_h = S * 0.62
    card_x = (S - card_w) / 2
    card_y = S * 0.19
    card_r = S * 0.07

    for y in range(S):
        for x in range(S):
            cov = coverage(x, y, card_w, card_h, card_r, 4)
            if cov <= 0:
                continue
            r, g, b, a = px[y][x]
            # trộn trắng với nền theo coverage
            nr = int(round(lerp(r, 255, cov)))
            ng = int(round(lerp(g, 255, cov)))
            nb = int(round(lerp(b, 255, cov)))
            na = int(round(lerp(a, 255, cov)))
            px[y][x] = (nr, ng, nb, na)

    # --- Ba dải dòng (tượng trưng đáp án) ---
    bar_h = max(1.0, S * 0.045)
    gap = S * 0.085
    bar_x = card_x + card_w * 0.13
    bar_w = card_w * 0.55
    start_y = card_y + card_h * 0.20
    for i in range(3):
        by = start_y + i * gap
        for y in range(S):
            for x in range(S):
                if by <= y < by + bar_h:
                    cov = coverage(x, y, bar_w, bar_h, bar_h / 2, 3)
                    if cov <= 0:
                        continue
                    r, g, b, a = px[y][x]
                    col = (140, 160, 190)
                    px[y][x] = (
                        int(round(lerp(r, col[0], cov))),
                        int(round(lerp(g, col[1], cov))),
                        int(round(lerp(b, col[2], cov))),
                        a,
                    )

    # --- Dấu check màu xanh lá ở góc phải dưới ---
    ck_cx = card_x + card_w * 0.74
    ck_cy = card_y + card_h * 0.70
    ck_r = S * 0.115
    for y in range(S):
        for x in range(S):
            d = math.hypot(x - ck_cx, y - ck_cy)
            if d <= ck_r:
                cov = min(1.0, (ck_r - d) / 1.2)
                r, g, b, a = px[y][x]
                px[y][x] = (
                    int(round(lerp(r, 53, cov))),
                    int(round(lerp(g, 201, cov))),
                    int(round(lerp(b, 138, cov))),
                    a,
                )

    # --- Vẽ dấu check (2 nét) màu trắng bên trong huy hiệu tròn ---
    def draw_segment(x0, y0, x1, y1, width, color):
        for y in range(S):
            for x in range(S):
                vx, vy = x1 - x0, y1 - y0
                ln2 = vx * vx + vy * vy
                t = 0.0 if ln2 == 0 else ((x - x0) * vx + (y - y0) * vy) / ln2
                t = max(0.0, min(1.0, t))
                px_, py_ = x0 + t * vx, y0 + t * vy
                dist = math.hypot(x - px_, y - py_)
                if dist <= width / 2:
                    cov = min(1.0, (width / 2 - dist) / 1.0)
                    r, g, b, a = px[y][x]
                    px[y][x] = (
                        int(round(lerp(r, color[0], cov))),
                        int(round(lerp(g, color[1], cov))),
                        int(round(lerp(b, color[2], cov))),
                        a,
                    )

    if S >= 32:
        w = max(1.6, S * 0.075)
        draw_segment(ck_cx - ck_r * 0.42, ck_cy + ck_r * 0.02,
                     ck_cx - ck_r * 0.10, ck_cy + ck_r * 0.34, w, (255, 255, 255))
        draw_segment(ck_cx - ck_r * 0.10, ck_cy + ck_r * 0.34,
                     ck_cx + ck_r * 0.44, ck_cy - ck_r * 0.34, w, (255, 255, 255))

    return px


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in (16, 32, 48, 128):
        px = build(size)
        path = os.path.join(OUT_DIR, "icon-%d.png" % size)
        n = write_png(path, size, size, px)
        print("Da tao %-22s (%dx%d, %d bytes)" % ("icon-%d.png" % size, size, size, n))


if __name__ == "__main__":
    main()
