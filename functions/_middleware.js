/* 官网旧版反馈板反代退役(2026-09-26,~2026-09-28 重定向目标变更)。
 *
 * 历史:feedlog 早期挂为官网子页面,本页面前缀(/zh /en /_nuxt /api 等)
 *       反代到 cloudflared 快速隧道(months-neon-though-declaration.trycloudflare.com)。
 *       2026-09-26 feedlog 已迁至 xiaopozhan,新公网域名 feedback.coro0.top,
 *       旧 trycloudflare 容器已撤,继续反代=1016 Origin DNS 错误。
 *       2026-09-28 用户反馈 xiaopozhan 上的 feedlog 是「别人的项目」,
 *       改起自己全新的 my-figlog 实例(端口 13004,默认中文),新公网域名
 *       fb.yaoxiumax.top(orn233 root cloudflared 隧道);
 *       feedback.coro0.top 现在仍指向「别人的 feedlog」,本中间件不再用。
 *
 * 现状:
 *   - 首页两入口(href=fb.yaoxiumax.top/)已改指绝对地址,不再依赖本中间件
 *   - 本中间件仅作老书签 301 跳转:/zh /en /_nuxt /api /_ipx 等老路径
 *     全部跳到 fb.yaoxiumax.top/ 根地址
 *
 * Why:feedlog 拆成「他人的反馈板」(feedback.coro0.top)与「自营 my-figlog」
 *     (fb.yaoxiumax.top)两份;前者保留不动,后者由本仓链接 + 本中间件引导。
 */
const NEW_BASE = "https://fb.yaoxiumax.top";
const PREFIXES = ["/zh", "/en", "/_nuxt", "/api", "/_ipx", "/__nuxt", "/docs"];

function shouldRedirect(pathname) {
  return PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);
  if (!shouldRedirect(url.pathname)) return next();
  // 老路径(/zh /en /_nuxt 等)统一跳根,query 保留
  return Response.redirect(NEW_BASE + "/" + url.search, 301);
}
