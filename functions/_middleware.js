/* 官网旧版反馈板反代退役(2026-09-26)。
 *
 * 历史:feedlog 早期挂为官网子页面,本页面前缀(/zh /en /_nuxt /api 等)
 *       反代到 cloudflared 快速隧道(months-neon-though-declaration.trycloudflare.com)。
 *       2026-09-26 feedlog 已迁至 xiaopozhan,新公网域名 feedback.coro0.top,
 *       旧 trycloudflare 容器已撤,继续反代=1016 Origin DNS 错误。
 *
 * 现状:
 *   - 首页两入口(href=feedback.coro0.top/)已改指绝对地址,不再依赖本中间件
 *   - feedlog 已切 defaultLocale=zh / 删英文 locale:根地址 / 直接中文,
 *     /zh 路由已不存在(404),/en 也 404
 *   - 保留本中间件仅作老书签 301 跳转:/zh /en /_nuxt /api /_ipx 等老路径
 *     全部跳到根 /
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
  // 老路径(/zh /en /_nuxt 等)统一跳根,query 保留;feedlog 已不识别前缀
  return Response.redirect(NEW_BASE + "/" + url.search, 301);
}
