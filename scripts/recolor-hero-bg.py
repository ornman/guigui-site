# -*- coding: utf-8 -*-
"""把 featurebase hero 原图(middleindigo992.jpg)改成白版,输出 site/assets/hero-bg.jpg。

分层策略(2026-09-17 用户拍板「亮叶片不用翻」):
  光团层 = 原图重度模糊(细叶片消失,只剩紫光结构)→ 反相 → 收强度 → 白→紫渐变映射
           (黑底→白底、亮紫光→淡紫染色)
  叶片层 = 原图 − 模糊底(细亮竖缝+亮边残差)→ 不翻,作为白色高光叠回(玻璃缝保持亮)
图源运行时拉取(不入库);纯自产路线见 gen-hero-bg.py。
用法:python scripts/recolor-hero-bg.py
"""
import io
import os
import urllib.request
from PIL import Image, ImageOps, ImageFilter, ImageChops

SRC = "https://www.featurebase.app/images/redesign3/middleindigo992.jpg"
req = urllib.request.Request(SRC, headers={"User-Agent": "Mozilla/5.0"})
raw = urllib.request.urlopen(req, timeout=30).read()
img = Image.open(io.BytesIO(raw)).convert("L")

# ── 光团层:只剩紫光,反相染色 ──
glow = img.filter(ImageFilter.GaussianBlur(50))              # 细叶片融进底,光团保留
inv = ImageOps.invert(glow)                                  # 黑底→白、亮光→暗结构
inv = inv.point(lambda v: 255 - int((255 - v) * 0.72))       # 最深处只染到 72%
base = ImageOps.colorize(inv, black=(120, 85, 241), white=(253, 253, 253))

# ── 叶片层:细亮竖缝+亮边(高于局部底的残差),不翻,叠白色高光 ──
detail = ImageChops.subtract(img, glow).filter(ImageFilter.GaussianBlur(0.8))
mask = detail.point(lambda v: min(255, int(v * 1.5)))        # 稍增益,玻璃缝明确亮起来
paper = Image.new("RGB", base.size, (253, 253, 253))
out = Image.composite(paper, base, mask)                     # 残差亮处→提白,其余保留染色

out.save("site/assets/hero-bg.jpg", quality=88)
print("OK site/assets/hero-bg.jpg", os.path.getsize("site/assets/hero-bg.jpg"), "bytes")
