/* 官网旧版反馈板反代退役(2026-09-26)。
 *
 * 历史:feedlog 早期挂为官网子页面,本页面前缀(/zh /en /_nuxt /api 等)
 *       反代到 cloudflared 快速隧道(months-neon-though-declaration.trycloudflare.com)。
 *       2026-09-26 feedlog 已迁至 xiaopozhan,新公网域名 feedback.coro0.top,
 *       旧 trycloudflare 容器已撤,继续反代=1016 Origin DNS 错误。
 *
 * 现状:首页两入口(href=/zh)已改指 feedback.coro0.top/zh 绝对地址,
 *      不再依赖本中间件转发;保留本中间件仅作老书签 301 跳转。
 *
 * Why:旧 /zh /en 等路径只走跳转(不反代),避免 cloudflared 域名轮换
 *     / 容器重建 / 隧道死掉的活伤;新域名自有 HTTPS 与 cookie 域。
 */
const NEW_BASE = "https://feedback.coro0.top";
const PREFIXES = ["/zh", "/en", "/_nuxt", "/api", "/_ipx", "/__nuxt", "/docs"];

function shouldRedirect(pathname) {
  return PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);
  if (!shouldRedirect(url.pathname)) return next();
  // 路径直搬(保留 query);en 旧路径仍跳到 /zh(feedlog 已删 /en,英文归一中文)
  const target = NEW_BASE + url.pathname.replace(/^\/en(\/|$)/, "/zh$1") + url.search;
  return Response.redirect(target, 301);
}
