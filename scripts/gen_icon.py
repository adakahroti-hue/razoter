import math, numpy as np
from PIL import Image, ImageDraw, ImageFilter

S = 512
pad = int(S * 0.12)            # maskable safe zone
R = int(S * 0.22)              # rounded-square radius
# background gradient (navy radial)
bg0 = (8, 16, 30)              # center
bg1 = (3, 7, 14)               # edge
cx, cy = S / 2, S / 2
yy, xx = np.mgrid[0:S, 0:S]
d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / (S * 0.72)
d = np.clip(d, 0, 1)
bg = (bg0[0] + (bg1[0] - bg0[0]) * d)[:, :, None]
bg = bg.repeat(3, 2).astype(np.uint8)
img = Image.fromarray(bg, 'RGB').convert('RGBA')
px = img.load()

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

CYAN = (53, 230, 255)
BLUE = (0, 119, 163)
MAG = (255, 45, 149)

# rounded-square frame
def in_rr(x, y, x0, y0, x1, y1, r):
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    if x < x0 + r and y < y0 + r:
        return (x - (x0 + r)) ** 2 + (y - (y0 + r)) ** 2 <= r * r
    if x > x1 - r and y < y0 + r:
        return (x - (x1 - r)) ** 2 + (y - (y0 + r)) ** 2 <= r * r
    if x < x0 + r and y > y1 - r:
        return (x - (x0 + r)) ** 2 + (y - (y0 + r)) ** 2 <= r * r
    if x > x1 - r and y > y1 - r:
        return (x - (x1 - r)) ** 2 + (y - (y1 - r)) ** 2 <= r * r
    return True

# draw frame gradient stroke
fw = max(2, int(S * 0.035))
x0, y0, x1, y1 = pad, pad, S - pad, S - pad
for y in range(S):
    for x in range(S):
        if in_rr(x, y, x0 - fw, y0 - fw, x1 + fw, y1 + fw, R + fw) and not in_rr(x, y, x0, y0, x1, y1, R):
            t = (x + y) / (S * 2)
            c = lerp(CYAN, BLUE, t)
            px[x, y] = (c[0], c[1], c[2], 255)

# monogram geometry (inside frame)
mx0, mx1 = int(S * 0.34), int(S * 0.66)
my0, my1 = int(S * 0.34), int(S * 0.66)
sw = max(6, int(S * 0.052))   # stroke width

def stroke_pts(pts, width, color_fn):
    img2 = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d2 = ImageDraw.Draw(img2)
    for i in range(len(pts) - 1):
        (ax, ay), (bx, by) = pts[i], pts[i + 1]
        n = max(2, int(math.hypot(bx - ax, by - ay)))
        for k in range(n + 1):
            t = k / n
            x = ax + (bx - ax) * t
            y = ay + (by - ay) * t
            c = color_fn(t)
            d2.ellipse([x - width / 2, y - width / 2, x + width / 2, y + width / 2], fill=c)
    return img2

# spine + bowl + leg
spine = [(mx0, my0), (mx0, my1)]
top_y = my0 + (my1 - my0) * 0.46
bowl = [(mx0, my0), (mx0 + (mx1 - mx0) * 0.62, my0), (mx1, top_y), (mx0 + (mx1 - mx0) * 0.55, my1 * 0.94), (mx0, top_y)]
leg = [(mx0 + (mx1 - mx0) * 0.35, top_y + (my1 - top_y) * 0.1), (mx1, my1)]

def cols(t):
    return lerp(CYAN, BLUE, t) + (255,)

layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
# glow underlay
for pts in (spine, bowl, leg):
    g = stroke_pts(pts, sw * 2.1, lambda t: lerp(CYAN, BLUE, t) + (90,))
    g = g.filter(ImageFilter.GaussianBlur(S * 0.012))
    layer = Image.alpha_composite(layer, g)
# crisp strokes
for pts in (spine, bowl, leg):
    layer = Image.alpha_composite(layer, stroke_pts(pts, sw, cols))

# nodes
nd = ImageDraw.Draw(layer)
for (nx, ny, c) in [
    (mx0, my0, CYAN), (mx1, my1, BLUE),
    (int(S * 0.78), int(S * 0.27), MAG),   # magenta corner accent
]:
    rr = sw * 0.5
    nd.ellipse([nx - rr, ny - rr, nx + rr, ny + rr], fill=c + (255,))

img = Image.alpha_composite(img, layer)
# outer soft glow around whole icon
glow = img.filter(ImageFilter.GaussianBlur(S * 0.02)).point(lambda v: v * 0.5)
img = Image.alpha_composite(img, Image.new('RGBA', (S, S), (0, 0, 0, 0)))

img.save('/home/hermes/razoter/public/icons/icon-512x512.png')
# 192 downscale (keep crisp)
img.resize((192, 192), Image.Resampling.LANCZOS).save('/home/hermes/razoter/public/icons/icon-192x192.png')
print('done', img.size)
