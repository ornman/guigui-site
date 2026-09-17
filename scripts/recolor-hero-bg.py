# -*- coding: utf-8 -*-
"""把 featurebase hero 原图(middleindigo992.jpg)改成白版,输出 site/assets/hero-bg.jpg。

HSV 保色相改色(2026-09-17 用户拍板「从色相和色彩种类找回质感」):
  H 色相  —— 原封不动(蓝黑/靛蓝翼/品红核心的色相漂移全保留)
  S 饱和度 —— 收到 62%(白版要轻,但各区域浓淡关系不变)
  V 明度  —— 反转(黑底→白底、亮光→暗结构)再 ×1.18 提曲线,让底真正到白
不走灰度、不做单色渐变映射——质感来源的色相种类不做任何压缩。
图源运行时拉取(不入库);纯自产路线见 gen-hero-bg.py。
用法:python scripts/recolor-hero-bg.py
"""
import io
import os
import urllib.request
from PIL import Image, ImageFilter

SRC = "https://www.featurebase.app/images/redesign3/middleindigo992.jpg"
req = urllib.request.Request(SRC, headers={"User-Agent": "Mozilla/5.0"})
raw = urllib.request.urlopen(req, timeout=30).read()
img = Image.open(io.BytesIO(raw)).convert("RGB")

h, s, v = img.convert("HSV").split()

s = s.point(lambda x: int(x * 0.62))                          # 饱和度 ×0.62:轻一档,浓淡关系保留
v = v.point(lambda x: min(255, int((255 - x) * 1.18)))       # 明度反转+提曲线,底色真正到白

out = Image.merge("HSV", (h, s, v)).convert("RGB")
out = out.filter(ImageFilter.GaussianBlur(0.5))              # 抹掉原 JPG 噪点

out.save("site/assets/hero-bg.jpg", quality=88)
print("OK site/assets/hero-bg.jpg", os.path.getsize("site/assets/hero-bg.jpg"), "bytes")
