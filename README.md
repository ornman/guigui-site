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

- 主:Cloudflare Pages,项目 `guigui-guat` → **https://guigui-guat.pages.dev**
  - 静态站 = `site/`;反馈 API = `functions/`(Pages Functions,同域 `/fb`,免 CORS)
  - 更新方式:仓库根目录 `npx wrangler pages deploy --branch=main`
- 备:任一服务器静态托管,把 `site/` 目录内容放到 web 根目录即可(`scripts/mirror-deploy.sh`)

## 反馈渠道

- 官网内反馈面板:提交 → 同域 `/fb`(Pages Functions + D1)→ 返回编号
- 看反馈:`https://guigui-guat.pages.dev/fb/list?key=<ADMIN_KEY>`
  (密钥在本机 `guigui-site/.admin-key`,已 gitignore)
- 邮箱:kdy233@qq.com;Issue:https://github.com/ornman/guigui-site/issues

## 备注

- `feedback-worker/` 是独立 Worker 版本(同逻辑),仅作备份:其 workers.dev 域**国内不可达**,
  官网不走它;如需启用须绑自定义域名。主 API 在 `functions/`。

