"""
生成 Mz Hearken 的品牌图形。

设计约束（来自产品本身的视觉语言：大理石暖白 + 青铜、零圆角、碑刻衬线）：
  · 纯白底 + 墨色字，没有任何渐变、阴影、圆角
  · 衬线体：Georgia Bold（大写 MZ），Georgia（小字 HEARKEN，宽字距）
  · 「MZ」是主体，HEARKEN 只是署名 —— 所以字号差要拉开到 5:1 以上

⚠️ 小尺寸必须换一套画法：
  16/24/32/48 px 上，HEARKEN 只有 2~5 px 高，缩下去是一团墨点。
  所以 ≥64 用完整组合（MZ + HEARKEN），<64 只画 MZ（放大居中）。
  这不是偷懒，是所有正经图标系统都这么做（Apple/Windows 的图标栅格化也是这样分档）。

产出：
  build/icon.ico                      多尺寸（16/24/32/48/64/128/256）
  build/icon.png                      512（mac/linux 与通用场合）
  src/renderer/src/assets/brand-mark.png  256（界面左上角徽标）
"""

from io import BytesIO
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
ASSETS = ROOT / "src" / "renderer" / "src" / "assets"

INK = "#16130F"        # 与界面的 --ink 同源
PAPER = "#FFFFFF"
FONT_BOLD = r"C:\Windows\Fonts\georgiab.ttf"
FONT_REG = r"C:\Windows\Fonts\georgia.ttf"

S = 1024               # 先在大画布上画，再降采样，边缘才干净


def tracked_width(font: ImageFont.FreeTypeFont, text: str, tracking: float) -> float:
    return sum(font.getlength(ch) for ch in text) + tracking * (len(text) - 1)


def draw_tracked(
    draw: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.FreeTypeFont,
    baseline_y: float,
    center_x: float,
    tracking: float,
    fill: str = INK,
) -> None:
    """以 center_x 水平居中、以 baseline_y 为基线，逐字绘制（字距可调）。"""
    x = center_x - tracked_width(font, text, tracking) / 2
    for ch in text:
        draw.text((x, baseline_y), ch, font=font, fill=fill, anchor="ls")
        x += font.getlength(ch) + tracking


def cap_height(font: ImageFont.FreeTypeFont) -> float:
    box = font.getbbox("M")
    return box[3] - box[1]


def render_lockup() -> Image.Image:
    """完整组合：大写 MZ + 下方小字 HEARKEN（白色底）。"""
    img = Image.new("RGB", (S, S), PAPER)
    draw = ImageDraw.Draw(img)

    mz_font = ImageFont.truetype(FONT_BOLD, 452)
    hk_font = ImageFont.truetype(FONT_REG, 84)

    mz_cap = cap_height(mz_font)
    hk_cap = cap_height(hk_font)
    gap = 86                       # MZ 底边到 HEARKEN 顶边
    block = mz_cap + gap + hk_cap
    top = (S - block) / 2
    mz_baseline = top + mz_cap
    hk_baseline = mz_baseline + gap + hk_cap

    draw_tracked(draw, "MZ", mz_font, mz_baseline, S / 2, tracking=-14)
    draw_tracked(draw, "HEARKEN", hk_font, hk_baseline, S / 2, tracking=21)
    return img


def render_monogram() -> Image.Image:
    """小尺寸专用：只有 MZ，尽量占满画面。"""
    img = Image.new("RGB", (S, S), PAPER)
    draw = ImageDraw.Draw(img)
    mz_font = ImageFont.truetype(FONT_BOLD, 604)
    mz_cap = cap_height(mz_font)
    # 视觉居中：字母上下都留一点气，但比完整组合紧得多
    baseline = (S + mz_cap) / 2 - 14
    draw_tracked(draw, "MZ", mz_font, baseline, S / 2, tracking=-22)
    return img


def png_bytes(image: Image.Image) -> bytes:
    buf = BytesIO()
    image.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def write_ico(entries: list[tuple[int, bytes]], out: Path) -> None:
    """
    手工封装 ICO：Vista 起每项都可以直接放 PNG（带 alpha），
    这样每个尺寸都能用**各自的画法**，而不是把一张图缩放到所有尺寸。
    """
    count = len(entries)
    header = (0).to_bytes(2, "little") + (1).to_bytes(2, "little") + count.to_bytes(2, "little")
    offset = 6 + 16 * count
    directory = b""
    payload = b""
    for size, data in entries:
        dim = 0 if size >= 256 else size
        directory += (
            bytes([dim, dim, 0, 0])
            + (1).to_bytes(2, "little")      # planes
            + (32).to_bytes(2, "little")     # bit depth
            + len(data).to_bytes(4, "little")
            + offset.to_bytes(4, "little")
        )
        payload += data
        offset += len(data)
    out.write_bytes(header + directory + payload)


def fit_art(image: Image.Image, ratio: float) -> Image.Image:
    """
    把画好的墨迹裁到包围盒，再等比缩放到占画布 ratio、居中放回白底。

    为什么要这道工序：手调字号很容易让字顶到边（我在 monogram 上就踩了：
    M 的左边衬线直接贴边，16px 下显得憋屈）。按墨迹包围盒自动内缩，
    两个图共用同一套边距规则，缩到任何尺寸都不会莫名其妙地贴边或偏心。
    """
    rgb = image.convert("RGB")
    diff = ImageChops.difference(rgb, Image.new("RGB", rgb.size, PAPER))
    bbox = diff.getbbox()
    if bbox is None:
        return image
    cropped = rgb.crop(bbox)
    target = S * ratio
    scale = min(target / cropped.width, target / cropped.height)
    size = (max(1, round(cropped.width * scale)), max(1, round(cropped.height * scale)))
    resized = cropped.resize(size, Image.LANCZOS)
    canvas = Image.new("RGB", (S, S), PAPER)
    canvas.paste(resized, ((S - size[0]) // 2, (S - size[1]) // 2))
    return canvas


def main() -> None:
    BUILD.mkdir(parents=True, exist_ok=True)
    ASSETS.mkdir(parents=True, exist_ok=True)

    # 统一边距：完整组合留白大一点（有署名行压底），单字标可以更满
    lockup = fit_art(render_lockup(), 0.80)
    monogram = fit_art(render_monogram(), 0.86)

    # 通用 PNG（mac/linux/文档用）
    lockup.resize((512, 512), Image.LANCZOS).save(BUILD / "icon.png", optimize=True)

    # 界面徽标：只要 MZ 单字标，白色方块，和任务栏图标同源
    monogram.resize((256, 256), Image.LANCZOS).save(ASSETS / "brand-mark.png", optimize=True)

    entries: list[tuple[int, bytes]] = []
    for size in (16, 24, 32, 48, 64, 128, 256):
        source = lockup if size >= 64 else monogram
        entries.append((size, png_bytes(source.resize((size, size), Image.LANCZOS))))
    write_ico(entries, BUILD / "icon.ico")

    print("生成完成：")
    for path in (BUILD / "icon.ico", BUILD / "icon.png", ASSETS / "brand-mark.png"):
        print(f"  {path.relative_to(ROOT)}  {path.stat().st_size} bytes")


if __name__ == "__main__":
    main()
