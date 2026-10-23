"""
生成 Mz Hearken 的品牌图形 —— 源图是用户上传的那张（build/logo-source.png）。

源图结构（用行方向墨迹投影量出来的，不是手填的坐标）：
    y 304..776   字标（M + 音符 + 声波）
    y 824..888   文字行「M Z  HEARKEN」
    y 912..984   装饰分隔波

为什么要按段切：整图塞进 16/32px 只会糊成一团墨。
所以分两套画法（这是图标系统的常规做法）：
    · full  —— 字标 + 文字行 + 分隔波（整幅作品），用于 256px 大图标 / README / mac-icon
    · mark  —— 只有字标，用于 ≤128px 与界面左上角徽标

产出：
    build/icon.ico                           7 档（256 用 full，其余用 mark）
    build/icon.png                           512（full）
    src/renderer/src/assets/brand-mark.png   256（mark，界面徽标）
"""

from pathlib import Path

from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
ASSETS = ROOT / "src" / "renderer" / "src" / "assets"
SOURCE = BUILD / "logo-source.png"

S = 1024                 # 统一在大画布上排版，再降采样
PAPER = (255, 255, 255)
INK_THRESHOLD = 235      # 低于这个通道值算作墨迹（金色部分也吃得住）

# 源图里的分段（由 ink-band 测量得出，见文件头说明）
BAND_MONOGRAM = (0, 300, 1254, 790)     # 字标：M + 音符 + 声波
BAND_FULL = (0, 300, 1254, 1000)        # 整幅作品：再加文字行与分隔波


def load_source() -> Image.Image:
    if not SOURCE.exists():
        raise SystemExit(f"缺少源图：{SOURCE}")
    image = Image.open(SOURCE).convert("RGB")
    if image.size != (1254, 1254):
        print(f"注意：源图尺寸 {image.size}，分段坐标是按 1254×1254 量的，可能偏")
    return image


def ink_mask(image: Image.Image) -> Image.Image:
    """把「有墨」的地方标成白、背景标成黑，交给 getbbox 求包围盒。"""
    gray = image.convert("L")
    return gray.point(lambda value: 255 if value < INK_THRESHOLD else 0)


def crop_ink(image: Image.Image) -> Image.Image:
    bbox = ink_mask(image).getbbox()
    if bbox is None:
        raise SystemExit("源图里找不到墨迹")
    return image.crop(bbox)


def to_canvas(image: Image.Image, ratio: float) -> Image.Image:
    """等比缩放到占画布 ratio，居中放在纯白底上。"""
    scale = min(S * ratio / image.width, S * ratio / image.height)
    size = (max(1, round(image.width * scale)), max(1, round(image.height * scale)))
    canvas = Image.new("RGB", (S, S), PAPER)
    canvas.paste(image.resize(size, Image.LANCZOS), ((S - size[0]) // 2, (S - size[1]) // 2))
    return canvas


def png_bytes(image: Image.Image) -> bytes:
    from io import BytesIO

    buf = BytesIO()
    image.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def write_ico(entries: list[tuple[int, bytes]], out: Path) -> None:
    """手工封装 ICO：每档放各自的 PNG（Vista 起支持），这样不同尺寸能用不同画法。"""
    count = len(entries)
    header = (0).to_bytes(2, "little") + (1).to_bytes(2, "little") + count.to_bytes(2, "little")
    offset = 6 + 16 * count
    directory = b""
    payload = b""
    for size, data in entries:
        dim = 0 if size >= 256 else size
        directory += (
            bytes([dim, dim, 0, 0])
            + (1).to_bytes(2, "little")
            + (32).to_bytes(2, "little")
            + len(data).to_bytes(4, "little")
            + offset.to_bytes(4, "little")
        )
        payload += data
        offset += len(data)
    out.write_bytes(header + directory + payload)


def main() -> None:
    source = load_source()

    monogram = crop_ink(source.crop(BAND_MONOGRAM))
    full = crop_ink(source.crop(BAND_FULL))

    # 整幅作品留白多一些（内容更密），字标可以更满
    full_art = to_canvas(full, 0.80)
    mark_art = to_canvas(monogram, 0.88)

    BUILD.mkdir(parents=True, exist_ok=True)
    ASSETS.mkdir(parents=True, exist_ok=True)

    full_art.resize((512, 512), Image.LANCZOS).save(BUILD / "icon.png", optimize=True)
    mark_art.resize((256, 256), Image.LANCZOS).save(ASSETS / "brand-mark.png", optimize=True)

    entries: list[tuple[int, bytes]] = []
    for size in (16, 24, 32, 48, 64, 128, 256):
        # 只有 256 用整幅作品：更小的尺寸上文字行只有几像素高，留着就是脏点
        art = full_art if size >= 256 else mark_art
        entries.append((size, png_bytes(art.resize((size, size), Image.LANCZOS))))
    write_ico(entries, BUILD / "icon.ico")

    print("logo 生成完成：")
    for path in (BUILD / "icon.ico", BUILD / "icon.png", ASSETS / "brand-mark.png"):
        print(f"  {path.relative_to(ROOT)}  {path.stat().st_size} bytes")
    print(f"  字标包围盒 {monogram.size}，整幅包围盒 {full.size}")


if __name__ == "__main__":
    main()
