/* 官网子页面挂载反馈板:指定前缀反代到自部署 feedlog,其余请求原样走官网。
 * - feedlog 的 BETTER_AUTH_URL 须为 https://guigui-guat.pages.dev(同域 cookie);
 * - /fb(官网自身反馈管道)不在此列,永远走官网;
 * - 源站走 cloudflared 快速隧道(Workers fetch 不收裸 IP,1003 教训);
 *   ⚠️ trycloudflare 域名随隧道容器重建而变,变了改这里 ORIGIN 再 deploy。
 */
const ORIGIN = "https://months-neon-though-declaration.trycloudflare.com";
const PREFIXES = ["/zh", "/en", "/_nuxt", "/api", "/_ipx", "/__nuxt", "/docs"];
const FILES = ["/favicon.ico", "/logo.svg", "/logo-mark.svg", "/logo-icon.svg", "/og.png"];

function shouldProxy(pathname) {
  return FILES.includes(pathname) ||
    PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);
  if (!shouldProxy(url.pathname)) return next();
  const headers = new Headers(request.headers);
  headers.delete("cf-connecting-ip");
  return fetch(ORIGIN + url.pathname + url.search, {
    method: request.method,
    headers,
    body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
    redirect: "manual",
  });
}
