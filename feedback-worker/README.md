# guigui-feedback — 官网反馈 API(Cloudflare Worker + D1)

官网 Fig.04 反馈面板的后端。纯静态官网不收集任何数据;只有用户主动点「提交反馈」才会
POST 到本服务,存进 D1,返回一个反馈编号。

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/fb` | 提交 `{ what, when, contact, log }`,返回 `{ ok, id: "GG-X" }` |
| GET | `/fb/list?key=管理密钥` | 拉取最近 200 条(浏览器直接访问即可) |

- 每 IP 每小时限 8 条;所有字段按长度截断后入库
- IP 只用于限流与排查,不用于其他用途

## 部署(一次性,约 3 分钟)

前置:装了 Node,在本目录执行。第一步需要浏览器登录 Cloudflare 授权。

```bash
# 1. 登录 Cloudflare(浏览器点一次同意)
npx wrangler login

# 2. 建 D1 数据库,把输出的 database_id 填进 wrangler.jsonc
npx wrangler d1 create guigui-feedback

# 3. 建表 + 设管理密钥 + 部署
npx wrangler d1 execute guigui-feedback --remote --file=schema.sql
npx wrangler secret put ADMIN_KEY        # 随便一串足够长的随机字串
npx wrangler deploy
```

部署成功后拿到 `https://guigui-feedback.<你的子域>.workers.dev`:

1. 把地址填进 `site/index.html` 里脚本开头的 `FB_ENDPOINT`(结尾带 `/fb`)
2. 把 `wrangler.jsonc` 的 `ALLOWED_ORIGIN` 改成官网域名并重新 `deploy`
3. 仓库未公开期间,Issues chip 继续保持占位

## 看反馈

浏览器打开 `https://…workers.dev/fb/list?key=<ADMIN_KEY>` 即可;后续可按需加个更好看的管理页。
