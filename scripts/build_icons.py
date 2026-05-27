"""
Generate all icon assets for the YT Chat Translator extension.

Outputs:
  icons/icon16.plasmo.6c567d50.png   (extension toolbar icon, small)
  icons/icon32.plasmo.76b92899.png
  icons/icon48.plasmo.aced7582.png
  icons/icon64.plasmo.8bb5e6e0.png
  icons/icon128.plasmo.3c1ed2d2.png
  icons/icon128.png                  (manifest "action.default_icon" 128)
  icons/icon_full.png                (1024 master for web store / promo)
  stripe-branding/stripe-icon-128x128.png   (Stripe brand mark, 128, <510KB)
  stripe-branding/stripe-logo-full.png      (Stripe brand mark, large, <510KB)

Design:
  Rounded red squircle background (YouTube-inspired gradient),
  white speech bubble centred with red play triangle inside,
  small "A 文" translation badge bottom-right for 48px+ icons.

Usage:
  python scripts/build_icons.py
"""

from __future__ import annotations

from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ICON_DIR = ROOT / "icons"
STRIPE_DIR = ROOT / "stripe-branding"
ICON_DIR.mkdir(exist_ok=True)
STRIPE_DIR.mkdir(exist_ok=True)

# Colours
RED_LIGHT = (255, 38, 38)       # top-left gradient
RED_DARK = (176, 0, 0)          # bottom-right gradient
WHITE = (255, 255, 255)
BUBBLE_SHADOW = (120, 0, 0, 110)
BADGE_BG = (255, 255, 255)
BADGE_TEXT = (200, 0, 0)

MAX_BYTES = 510 * 1024  # Stripe asset limit


# ---------- helpers ----------

def find_font(candidates, size):
    """Try a list of system font paths/names; fall back to default."""
    for name in candidates:
        try:
            return ImageFont.truetype(name, size)
        except (OSError, IOError):
            continue
    return ImageFont.load_default()


def linear_gradient(size, c1, c2):
    """Diagonal gradient from c1 (top-left) to c2 (bottom-right)."""
    base = Image.new("RGB", (size, size), c1)
    top = Image.new("RGB", (size, size), c2)
    mask = Image.new("L", (size, size))
    for y in range(size):
        for x in range(size):
            t = int(((x + y) / (2 * (size - 1))) * 255)
            mask.putpixel((x, y), t)
    base.paste(top, (0, 0), mask)
    return base.convert("RGBA")


def rounded_mask(size, radius_ratio=0.22):
    radius = int(size * radius_ratio)
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def speech_bubble(size, fill=WHITE):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = int(size * 0.16)
    body_top = int(size * 0.14)
    body_bottom = int(size * 0.72)
    d.rounded_rectangle(
        (pad, body_top, size - pad, body_bottom),
        radius=int(size * 0.18),
        fill=fill,
    )
    tail = [
        (int(size * 0.28), body_bottom - 2),
        (int(size * 0.18), int(size * 0.92)),
        (int(size * 0.45), body_bottom - 2),
    ]
    d.polygon(tail, fill=fill)
    return img


def play_triangle(size, fill=(220, 0, 0)):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    cx, cy = size / 2, size / 2
    w = size * 0.42
    h = size * 0.48
    pts = [
        (cx - w / 2 + size * 0.04, cy - h / 2),
        (cx - w / 2 + size * 0.04, cy + h / 2),
        (cx + w / 2 + size * 0.04, cy),
    ]
    d.polygon(pts, fill=fill)
    return img


def translation_badge(size):
    """Small circular A->文 translation badge, rendered at 4x then downscaled."""
    scale = 4
    s = size * scale
    canvas = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(canvas)

    margin = int(s * 0.04)
    d.ellipse((margin, margin, s - 1 - margin, s - 1 - margin), fill=BADGE_BG)

    font_a = find_font([
        "arialbd.ttf", "Arial Bold.ttf", "DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ], int(s * 0.45))
    font_cjk = find_font([
        "msyhbd.ttc",
        "msyh.ttc",
        "simhei.ttf",
        "C:/Windows/Fonts/msyhbd.ttc",
        "C:/Windows/Fonts/simhei.ttf",
        "C:/Windows/Fonts/msyh.ttc",
        "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf",
        "NotoSansCJK-Bold.ttc",
        "NotoSansSC-Bold.otf",
        "YuGothB.ttc",
    ], int(s * 0.45))

    a_text = "A"
    cjk_text = "文"

    a_bbox = d.textbbox((0, 0), a_text, font=font_a)
    cjk_bbox = d.textbbox((0, 0), cjk_text, font=font_cjk)
    a_w = a_bbox[2] - a_bbox[0]
    a_h = a_bbox[3] - a_bbox[1]
    cjk_w = cjk_bbox[2] - cjk_bbox[0]
    cjk_h = cjk_bbox[3] - cjk_bbox[1]

    gap = int(s * 0.06)
    total_w = a_w + gap + cjk_w
    start_x = (s - total_w) // 2
    y_a = (s - a_h) // 2 - a_bbox[1]
    y_cjk = (s - cjk_h) // 2 - cjk_bbox[1]

    d.text((start_x - a_bbox[0], y_a), a_text, font=font_a, fill=BADGE_TEXT)
    d.text((start_x + a_w + gap - cjk_bbox[0], y_cjk), cjk_text, font=font_cjk, fill=BADGE_TEXT)

    # Tiny arrow between letters
    arrow_y = s // 2
    arrow_w = max(2, s // 14)
    ax_center = start_x + a_w + gap // 2
    d.polygon([
        (ax_center - gap // 3, arrow_y - arrow_w // 2),
        (ax_center + gap // 3, arrow_y),
        (ax_center - gap // 3, arrow_y + arrow_w // 2),
    ], fill=BADGE_TEXT)

    return canvas.resize((size, size), Image.Resampling.LANCZOS)


def render_master(size, include_badge=True):
    bg = linear_gradient(size, RED_LIGHT, RED_DARK)
    mask = rounded_mask(size)
    bg.putalpha(mask)

    # Subtle white highlight top-left
    highlight = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    hd = ImageDraw.Draw(highlight)
    hd.ellipse(
        (-int(size * 0.3), -int(size * 0.3), int(size * 0.55), int(size * 0.55)),
        fill=(255, 255, 255, 35),
    )
    bg = Image.alpha_composite(bg, highlight)

    # Bubble + shadow
    bubble_size = int(size * 0.86)
    bubble_pad = (size - bubble_size) // 2
    bubble = speech_bubble(bubble_size, fill=WHITE)
    shadow = speech_bubble(bubble_size, fill=BUBBLE_SHADOW)
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=max(1, size // 64)))
    bg.alpha_composite(shadow, (bubble_pad, bubble_pad + max(1, size // 80)))
    bg.alpha_composite(bubble, (bubble_pad, bubble_pad))

    # Play triangle inside bubble
    play_canvas_size = int(size * 0.46)
    play = play_triangle(play_canvas_size, fill=(220, 20, 20))
    play_x = (size - play_canvas_size) // 2
    play_y = int(size * 0.21)
    bg.alpha_composite(play, (play_x, play_y))

    if include_badge:
        badge_size = int(size * 0.38)
        badge = translation_badge(badge_size)
        bx = size - badge_size - int(size * 0.06)
        by = size - badge_size - int(size * 0.06)
        bg.alpha_composite(badge, (bx, by))

    return bg


# ---------- save helpers ----------

def save_png(img, path):
    img.save(path, format="PNG", optimize=True)
    kb = path.stat().st_size / 1024
    print("  {}  {}x{}  {:.1f} KB".format(
        path.relative_to(ROOT), img.size[0], img.size[1], kb
    ))


def save_under_limit(img, path):
    save_png(img, path)
    if path.stat().st_size > MAX_BYTES:
        for s in [1024, 768, 512, 256, 128]:
            tmp = img.resize((s, s), Image.Resampling.LANCZOS)
            tmp.save(path, format="PNG", optimize=True)
            if path.stat().st_size <= MAX_BYTES:
                print("  -> downscaled to {}x{} to fit {} bytes".format(s, s, MAX_BYTES))
                return
        raise RuntimeError("{} can't be reduced below {}".format(path, MAX_BYTES))


def main():
    print("Rendering master (1024x1024)...")
    master = render_master(1024, include_badge=True)
    save_png(master, ICON_DIR / "icon_full.png")

    print("\nGenerating extension icons:")
    targets = [
        (16, "icon16.plasmo.6c567d50.png", False),
        (32, "icon32.plasmo.76b92899.png", False),
        (48, "icon48.plasmo.aced7582.png", True),
        (64, "icon64.plasmo.8bb5e6e0.png", True),
        (128, "icon128.plasmo.3c1ed2d2.png", True),
        (128, "icon128.png", True),
    ]
    for size, name, badge in targets:
        img = render_master(size * 4, include_badge=badge)
        img = img.resize((size, size), Image.Resampling.LANCZOS)
        save_png(img, ICON_DIR / name)

    print("\nGenerating Stripe branding:")
    stripe_icon = render_master(512, include_badge=True).resize((128, 128), Image.Resampling.LANCZOS)
    save_under_limit(stripe_icon, STRIPE_DIR / "stripe-icon-128x128.png")

    stripe_full = render_master(1024, include_badge=True)
    save_under_limit(stripe_full, STRIPE_DIR / "stripe-logo-full.png")

    print("\nDone.")


if __name__ == "__main__":
    main()
