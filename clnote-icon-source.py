"""
Generate a clean Klein-blue five-pointed star icon source (transparent bg).
Output: clnote-icon-source.png @ 1024x1024 (supersampled 4x for crisp edges).
"""
import math
from PIL import Image, ImageDraw

SIZE = 1024
SS = 4  # supersample factor for anti-aliasing

klein_blue = (0, 47, 167, 255)  # #002FA7

def star_points(cx, cy, r_out, r_in, n=5):
    pts = []
    # start at top (-90deg), alternate outer/inner every 36deg
    for i in range(n * 2):
        ang = -math.pi / 2 + i * (math.pi / n)
        r = r_out if i % 2 == 0 else r_in
        pts.append((cx + r * math.cos(ang), cy + r * math.sin(ang)))
    return pts

big = SIZE * SS
img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
cx = cy = big / 2
r_out = big * 0.42
r_in = r_out * 0.381966  # exact inner ratio for a regular 5-point star
d.polygon(star_points(cx, cy, r_out, r_in), fill=klein_blue)

img = img.resize((SIZE, SIZE), Image.LANCZOS)
out = "clnote-icon-source.png"
img.save(out)
print("wrote", out, img.size, img.mode)
