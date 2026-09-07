# 桂桂 / GuiGui 官网

桂林航天工业学院校园网自动登录助手的官网。单文件静态站:双击 `site/index.html` 即可本地打开,
无构建步骤、无外部 CDN 依赖。

> 仅供桂林航天工业学院在校学生使用。本软件与桂林航天工业学院官方无关,系在校学生作品。

## 结构

```
site/               官网本体(静态,可直接托管)
  index.html
  version.json      桌面端最新版号(诊断包 latest_ver 与更新检查共用)
  assets/           校徽(完整横锁 + 圆盘水印)
  vendor/           桂桂 bot 动效(MIT,见文件头)
functions/          反馈 API(Pages Functions,同域 /fb,免 CORS)
lib/                /fb v2 核心逻辑(纯函数 + adapter,函数薄壳)
tests/              node --test(npm test):校验/渲染/幂等/限频/预算/双槽
migrations/         D1 迁移(002 起 = /fb v2)
feedback-worker/    旧独立 Worker 版本(仅备份,不再演进)
scripts/            部署辅助脚本
```

## 部署

- 主:Cloudflare Pages,项目 `guigui-guat` → **https://guigui-guat.pages.dev**
  - 静态站 = `site/`;反馈 API = `functions/`(Pages Functions,同域 `/fb`,免 CORS)
  - 更新方式:仓库根目录 `npx wrangler pages deploy --branch=main`
- 备:任一服务器静态托管,把 `site/` 目录内容放到 web 根目录即可(`scripts/mirror-deploy.sh`)

## 反馈系统(/fb v2,2026-09-07)

全案设计:桌面仓 `docs/prd/guigui-feedback-system.md`(唯一正本)。

- **POST /fb**:v2 协议(桂桂桌面端真通道)——信封+诊断包七区 → D1 存底 +
  GitHub issue 投影(双槽容灾);v1 载荷(官网表单,无 `v` 字段)走兼容路径照常入库
- **POST /fb/reconcile?key=CRON_KEY**:对账端点(补建缺失 issue;调度器无关)
- **GET /fb/list?key=ADMIN_KEY**:管理端,含 pending_issues / gh_broken 健康区
- secrets:`GH_PAT`(fine-grained PAT,仅本仓 Issues 读写,90 天轮换)、
  `ADMIN_KEY`、`CRON_KEY`;vars:`GH_REPO`、`ISSUE_BUDGET_PER_HOUR`(默认 500)
- 仓已转私有(方案 A):issue 正文可含学号明文与完整诊断
- 看反馈:`https://guigui-guat.pages.dev/fb/list?key=<ADMIN_KEY>`
- 邮箱:kdy233@qq.com;Issue:https://github.com/ornman/guigui-site/issues

## 备注

- `feedback-worker/` 是独立 Worker 版本(同逻辑),仅作备份:其 workers.dev 域**国内不可达**,
  官网不走它;如需启用须绑自定义域名。主 API 在 `functions/`。

