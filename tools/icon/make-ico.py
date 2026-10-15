# 从 1024 主图生成各尺寸 PNG、多尺寸 .ico 与预览图
# 用法：python tools/icon/make-ico.py
from PIL import Image
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BUILD = ROOT / "build"
SIZES = [256, 128, 64, 48, 32, 24, 16]

master = Image.open(BUILD / "icon-master-1024.png").convert("RGBA")
alpha_min = master.getchannel("A").getextrema()[0]
if alpha_min != 0:
    raise SystemExit(f"主图没有全透明区域（alpha 最小值 {alpha_min}，omitBackground 失效？）——四角会变白")

frames = {}
for s in SIZES:
    frames[s] = master.resize((s, s), Image.LANCZOS)

# build/icon.png（512，通用位图）
frames[512] = master.resize((512, 512), Image.LANCZOS)
frames[512].save(BUILD / "icon.png")

# build/icon.ico（多尺寸，electron-builder / Windows 资源用）
frames[256].save(BUILD / "icon.ico", sizes=[(s, s) for s in SIZES])

# 预览图：上排深色（模拟桌面/任务栏），下排浅色；每排放 256 / 96 / 48 / 32 / 16，底对齐
row = [256, 96, 48, 32, 16]
gap = 48
w = sum(row) + gap * (len(row) + 1)
row_h = 300
h = row_h * 2
sheet = Image.new("RGBA", (w, h))
sheet.paste(Image.new("RGBA", (w, row_h), (32, 47, 44, 255)), (0, 0))        # 深色桌面
sheet.paste(Image.new("RGBA", (w, row_h), (240, 238, 233, 255)), (0, row_h))  # 浅色背景
for band_y in (0, row_h):
    x = gap
    for s in row:
        img = master.resize((s, s), Image.LANCZOS)
        sheet.paste(img, (x, band_y + row_h - 44 - s), img)
        x += s + gap
sheet.convert("RGB").save(ROOT / "tools" / "icon" / "preview.png")

print("done:", [f"{s}px" for s in SIZES], "->", BUILD / "icon.ico")
