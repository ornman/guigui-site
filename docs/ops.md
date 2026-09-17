# Ops 手册 · guigui-site(官网仓)

> 治理文档之一。本仓独立 git 历史;桌面仓 ops.md 见 `auto-login/docs/gov/ops.md`,那边管
> 构建链(`build_guigui.bat` / Inno / 真机验收),这里只管 **官网侧的构建、发版、运行时**。
>
> 与桌面仓的边界:桌面仓不写 `site/version.json`,只产出 `guigui-setup-<latest>.exe`;
> 官网仓把桌面仓产物当作输入(`scripts/mirror-deploy.sh` 镜像到主源 +
> `site/version.json` schema 是 exe 元数据的唯一正本)。

---

## 1. 构建链(官网侧)

本仓无构建步骤——`site/` = 静态资产,直接托管。

- 校验:`npm test`(= `node --test tests/*.test.mjs`),覆盖 `/download` 计数链路
  (`assetFor` / `resolveAsset` / `handleDownload` / `aggregate` / `handleDlList` /
  `handleDlCount`)。**改 lib/dl-core.js 必须先看 tests/dl.test.mjs 是否需要扩**。
- 本地预览:`cd site && python -m http.server 8000`,浏览器开
  `http://localhost:8000/index.html`(`/download` 跳板走 CF Pages Functions,
  本地不会触发,只看静态部分)。
- LFS / 构建工具:**均无**——任何 PR 引入 `package.json` 之外的依赖都要单独评审
  (首页严守零 CDN/零 npm 运行时依赖,见 README §结构)。

## 2. 发版(2.2.0 起的更新机制)

桌面 2.2.0 加了一键更新(updater + 横幅提醒),官网必须先把 `site/version.json` 的
**schema** 升到位(对老客户端零影响,先于桌面端发),桌面端再读 sha256 校验下载包。

### 2.1 发版流程(按顺序,缺一即空发)

```
[1] 桌面仓 → 跑 build_guigui.bat → 出 guigui-setup-<ver>.exe(在 dist\guigui\Output\)
[2] 桌面仓 → 跑 scripts/compute_release.py --exe <新包> --version-json ../guigui-site/site/version.json
       └─ 回写 sha256 / size_mb / latest / released_at(notes 手动补,版本号写后)
       └─ 只改这四个字段;min_version 仅事故版催升线临时写,下次发版删除
       └─ 用 Python 写 JSON,不走 bash heredoc(2026-09-16 教训:\\\ 转义被吞)
[3] 官网仓 → bash scripts/mirror-deploy.sh
       └─ 把新 exe scp 到 dl.yaoxiumax.top(103.236.55.179 主源,探活 60s TTL 自动切)
       └─ REMOTE_USER / REMOTE_PATH 留 TODO 占位,SSH 免密配置后填(2026-09-18 现状)
[4] 官网仓 → npx wrangler pages deploy --branch=main
       └─ CF Pages 自动部署 site/ 子目录 → guigui-guat.pages.dev
       └─ version.json 随主仓部署同步上线,无需单独传
```

### 2.2 version.json schema(2026-09-18 加 min_version,见 §3 官网侧改造)

```jsonc
{
  "latest": "2.2.0",          // 版本元数据(version metadata)
  "released_at": "2026-09-XX",// 版本元数据
  "notes": "…",               // 版本元数据(中文一句话,可空)
  "size_mb": 24,              // 下载元数据(download meta)
  "sha256": "5f31…dcc7",      // 下载元数据(必填,desktop compute_release.py 写)
  "dl_base": "https://dl.yaoxiumax.top",  // 下载元数据(主源域名)
  "min_version": null         // 下载元数据(可选,事故版催升线写,下次发版删)
}
```

字段顺序按 schema 语义排:**version metadata 先**(latest / released_at / notes),
**download meta 后**(size_mb / sha256 / dl_base / min_version)。

- `min_version` 字段缺失或 `null` = **不催**;客户端读不到字段自动按不催处理
  (向后兼容先行)。
- 老客户端(< 2.2.0)不读 `sha256` / `min_version`,新增字段对它零影响。

### 2.3 验收(发版后)

桌面端 updater 真机 UAT 在桌面仓做(含火绒拦「拉起安装器」实测);
官网侧验收:

- `curl -I https://dl.yaoxiumax.top/guigui-setup-<ver>.exe` → 200 + Content-Length
- `curl https://guigui-guat.pages.dev/version.json` → sha256 与桌面仓一致
- `curl https://guigui-guat.pages.dev/download/count` → `sha256` 字段非 null(透传)
- 浏览器开 `https://guigui-guat.pages.dev` 看下载区 SHA 区显示的是 **live 哈希**
  (不是灰化兜底),且「已下载 · N 次」计数行可见。

## 3. 运行时面(部署后都在哪)

| 什么 | 在哪 |
|---|---|
| 静态站 | `site/`(CF Pages `guigui-guat` 项目 → https://guigui-guat.pages.dev) |
| 下载主源 | dl.yaoxiumax.top(103.236.55.179,深圳电信;只服务 exe,官网页面不走它) |
| 下载兜底 | guigui-guat.pages.dev 同域(Cloudflare 免费版,国内慢但不死) |
| 计数库 | Cloudflare D1(表 `download_events`,迁移 003) |
| 反馈库 | Cloudflare D1(同 D1,表见 migrations/002) |
| 反馈投影 | GitHub Issues(`ornman/guigui-site` 私有仓,fine-grained PAT) |
| Secrets | GH_PAT / ADMIN_KEY / CRON_KEY(在 CF Pages 环境变量) |
| Vars | GH_REPO / ISSUE_BUDGET_PER_HOUR / FB_BUDGET_* |

## 4. 坑表(踩过一次就记,新坑入表)

| 坑 | 症状/教训 | 解法 |
|---|---|---|
| `ASSETS` 绑定 HEAD/Range/GET 全不给 Content-Length | 生产实测:CF Pages `env.ASSETS.fetch()` 调静态资产,HEAD 无 `Content-Length`、Range 被吞、GET 不附长;**head 读完即 cancel 不能拉到 body** | 探大小唯一可靠路 = **公网自域 GET 头**(`dl-core.js:assetSize`,HEAD 优先 + Range GET 兜底 + 头读完即 cancel);`version.json.size_mb` 是兜底兜底 |
| `onRequestGet` 与 HEAD 请求不匹配虚惊 | `handleDownload` 用 `onRequestGet` 暴露的请求对象去测 HEAD,生产环境报 method-not-allowed | `/download` 用普通 `get` 路径,探活用独立 `fetch` + 自定义 UA 防 Bot Fight Mode |
| bash heredoc 写 JSON `\\` 被吞 | `\\\u` 被 bash 吃成 `\u`,JSON 解析报 Invalid \escape | JSON 一律 Python `json.dump` 写,不走 heredoc |
| `compute_release.py` 改坏 version.json schema | 手工 `latest` 写错版本号 / 漏 `released_at` / 把 `min_version` 留到下次发版 | 跑完 `python -m json.tool site/version.json` + `git diff site/version.json` 双确认;`min_version` 仅事故版催升线写,下次发版必删 |
| mirror-deploy.sh REMOTE_* 留 TODO 未填 | scp 无处可推 → 桌面仓有新版,主源却没 exe → 用户走 `/download` 拿到主源 404 | 发版前先确认 `REMOTE_USER@$REMOTE_HOST:$REMOTE_PATH` 已填(SSH 免密配通)再跑;`scp` 退出非零即停 |
| `npx wrangler pages deploy` 把 secrets 传上去 | `--branch=main` 默认传所有环境变量(2026-09-17 教训) | secrets 只在 CF Dashboard / `wrangler secret put` 配,deploy 命令**不带**任何 `--secret` 参数;`.dev.vars` 加进 `.gitignore` |
| D1 表 schema 改了但忘写迁移 | 查询直接报「no such column」 | 改表必须新建 `migrations/<N+1>-*.sql`,`wrangler d1 migrations apply <DB>` 后再 deploy functions |
| CF Pages Functions 缓存了旧 env | 改 `.dev.vars` 后本地能跑,生产还吃旧值 | `wrangler pages dev` 本地必重启;生产改动走 CF Dashboard env,deploy 自动重新绑定 |
| GH_PAT 90 天到期无轮换 | 反馈投影一夜 401,issue 双槽未补建 | 设日历提醒(到期前 14 天),新 PAT 走 fine-grained 仅 Issues 读写 |

## 5. 回滚

- **静态站** = `git revert`(本仓本地 `main` 即正本,推到 `origin/main` 自动部署);
  回滚 `site/version.json` 立即生效(`cache-control: public, max-age=300` 仅 `/download/count`)。
- **下载主源** = 镜像前可 `rm $REMOTE /guigui-setup-<ver>.exe`(让 `/download` 走
  Cloudflare 同域兜底);桌面仓已发的 exe 不回收(用户手里的是稳定副本)。
- **计数 / 反馈** = D1 不随仓库回滚,出问题手工修表或重建 issue 投影。
- **Functions** = `git revert` 同步回滚代码;`migrations/` 不可逆(新增迁移只能补,
  不能回删,否则计数 / 反馈历史断裂)。