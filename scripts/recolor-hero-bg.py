# -*- coding: utf-8 -*-
"""把 featurebase hero 原图(middleindigo992.jpg)改成白版,输出 site/assets/hero-bg.jpg。

分层策略(2026-09-17 用户三连拍板「用他们的图改颜色」「亮叶片不用翻」「叶片用原图、不要高度模糊」):
  光团层 = 原图重度模糊(只剩紫光结构)→ 反相 → 收强度 → 白→紫渐变映射(黑底→白、亮光→淡紫染色)
  叶片层 = 列剖面检测叶片柱位(列均值 − 低通基线 = 窄峰)→ 柱位 Feather 出全高竖带遮罩,
           遮罩强度 = **原图原始亮度**(不经模糊,结构清晰)→ 叠白色高光,玻璃缝保持亮且锐
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
W, H = img.size

# ── 光团层:模糊后反相染色(这层要的就是平滑,叶片柱位不靠它)──
glow = img.filter(ImageFilter.GaussianBlur(50))
inv = ImageOps.invert(glow)
inv = inv.point(lambda v: 255 - int((255 - v) * 0.72))
base = ImageOps.colorize(inv, black=(120, 85, 241), white=(253, 253, 253))

# ── 叶片柱位:列均值剖面减低通基线,窄峰即叶片带 ──
profile = img.resize((W, 1), Image.BOX)                       # 每列均值
baseline = profile.resize((max(1, W // 7), 1), Image.BOX).resize((W, 1), Image.BILINEAR)
p, b = profile.getdata(), baseline.getdata()
cols = [1 if p[i] - b[i] > 5 else 0 for i in range(W)]        # 峰值>5 灰阶 = 叶片柱
colmask = Image.new("L", (W, 1))
colmask.putdata(cols)
colmask = colmask.resize((W, H), Image.NEAREST).filter(ImageFilter.GaussianBlur(5))  # 边缘羽化

# ── 叶片亮度 = 原图原始亮度(不模糊),柱位内归一提升 ──
norm = img.point(lambda v: 0 if v <= 60 else (255 if v >= 200 else (v - 60) * 255 // 140))
mask = ImageChops.multiply(colmask, norm).filter(ImageFilter.GaussianBlur(0.5))

paper = Image.new("RGB", base.size, (253, 253, 253))
out = Image.composite(paper, base, mask)                      # 叶片柱亮处→原图结构的白,其余保留染色

out.save("site/assets/hero-bg.jpg", quality=88)
print("OK site/assets/hero-bg.jpg", os.path.getsize("site/assets/hero-bg.jpg"), "bytes")
