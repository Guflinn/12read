# 从 1024 主图生成各尺寸 PNG、多尺寸 .ico 与预览图
# 用法：python tools/icon/make-ico.py
from PIL import Image
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BUILD = ROOT / "build"
SIZES = [256, 128, 64, 48, 32, 24, 16]

master = Image.open(BUILD / "icon-master-1024.png").convert("RGBA")

frames = {}
for s in SIZES:
    frames[s] = master.resize((s, s), Image.LANCZOS)

# build/icon.png（512，通用位图）
frames[512] = master.resize((512, 512), Image.LANCZOS)
frames[512].save(BUILD / "icon.png")

# build/icon.ico（多尺寸，electron-builder / Windows 资源用）
frames[256].save(BUILD / "icon.ico", sizes=[(s, s) for s in SIZES])

# 预览图：白底，横排 256 / 96 / 48 / 32 / 16，底对齐
row = [256, 96, 48, 32, 16]
gap = 40
w = sum(row) + gap * (len(row) + 1)
h = 256 + 80
sheet = Image.new("RGBA", (w, h), (255, 255, 255, 255))
x = gap
for s in row:
    img = master.resize((s, s), Image.LANCZOS)
    sheet.paste(img, (x, 40 + (256 - s)), img)
    x += s + gap
sheet.save(ROOT / "tools" / "icon" / "preview.png")

print("done:", [f"{s}px" for s in SIZES], "->", BUILD / "icon.ico")
