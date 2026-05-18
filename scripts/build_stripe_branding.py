"""Export Stripe branding icon (128x128) and full-size logo from source art."""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(
    r"C:\Users\Liz\.cursor\projects\c-Users-Liz-Downloads-lites-main-YouTube-CommentTranslator-Lite\assets\stripe-branding-source.png"
)
OUT = ROOT / "stripe-branding"
OUT.mkdir(parents=True, exist_ok=True)

MAX_BYTES = 510 * 1024


def save_under_limit(img: Image.Image, path: Path, sizes: list[int]) -> None:
    """Save PNG, reducing dimensions if needed to stay under MAX_BYTES."""
    for size in sizes:
        resized = img.resize((size, size), Image.Resampling.LANCZOS)
        resized.save(path, format="PNG", optimize=True)
        if path.stat().st_size <= MAX_BYTES:
            print(f"Wrote {path.name}: {size}x{size}, {path.stat().st_size / 1024:.1f} KB")
            return
    raise RuntimeError(f"Could not fit {path.name} under {MAX_BYTES} bytes")


def main() -> None:
    src = Image.open(SOURCE).convert("RGBA")
    print(f"Source: {src.size[0]}x{src.size[1]}")

    icon_path = OUT / "stripe-icon-128x128.png"
    save_under_limit(src, icon_path, [128])

    logo_path = OUT / "stripe-logo-full.png"
    # Full-size: same artwork at highest square size under file limit
    for size in [1024, 768, 512]:
        candidate = src.resize((size, size), Image.Resampling.LANCZOS)
        candidate.save(logo_path, format="PNG", optimize=True)
        kb = logo_path.stat().st_size / 1024
        if logo_path.stat().st_size <= MAX_BYTES:
            print(f"Wrote {logo_path.name}: {size}x{size}, {kb:.1f} KB")
            return
    raise RuntimeError("Full logo exceeds size limit")


if __name__ == "__main__":
    main()
