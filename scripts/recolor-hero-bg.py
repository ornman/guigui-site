# -*- coding: utf-8 -*-
"""把 featurebase hero 原图(middleindigo992.jpg)改成白版,输出 site/assets/hero-bg.jpg。

HSV 保色相 + 底色键控美白(2026-09-17 用户两连拍板「从色相找回质感」+「底要是白版」):
  H 色相   —— 原封不动(蓝黑底/靛蓝翼/品红核心的色相漂移全保留)
  V 明度   —— 反转(黑底→白底、亮光→暗结构)×1.18 提曲线
  S 饱和度 —— 按反转后明度键控:亮处(=原黑底)收到 4%=真白;
              暗处(=光团/玻璃缝结构)保持 62%,色相质感在;205-250 之间平滑过渡
  (病根:单纯保 S 会把原蓝黑底的色度一起保留,翻亮后底色发紫蓝,不再是白)
图源运行时拉取(不入库);纯自产路线见 gen-hero-bg.py。
用法:python scripts/recolor-hero-bg.py
"""
import io
import os
import urllib.request
from PIL import Image, ImageChops, ImageFilter

SRC = "https://www.featurebase.app/images/redesign3/middleindigo992.jpg"
req = urllib.request.Request(SRC, headers={"User-Agent": "Mozilla/5.0"})
raw = urllib.request.urlopen(req, timeout=30).read()
img = Image.open(io.BytesIO(raw)).convert("RGB")

h, s, v = img.convert("HSV").split()

# 连续重映射(不做阈值二分——实测 S 处处 98-184 分不开,原图是连续亮度场):
# 原图明度 → 染色强度 t(0-255,伽马 1.3 拉开暗部);t 同时驱动变深(V)与变浓(S),
# 底自动纯白、淡雾自动极淡、光团核心与亮叶片浓——色相 H 全程不动
t = v.point(lambda x: 0 if x <= 25 else (255 if x >= 160 else int((x - 25) * 255 / 135)))
t = t.point(lambda x: int((x / 255) ** 1.5 * 255))

s2 = ImageChops.multiply(s, t).point(lambda x: int(x * 0.85))
v2 = t.point(lambda x: 255 - int(x * 135 / 255))            # 最深 120,不闷黑

out = Image.merge("HSV", (h, s2, v2)).convert("RGB")
out = Image.blend(out, Image.new("RGB", out.size, (253, 253, 253)), 0.12)  # 整体再向纸白靠一档
out = out.filter(ImageFilter.GaussianBlur(0.5))              # 抹掉原 JPG 噪点

out.save("site/assets/hero-bg.jpg", quality=88)
print("OK site/assets/hero-bg.jpg", os.path.getsize("site/assets/hero-bg.jpg"), "bytes")
