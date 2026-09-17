# -*- coding: utf-8 -*-
"""把 featurebase hero 原图(middleindigo992.jpg)改成白版,输出 site/assets/hero-bg.jpg。

只反转颜色(2026-09-17 用户终版拍板):整体亮度反相 → 收染色强度 → 白→紫渐变映射
→ 轻度去噪。无分层、无叶片柱位检测。
图源运行时拉取(不入库);纯自产路线见 gen-hero-bg.py。
用法:python scripts/recolor-hero-bg.py
"""
import io
import os
import urllib.request
from PIL import Image, ImageOps, ImageFilter

SRC = "https://www.featurebase.app/images/redesign3/middleindigo992.jpg"
req = urllib.request.Request(SRC, headers={"User-Agent": "Mozilla/5.0"})
raw = urllib.request.urlopen(req, timeout=30).read()
img = Image.open(io.BytesIO(raw)).convert("L")

inv = ImageOps.invert(img)                                  # 黑→白,亮光→暗结构,亮叶片→暗玻璃缝
inv = inv.point(lambda v: 255 - int((255 - v) * 0.72))      # 最深处只染到 72%,白版要轻
out = ImageOps.colorize(inv, black=(120, 85, 241), white=(253, 253, 253))
out = out.filter(ImageFilter.GaussianBlur(0.6))             # 抹掉原 JPG 噪点

out.save("site/assets/hero-bg.jpg", quality=88)
print("OK site/assets/hero-bg.jpg", os.path.getsize("site/assets/hero-bg.jpg"), "bytes")
