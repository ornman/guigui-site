# -*- coding: utf-8 -*-
"""生成官网 Hero 背景白版整图(featurebase 构图的自由复刻,自有资产)。

构图参考(读原图提取):三团紫色高光构成 V 形 —— 左(12%/62%)、右(88%/62%)、
底部中央(50%/105%);13 根通高磨砂玻璃缝,只在光带处显形,白区隐没。
用法:python scripts/gen-hero-bg.py  → site/assets/hero-bg.jpg
"""
from PIL import Image, ImageDraw, ImageFilter

W, H = 1920, 1186
WHITE = (253, 253, 253)
VIOLET = (139, 92, 246)      # 两翼
INDIGO = (109, 77, 232)      # 底部中央


def blob(w, h, color, peak_alpha):
    """平滑径向光团:小图上画椭圆重模糊成高斯衰减,再放大上色。"""
    s = 320
    m = Image.new("L", (s, s), 0)
    ImageDraw.Draw(m).ellipse([s * 0.16, s * 0.16, s * 0.84, s * 0.84], fill=255)
    m = m.filter(ImageFilter.GaussianBlur(s * 0.24))
    m = m.resize((w, h), Image.LANCZOS)
    layer = Image.new("RGBA", (w, h), color + (255,))
    layer.putalpha(m.point(lambda v: int(v * peak_alpha / 255)))
    return layer


canvas = Image.new("RGBA", (W, H), WHITE + (255,))

# ── 三团紫光(V 形):左翼 / 右翼 / 底部中央 ──
wing = blob(int(W * 0.62), int(W * 0.62 * 0.9), VIOLET, 100)   # 半径 ≈ 31% 宽
canvas.alpha_composite(blob_layer := wing, (int(W * 0.12) - wing.width // 2,
                                            int(H * 0.62) - wing.height // 2))
canvas.alpha_composite(wing, (int(W * 0.88) - wing.width // 2,
                              int(H * 0.62) - wing.height // 2))
bottom = blob(int(W * 0.72), int(W * 0.72 * 0.75), INDIGO, 80)
canvas.alpha_composite(bottom, (int(W * 0.50) - bottom.width // 2,
                                int(H * 1.05) - bottom.height // 2))

# ── 13 根通高磨砂玻璃缝:条内高斯模糊 + 白色薄纱 + 左亮边右暗边 ──
N = 13
pitch = W / N
strip_w = pitch * 0.86
composed = canvas.convert("RGB")
frosted = composed.copy()
for i in range(N):
    x0 = int(i * pitch + (pitch - strip_w) / 2)
    x1 = int(x0 + strip_w)
    region = composed.crop((x0, 0, x1, H)).filter(ImageFilter.GaussianBlur(7))
    # 白色薄纱(让缝在白区依然若有若无)
    veil = Image.new("RGBA", (x1 - x0, H), (255, 255, 255, 26))
    region = Image.alpha_composite(region.convert("RGBA"), veil)
    frosted.paste(region.convert("RGB"), (x0, 0))
    # 边线:左白亮边 / 右极淡深边(1.5px)
    d = ImageDraw.Draw(frosted, "RGBA")
    d.rectangle([x0, 0, x0 + 1, H], fill=(255, 255, 255, 110))
    d.rectangle([x1 - 1, 0, x1, H], fill=(36, 31, 51, 14))

# ── 底部 12% 渐隐回纯白(与 hero 下方内容无缝相接)──
fade = Image.new("L", (1, int(H * 0.12)), 0)
for y in range(fade.height):
    fade.putpixel((0, y), int(255 * y / fade.height))
fade = fade.resize((W, int(H * 0.12)))
white = Image.new("RGB", (W, int(H * 0.12)), WHITE)
frosted.paste(white, (0, H - fade.height), fade)

out = frosted.convert("RGB")
out.save("site/assets/hero-bg.jpg", quality=88)
import os
print("OK site/assets/hero-bg.jpg", os.path.getsize("site/assets/hero-bg.jpg"), "bytes")
