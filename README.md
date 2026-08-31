# 桂桂 / GuiGui 官网

桂林航天工业学院校园网自动登录助手的官网。单文件静态站:双击 `site/index.html` 即可本地打开,
无构建步骤、无外部 CDN 依赖。

> 仅供桂林航天工业学院在校学生使用。本软件与桂林航天工业学院官方无关,系在校学生作品。

## 结构

```
site/               官网本体(静态,可直接托管)
  index.html
  assets/           校徽(完整横锁 + 圆盘水印)
  vendor/           桂桂 bot 动效(MIT,见文件头)
feedback-worker/    反馈 API(Cloudflare Worker + D1),见其 README
scripts/            部署辅助脚本
```

## 部署

- 主:Cloudflare Pages,输出目录 `site`(连本仓库自动部署)
- 备:任一服务器静态托管,把 `site/` 目录内容放到 web 根目录即可

## 反馈渠道

- 官网内反馈面板(Worker + D1,见 `feedback-worker/README.md`)
- 邮箱:kdy233@qq.com
