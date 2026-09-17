/* dl-core.js — /download 下载计数核心(2026-09-16;2026-09-17 双源改造)。
 *
 * 链路:官网下载按钮 href=/download → 读 version.json(env.ASSETS,同 PoP)推导
 * guigui-setup-<latest>.exe → D1 download_events 落一条(ctx.waitUntil,不挡跳转)
 * → 302 直链。version.json 读不到 → 302 回下载区锚点,事件照落(ver=NULL 可见)。
 *
 * 双源(2026-09-17,治 Cloudflare 免费版国内 81KB/s):version.json 可选 dl_base
 * (https://dl.yaoxiumax.top,深圳电信直连源)。302 前探活(HEAD 主源 exe,
 * 60s TTL):2xx → 302 主源绝对 URL;探活失败/超时/无 dl_base → 302 同域路径
 * (Cloudflare 兜底,慢但不死)。回滚单源 = 删 version.json 的 dl_base 字段。
 *
 * 口径:一次 GET /download = 一次下载;断点续传/分片直打静态 exe 不计(两源同)。
 * 统计:GET /download/list?key=ADMIN_KEY(与 /fb/list 同钥同款 403);
 * bot 判据只在 isBot 一处(判据写两份必漂移),D1 只存原始行,聚合在端上做。
 * 发版:bump version.json + exe 放进 site/(Cloudflare 源)+ exe 传服务器(dl 源,
 * scripts/mirror-deploy.sh;文件名=guigui-setup-<latest>.exe,由桌面仓 setup.iss
 * OutputBaseFilename 决定),按钮与函数永不再动。
 */
import { nowIso } from './fb-core.js';

const VER_RE = /^\d+\.\d+\.\d+$/;
const BOT_RE = /bot|crawl|spider|slurp|curl|wget|python|http-client|monitor|preview|headless/i;
const DAY = 86400e3;

export const isBot = (ua) => (ua ? BOT_RE.test(ua) : false);
export const assetFor = (latest) => (VER_RE.test(latest || '') ? `/guigui-setup-${latest}.exe` : null);

/* version.json → { ver, path, size_hint, sha256, dl_base };任何失败返回 null(发版间隙/资产缺失不挡下载)。
 * sha256 走版本号单一正本:写错/漏写 version.json 才是漏字段,网页再无第二处哈希。 */
export async function resolveAsset({ request, env }) {
  try {
    const res = await env.ASSETS.fetch(new URL('/version.json', new URL(request.url).origin).href);
    if (!res.ok) return null;
    const v = await res.json();
    const path = assetFor(v.latest);
    return path
      ? {
          ver: v.latest,
          path,
          size_hint: typeof v.size_mb === 'number' ? v.size_mb : null,
          sha256: normSha256(v.sha256),
          dl_base: normDlBase(v.dl_base),
        }
      : null;
  } catch { return null; }
}

/* sha256 归一:64 位 hex 小写,其余视为无效(页面端保留静态兜底文本,不挡下载)。 */
const normSha256 = (raw) => {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(s) ? s : null;
};

/* dl_base 归一:仅收 https(明文 http 源会被浏览器标「不安全下载」,宁弃不用),剪尾斜杠。 */
const normDlBase = (raw) =>
  typeof raw === 'string' && /^https:\/\/[\w.-]+/.test(raw) ? raw.replace(/\/+$/, '') : null;

export function dlStore(env) {
  return {
    async insertEvent({ ver, ua, country }) {
      try {
        await env.DB.prepare(
          'INSERT INTO download_events (created_at, ver, ua, country) VALUES (?1, ?2, ?3, ?4)',
        ).bind(nowIso(), ver || null, ua || null, country || null).run();
        return true;
      } catch { return false; }               // 计数失败绝不挡下载
    },
    async allEvents(limit = 50000) {
      try {
        const { results } = await env.DB.prepare(
          'SELECT created_at, ver, ua FROM download_events ORDER BY id DESC LIMIT ?1',
        ).bind(limit).all();
        return results || [];
      } catch { return undefined; }           // undefined = D1 不可达(与 fb-core 同语义)
    },
  };
}

/* ── 主源探活(60s TTL,per-isolate 缓存够用:探偏 60s 代价远小于每击必探)──
 * 同步探而非后台探:冷启动/过期后的第一个用户多等一次 HEAD(健康≈百毫秒,
 * 挂了≤2.5s),换回「302 出手时主源必活」的强保证;窗口内其余用户零等待。 */
const PROBE_TTL = 60e3, PROBE_TIMEOUT = 2500;
let dlProbe = { key: null, ok: false, at: -Infinity };

async function probeDl(url, fetchImpl) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), PROBE_TIMEOUT);
  try {
    const r = await fetchImpl(url, {
      method: 'HEAD', signal: ac.signal, headers: { 'user-agent': 'guigui-site-metadata/1.0' },
    });
    return r.ok;                              // 只认 2xx:404=exe 没传到主源,回 Cloudflare 源保下载
  } catch { return false; }
  finally { clearTimeout(t); }
}

async function dlUp(asset, fetchImpl, now = Date.now()) {
  if (!asset || !asset.dl_base) return false;
  const key = asset.dl_base + asset.path;
  if (dlProbe.key === key && now - dlProbe.at < PROBE_TTL) return dlProbe.ok;
  const ok = await probeDl(key, fetchImpl);
  dlProbe = { key, ok, at: now };
  return ok;
}

/* GET /download:先答 302,计数后台补(ctx 在场);测试无 ctx 同步等完可断言。
 * 302 目标:主源(dl_base)探活过 → 绝对 URL;否则同域(Cloudflare 兜底)。 */
export async function handleDownload({ request, env, ctx, store, fetchImpl = fetch }) {
  const asset = await resolveAsset({ request, env });
  const ua = (request.headers.get('user-agent') || '').slice(0, 200);
  const country = (request.cf && request.cf.country) || null;
  const p = store.insertEvent({ ver: asset ? asset.ver : null, ua, country });
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(p);
  else await p;
  const mainUp = asset && asset.dl_base && (await dlUp(asset, fetchImpl));
  const location = asset ? (mainUp ? asset.dl_base + asset.path : asset.path) : '/#fig-05';
  return new Response(null, {
    status: 302,
    headers: { location, 'cache-control': 'no-store' },
  });
}

/* ── 聚合(纯函数,mem/D1 同一条路)────────────── */

export function aggregate(rows, now = Date.now()) {
  const dayStr = (off) => new Date(now - off * DAY).toISOString().slice(0, 10);
  const cut7 = dayStr(7), cut14 = dayStr(14);
  const s = { total: rows.length, human_total: 0, human_last_7d: 0, by_version: [], by_day: [], last_at: null };
  s.last_at = rows.reduce((m, r) => (r.created_at && (!m || r.created_at > m) ? r.created_at : m), null);
  const byVer = new Map(), byDay = new Map();
  for (const r of rows) {
    if (isBot(r.ua)) continue;
    s.human_total++;
    const at = r.created_at || '';
    if (at >= cut7) s.human_last_7d++;
    byVer.set(r.ver || '?', (byVer.get(r.ver || '?') || 0) + 1);
    const d = at.slice(0, 10);
    if (d >= cut14) byDay.set(d, (byDay.get(d) || 0) + 1);
  }
  s.by_version = [...byVer].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([ver, c]) => ({ ver, c }));
  s.by_day = [...byDay].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 14).map(([day, c]) => ({ day, c }));
  return s;
}

/* ── GET /download/list(管理端)───────────────── */

const json = (obj, status) => new Response(JSON.stringify(obj), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

export async function handleDlList({ request, env, store }) {
  const url = new URL(request.url);
  if (!env.ADMIN_KEY || url.searchParams.get('key') !== env.ADMIN_KEY)
    return json({ error: 'forbidden' }, 403);
  const rows = await store.allEvents();
  const stats = aggregate(rows || []);
  stats.storage = rows === undefined ? 'down' : 'ok';
  const accept = request.headers.get('accept') || '';
  return accept.includes('text/html') ? htmlPage(stats) : json(stats);
}

/* GET /download/count — 公开计数 + 页面元数据(ver/size_mb):下载区灰字与全站
 * 大小/版本号共用这一个端点。大小探自**实际部署资产**(HEAD Content-Length,
 * Range 兜底)——exe 换新自动对,不是手填数;5 分钟边缘缓存扛页面流量。
 * 双源:优先探 dl_base 主源(用户实际下载的地方),挂了回退同域 Cloudflare 源。
 * D1 不可达时 count=null 但 ver/size 照发(元数据不依赖计数库);页面端
 * count 非数字即静默藏行、ver/size 缺席即保留静态兜底文本。 */
/* 大小探自**公网**的资产响应头(ASSETS 绑定实测 HEAD/Range/GET 全不给长度);
 * HEAD 优先,Range GET 兜底,头读完即 cancel 不拉全量。带自定义 UA 防 Bot Fight Mode。 */
async function assetSize(url, fetchImpl) {
  try {
    const r = await fetchImpl(url, { method: 'HEAD', headers: { 'user-agent': 'guigui-site-metadata/1.0' } });
    const len = Number(r.headers.get('content-length') || 0);
    if (r.ok && len > 0) return len;
  } catch { /* 落到 Range GET */ }
  try {
    const r = await fetchImpl(url, { headers: { range: 'bytes=0-0', 'user-agent': 'guigui-site-metadata/1.0' } });
    const done = (v) => { if (r.body) { try { r.body.cancel(); } catch { /* 头读完即弃 */ } } return v; };
    if (r.ok) {                                               // 只认 2xx:错误页(生产实测 CF 子域缺失=530+17B body)的长度不是资产大小
      const m = /\/(\d+)$/.exec(r.headers.get('content-range') || '');
      if (m) return done(Number(m[1]));                        // Range 生效:总长在 content-range 尾
      const len = Number(r.headers.get('content-length') || 0);
      if (len > 0) return done(len);                           // Range 被忽略:200 头里即全量长
    }
    return done(null);
  } catch { return null; }
}

export async function handleDlCount({ request, env, store, fetchImpl = fetch }) {
  const asset = await resolveAsset({ request, env });
  const origin = new URL(request.url).origin;
  let size_mb = null;
  if (asset) {
    const urls = [];
    if (asset.dl_base) urls.push(asset.dl_base + asset.path);   // 主源优先:用户下载的是它
    urls.push(new URL(asset.path, origin).href);                // 同域兜底
    for (const u of urls) {
      const bytes = await assetSize(u, fetchImpl);
      if (bytes) { size_mb = Math.round(bytes / 1048576); break; }
    }
    if (size_mb == null) size_mb = asset.size_hint;             // 两源都探不到 → version.json 兜底
  }
  const rows = await store.allEvents();
  return new Response(JSON.stringify({
    ok: true,
    count: rows === undefined ? null : aggregate(rows).human_total,
    ver: asset ? asset.ver : null,
    size_mb,
    sha256: asset ? asset.sha256 : null,
  }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' },
  });
}

/* 浏览器打开 = 深色小页(零依赖内联样式);脚本拉(非 text/html Accept)= JSON。 */
const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function htmlPage(s) {
  const th = 'padding:6px 16px;text-align:left;font-weight:400;color:#9a9da3;border-bottom:1px solid #2a2d33';
  const td = 'padding:6px 16px;border-bottom:1px solid #22252b';
  const table = (head, rows) =>
    `<table style="border-collapse:collapse;font-size:13px;margin:8px 0 24px">` +
    `<tr>${head.map((h) => `<th style="${th}">${esc(h)}</th>`).join('')}</tr>` +
    rows.map((r) => `<tr>${r.map((c) => `<td style="${td}">${esc(c)}</td>`).join('')}</tr>`).join('') + `</table>`;
  const big = (n, label) =>
    `<div style="margin:6px 28px 6px 0;display:inline-block">` +
    `<div style="font-size:34px;font-weight:600">${esc(n)}</div>` +
    `<div style="font-size:12px;color:#9a9da3">${esc(label)}</div></div>`;
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>桂桂 · 下载计数</title>` +
    `<body style="margin:0;background:#16181d;color:#e7e5e0;font-family:system-ui,'Segoe UI','Microsoft YaHei',sans-serif;padding:36px 30px;max-width:720px">` +
    `<h1 style="font-size:18px;font-weight:600;margin:0 0 18px">桂桂 · 下载计数</h1>` +
    big(s.human_total, '下载(真人)') + big(s.total, '下载(含爬虫)') + big(s.human_last_7d, '近 7 天') +
    (s.storage === 'down' ? `<p style="color:#e06c75">⚠ 数据库暂时够不着,下面是零值</p>` : ``) +
    `<div style="font-size:12px;color:#9a9da3;margin:14px 0 2px">按版本</div>` +
    table(['版本', '次数'], s.by_version.map((r) => [r.ver, r.c])) +
    `<div style="font-size:12px;color:#9a9da3;margin:14px 0 2px">按日(近 14 天)</div>` +
    table(['日期', '次数'], s.by_day.map((r) => [r.day, r.c])) +
    `<p style="font-size:12px;color:#6f7478">最近一次:${esc(s.last_at || '—')} · 口径:一次点击 = 一次下载</p>`,
    { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
