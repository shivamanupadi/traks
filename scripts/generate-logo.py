#!/usr/bin/env python3
"""
Pulsebeam Logo Generator
Generates all brand assets:
  - logo{32,64,128,192,256,512}.png  (tricolor gradient, dark bg)
  - logo_lavender.png, logo_sage.png, logo_coral.png  (single-color at 512)
  - logo_tricolor.png  (master 512)
  - favicon.ico, favicon.png, favicon-{16,32,48}x{16,32,48}.png
  - favicon.svg
  - apple-touch-icon.png
  - og.png  (1200x630)
"""

from PIL import Image, ImageDraw, ImageFont
import os

# Brand colors
LAVENDER = (155, 114, 207)
SAGE = (91, 154, 111)
CORAL = (224, 122, 95)

BG_DARK = (35, 35, 45)
CREAM = (250, 248, 253)  # matches --background
WHITE = (255, 255, 255)

OUTPUT = '/Users/shivaprasadmanupadi/devbox/projects/pulsebeam/apps/web/public'


def lerp(c1, c2, t):
    return tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))


def rounded_rect(draw, bbox, r, fill):
    x0, y0, x1, y1 = bbox
    draw.rectangle([x0 + r, y0, x1 - r, y1], fill=fill)
    draw.rectangle([x0, y0 + r, x1, y1 - r], fill=fill)
    draw.pieslice([x0, y0, x0 + 2*r, y0 + 2*r], 180, 270, fill=fill)
    draw.pieslice([x1 - 2*r, y0, x1, y0 + 2*r], 270, 360, fill=fill)
    draw.pieslice([x0, y1 - 2*r, x0 + 2*r, y1], 90, 180, fill=fill)
    draw.pieslice([x1 - 2*r, y1 - 2*r, x1, y1], 0, 90, fill=fill)


def bar_chart_mask(size):
    """Create a pulse/bar chart icon mask — 3 bars with ascending pattern."""
    mask = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(mask)

    pad = size * 0.18
    bottom = size - pad
    left = pad
    right = size - pad
    area_w = right - left
    bar_w = area_w * 0.22
    gap = (area_w - 3 * bar_w) / 2
    bar_r = int(bar_w * 0.2)

    # Bar heights (left=medium, center=tall, right=short) — analytics chart feel
    heights = [0.50, 0.80, 0.35]

    for i, h in enumerate(heights):
        bx = left + i * (bar_w + gap)
        bar_h = (bottom - pad) * h
        by = bottom - bar_h
        # Rounded top bar
        rounded_rect(d, [int(bx), int(by), int(bx + bar_w), int(bottom)], bar_r, 255)

    return mask


def gradient_bars(size, top_color, bottom_color, mid_color=None):
    """Fill the bar chart shape with a vertical gradient."""
    if mid_color is None:
        mid_color = lerp(top_color, bottom_color, 0.5)
    mask = bar_chart_mask(size)
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    for y in range(size):
        t = y / max(size - 1, 1)
        if t < 0.5:
            c = lerp(top_color, mid_color, t * 2)
        else:
            c = lerp(mid_color, bottom_color, (t - 0.5) * 2)
        for x in range(size):
            if mask.getpixel((x, y)) > 0:
                img.putpixel((x, y), (*c, 255))
    return img


def solid_bars(size, color):
    mask = bar_chart_mask(size)
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    for y in range(size):
        for x in range(size):
            if mask.getpixel((x, y)) > 0:
                img.putpixel((x, y), (*color, 255))
    return img


def make_icon(size, bars_img, bg_color=BG_DARK, glow=True):
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    radius = int(size * 0.22)
    rounded_rect(draw, [0, 0, size-1, size-1], radius, bg_color)

    if glow and bg_color == BG_DARK:
        glow_layer = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        gd = ImageDraw.Draw(glow_layer)
        gs = int(size * 0.55)
        for i in range(gs, 0, -2):
            a = int(10 * (i / gs))
            gd.ellipse([size*0.05 - i//2, size*0.05 - i//2, size*0.05 + i//2, size*0.05 + i//2], fill=(*LAVENDER, a))
        for i in range(gs, 0, -2):
            a = int(8 * (i / gs))
            gd.ellipse([size*0.95 - i//2, size*0.95 - i//2, size*0.95 + i//2, size*0.95 + i//2], fill=(*SAGE, a))
        canvas = Image.alpha_composite(canvas, glow_layer)

    bs = int(size * 0.72)
    off = (size - bs) // 2
    canvas.paste(bars_img.resize((bs, bs), Image.LANCZOS), (off, off), bars_img.resize((bs, bs), Image.LANCZOS))
    return canvas


def get_font(size, bold=True):
    paths = [
        "/System/Library/Fonts/SFProText-Bold.otf" if bold else "/System/Library/Fonts/SFProText-Regular.otf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for p in paths:
        try:
            return ImageFont.truetype(p, size)
        except (OSError, IOError):
            continue
    return ImageFont.load_default()


def text_width(draw, text, font):
    bb = draw.textbbox((0, 0), text, font=font)
    return bb[2] - bb[0]


def create_og(master_icon):
    w, h = 1200, 630
    img = Image.new('RGBA', (w, h), CREAM)
    draw = ImageDraw.Draw(img)

    # Subtle color orbs
    orb = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    od = ImageDraw.Draw(orb)
    for r in range(350, 0, -3):
        a = int(8 * (r / 350))
        od.ellipse([80 - r, 100 - r, 80 + r, 100 + r], fill=(*LAVENDER, a))
    for r in range(300, 0, -3):
        a = int(6 * (r / 300))
        od.ellipse([1100 - r, 500 - r, 1100 + r, 500 + r], fill=(*SAGE, a))
    img = Image.alpha_composite(img, orb)
    draw = ImageDraw.Draw(img)

    icon_size = 200
    icon = master_icon.resize((icon_size, icon_size), Image.LANCZOS)
    icon_x = 200
    icon_y = (h - icon_size) // 2
    img.paste(icon, (icon_x, icon_y), icon)

    font_title = get_font(56, bold=True)
    font_sub = get_font(22, bold=False)

    text_x = icon_x + icon_size + 80
    title_y = icon_y + 40
    draw.text((text_x, title_y), "Pulsebeam", fill=(45, 52, 54, 255), font=font_title)
    draw.text((text_x, title_y + 75), "Privacy-friendly Analytics", fill=(107, 101, 96, 200), font=font_sub)

    dot_y = title_y + 130
    for i, c in enumerate([LAVENDER, SAGE, CORAL]):
        draw.ellipse([text_x + i*24 - 5, dot_y - 5, text_x + i*24 + 5, dot_y + 5], fill=(*c, 255))

    return img


def favicon_svg():
    return '''<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bar-grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#9B72CF"/>
      <stop offset="50%" stop-color="#5B9A6F"/>
      <stop offset="100%" stop-color="#E07A5F"/>
    </linearGradient>
  </defs>
  <rect width="32" height="32" rx="7" fill="#23232D"/>
  <rect x="6" y="13" width="5.5" height="13" rx="1.2" fill="url(#bar-grad)"/>
  <rect x="13.25" y="6" width="5.5" height="20" rx="1.2" fill="url(#bar-grad)"/>
  <rect x="20.5" y="17" width="5.5" height="9" rx="1.2" fill="url(#bar-grad)"/>
</svg>'''


def main():
    os.makedirs(OUTPUT, exist_ok=True)

    print("\n--- Generating master bars ---")
    tricolor_bars = gradient_bars(512, LAVENDER, CORAL, SAGE)
    lavender_bars = solid_bars(512, LAVENDER)
    sage_bars = solid_bars(512, SAGE)
    coral_bars = solid_bars(512, CORAL)

    # Master tricolor logo
    master = make_icon(512, tricolor_bars)
    master.save(os.path.join(OUTPUT, 'logo_tricolor.png'), 'PNG')
    print("  logo_tricolor.png")

    # Single-color variants
    for name, b in [('lavender', lavender_bars), ('sage', sage_bars), ('coral', coral_bars)]:
        icon = make_icon(512, b)
        icon.save(os.path.join(OUTPUT, f'logo_{name}.png'), 'PNG')
        print(f"  logo_{name}.png")

    # Sized logos
    print("\n--- Generating sized logos ---")
    for s in [32, 64, 128, 192, 256, 512]:
        resized = master.resize((s, s), Image.LANCZOS)
        resized.save(os.path.join(OUTPUT, f'logo{s}.png'), 'PNG')
        print(f"  logo{s}.png")

    # Favicons
    print("\n--- Generating favicons ---")

    fav64 = master.resize((64, 64), Image.LANCZOS)
    fav64.save(os.path.join(OUTPUT, 'favicon.png'), 'PNG')
    print("  favicon.png (64x64)")

    for s in [16, 32, 48]:
        r = master.resize((s, s), Image.LANCZOS)
        r.save(os.path.join(OUTPUT, f'favicon-{s}x{s}.png'), 'PNG')
        print(f"  favicon-{s}x{s}.png")

    ico_16 = master.resize((16, 16), Image.LANCZOS)
    ico_32 = master.resize((32, 32), Image.LANCZOS)
    ico_48 = master.resize((48, 48), Image.LANCZOS)
    ico_16.save(
        os.path.join(OUTPUT, 'favicon.ico'),
        format='ICO',
        sizes=[(16, 16), (32, 32), (48, 48)],
        append_images=[ico_32, ico_48],
    )
    print("  favicon.ico")

    with open(os.path.join(OUTPUT, 'favicon.svg'), 'w') as f:
        f.write(favicon_svg())
    print("  favicon.svg")

    apple = master.resize((180, 180), Image.LANCZOS)
    apple.save(os.path.join(OUTPUT, 'apple-touch-icon.png'), 'PNG')
    print("  apple-touch-icon.png")

    # OG image
    print("\n--- Generating OG image ---")
    og = create_og(master)
    og.save(os.path.join(OUTPUT, 'og.png'), 'PNG')
    print("  og.png (1200x630)")

    print(f"\nDone! All assets in: {OUTPUT}")


if __name__ == '__main__':
    main()
