/* /download 下载计数测试 — assetFor / resolveAsset / handleDownload / aggregate /
 * handleDlList / handleDlCount。Adapter 注入内存 store 与假 ASSETS(fb.test 同款范式)。
 * 运行:npm test(= node --test tests/) */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isBot, assetFor, resolveAsset, aggregate, handleDownload, handleDlList, handleDlCount,
} from '../lib/dl-core.js';

/* ── 夹具 ─────────────────────────────────────── */

function memDlStore(seed = []) {
  const rows = [...seed];
  return {
    rows,
    async insertEvent(e) {                                    // 宏任务延迟:微任务排干也不落行,才能测出 waitUntil「先回后落」
      await new Promise((r) => setTimeout(r, 0)); rows.push({ ...e }); return true;
    },
    async allEvents() { return [...rows].reverse(); },     // 近似 ORDER BY id DESC
  };
}
const downDlStore = () => ({                                 // D1 挂:计数失败绝不挡下载
  async insertEvent() { return false; },
  async allEvents() { return undefined; },
});
const assets = (body, status = 200) => ({ fetch: async () => new Response(body, { status }) });
const vj = (latest) => assets(JSON.stringify({ latest, released_at: '2026-09-16', notes: '' }));

const UA_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128';
const req = (over = {}) => ({                                 // handleDownload 只用 url/headers/cf
  url: 'https://guigui-guat.pages.dev/download',
  headers: { get: (h) => (h === 'user-agent' ? (over.ua ?? UA_CHROME) : null) },
  cf: over.cf,
});
const ctxFake = () => { const ps = []; return { ps, waitUntil(p) { ps.push(p); } }; };

/* ── 纯函数 ───────────────────────────────────── */

test('assetFor:合法三段版本 → 直链路径;垃圾/穿越 → null', () => {
  assert.equal(assetFor('2.1.0'), '/guigui-setup-2.1.0.exe');
  assert.equal(assetFor('10.20.3'), '/guigui-setup-10.20.3.exe');
  assert.equal(assetFor('../../etc'), null);
  assert.equal(assetFor('v2.1.0'), null);
  assert.equal(assetFor(''), null);
  assert.equal(assetFor(null), null);
});

test('isBot:脚本/爬虫 UA 判真,浏览器/桌面端/空判假', () => {
  assert.equal(isBot('curl/8.0'), true);
  assert.equal(isBot('Googlebot/2.1'), true);
  assert.equal(isBot('python-requests/2.31'), true);
  assert.equal(isBot(UA_CHROME), false);
  assert.equal(isBot('GuiguiDesktop/2.1.0'), false);
  assert.equal(isBot(null), false);
});

test('resolveAsset:version.json → {ver,path};5xx/坏 JSON/ASSETS 缺席 → null', async () => {
  assert.deepEqual(await resolveAsset({ request: req(), env: { ASSETS: vj('2.1.0') } }),
    { ver: '2.1.0', path: '/guigui-setup-2.1.0.exe', size_hint: null, dl_base: null });
  assert.equal(await resolveAsset({ request: req(), env: { ASSETS: assets('{}', 500) } }), null);
  assert.equal(await resolveAsset({ request: req(), env: { ASSETS: assets('not json') } }), null);
  assert.equal(await resolveAsset({ request: req(), env: { ASSETS: vj('garbage') } }), null);
  assert.equal(await resolveAsset({ request: req(), env: {} }), null);
});

/* ── GET /download 编排 ──────────────────────── */

test('主链路:302 直链 + 落事件(ver/ua/country 齐全会)', async () => {
  const store = memDlStore();
  const r = await handleDownload({
    request: req({ ua: UA_CHROME, cf: { country: 'CN' } }),
    env: { ASSETS: vj('2.1.0') }, store,
  });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/guigui-setup-2.1.0.exe');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(store.rows.length, 1);
  assert.equal(store.rows[0].ver, '2.1.0');
  assert.equal(store.rows[0].ua, UA_CHROME);
  assert.equal(store.rows[0].country, 'CN');
});

test('ctx.waitUntil 在场:先回 302,计数后台补', async () => {
  const store = memDlStore(), ctx = ctxFake();
  const r = await handleDownload({ request: req(), env: { ASSETS: vj('2.1.0') }, store, ctx });
  assert.equal(r.status, 302);
  assert.equal(store.rows.length, 0);                        // 回执时未落
  await Promise.all(ctx.ps);
  assert.equal(store.rows.length, 1);                        // 后台补上
});

test('version.json 读不到:302 回下载区锚点,事件照落(ver=null 可见)', async () => {
  const store = memDlStore();
  const r = await handleDownload({ request: req(), env: { ASSETS: assets('{}', 500) }, store });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/#fig-05');
  assert.equal(store.rows.length, 1);
  assert.equal(store.rows[0].ver, null);
});

test('D1 挂:计数失败绝不挡下载(302 照发)', async () => {
  const r = await handleDownload({ request: req(), env: { ASSETS: vj('2.1.0') }, store: downDlStore() });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/guigui-setup-2.1.0.exe');
});

/* ── 双源:dl_base 主源(深圳直连)+ Cloudflare 兜底 ──
 * 探活缓存是模块级状态,各用例用不同 host 隔离,避免 60s TTL 串味。 */

const vjDl = (host, extra = {}) =>
  assets(JSON.stringify({ latest: '2.1.0', dl_base: `https://${host}`, released_at: '2026-09-16', notes: '', ...extra }));
const dlFetch = (dlStatus) => {                                // 只应答 dl host 的 HEAD;其余外呼皆炸
  const heads = [];
  return {
    heads,
    async fetch(input) {
      const url = typeof input === 'string' ? input : input.url;
      if (url.startsWith('https://dl-')) { heads.push(url); return new Response(null, { status: dlStatus }); }
      throw new Error('unexpected fetch: ' + url);
    },
  };
};

test('resolveAsset:dl_base 透传;https 强制/尾斜杠剪/明文 http 弃', async () => {
  const base = await resolveAsset({ request: req(), env: { ASSETS: vj('2.1.0') } });
  assert.equal(base.dl_base, null);                            // 无字段 → 单源(Cloudflare)
  const norm = await resolveAsset({ request: req(), env: { ASSETS: vjDl('dl-ok.test', {}) } });
  assert.equal(norm.dl_base, 'https://dl-ok.test');
  const slash = await resolveAsset({ request: req(), env: { ASSETS: assets(JSON.stringify({ latest: '2.1.0', dl_base: 'https://dl-ok.test/' })) } });
  assert.equal(slash.dl_base, 'https://dl-ok.test');           // 尾斜杠归一
  const plain = await resolveAsset({ request: req(), env: { ASSETS: assets(JSON.stringify({ latest: '2.1.0', dl_base: 'http://103.236.55.179' })) } });
  assert.equal(plain.dl_base, null);                           // 明文 http → 弃(浏览器会标不安全下载)
});

test('双源:主源健康 → 302 主源绝对 URL,计数照落', async () => {
  const store = memDlStore(), f = dlFetch(200);
  const r = await handleDownload({ request: req(), env: { ASSETS: vjDl('dl-a.test') }, store, fetchImpl: f.fetch });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), 'https://dl-a.test/guigui-setup-2.1.0.exe');
  assert.equal(f.heads.length, 1);
  assert.equal(store.rows.length, 1);
});

test('双源:主源 404(exe 没传到)→ 302 回 Cloudflare 同域', async () => {
  const f = dlFetch(404);
  const r = await handleDownload({ request: req(), env: { ASSETS: vjDl('dl-b.test') }, store: memDlStore(), fetchImpl: f.fetch });
  assert.equal(r.headers.get('location'), '/guigui-setup-2.1.0.exe');
});

test('双源:主源网络挂(fetch reject)→ 302 回 Cloudflare 同域', async () => {
  const f = { fetch: async () => { throw new Error('network down'); } };
  const r = await handleDownload({ request: req(), env: { ASSETS: vjDl('dl-c.test') }, store: memDlStore(), fetchImpl: f.fetch });
  assert.equal(r.headers.get('location'), '/guigui-setup-2.1.0.exe');
});

test('双源:探活 60s TTL——两击只探一次,窗口内用缓存值', async () => {
  const f = dlFetch(200);
  const env = { ASSETS: vjDl('dl-d.test') };
  const r1 = await handleDownload({ request: req(), env, store: memDlStore(), fetchImpl: f.fetch });
  const r2 = await handleDownload({ request: req(), env, store: memDlStore(), fetchImpl: f.fetch });
  assert.equal(r1.headers.get('location'), 'https://dl-d.test/guigui-setup-2.1.0.exe');
  assert.equal(r2.headers.get('location'), r1.headers.get('location'));
  assert.equal(f.heads.length, 1);                             // 第二击吃缓存,没再探
});

/* ── aggregate(统计纯函数,mem/D1 同一条路)──── */

test('aggregate:真人/含爬虫两套数,按版本全量、按日只近 14 天', () => {
  const now = Date.now();
  const day = (off, hm = ' 08:00:00') => new Date(now - off * 86400e3).toISOString().slice(0, 10) + hm;
  const rows = [
    { created_at: day(0, ' 10:00:00'), ver: '2.1.0', ua: 'Mozilla/5.0' },
    { created_at: day(0, ' 09:00:00'), ver: '2.1.0', ua: 'curl/8.0' },
    { created_at: day(3), ver: '2.0.0', ua: 'Mozilla/5.0' },
    { created_at: day(20), ver: '2.0.0', ua: 'Googlebot/2.1' },
    { created_at: day(30), ver: '2.0.0', ua: 'Mozilla/5.0' },
    { created_at: day(1), ver: null, ua: 'Mozilla/5.0' },
  ];
  const s = aggregate(rows, now);
  assert.equal(s.total, 6);
  assert.equal(s.human_total, 4);                             // curl/Googlebot 剔除
  assert.equal(s.human_last_7d, 3);                           // 今天 1 + 1天前 + 3天前;30天前在窗外
  assert.deepEqual(s.by_version, [{ ver: '2.0.0', c: 2 }, { ver: '2.1.0', c: 1 }, { ver: '?', c: 1 }]);
  assert.deepEqual(s.by_day, [
    { day: day(0).slice(0, 10), c: 1 },
    { day: day(1).slice(0, 10), c: 1 },
    { day: day(3).slice(0, 10), c: 1 },
  ]);                                                        // 20/30 天前出窗
  assert.equal(s.last_at, day(0, ' 10:00:00'));
});

/* ── GET /download/list(管理端)──────────────── */

const listReq = (key, accept) => new Request(`https://x/download/list?key=${key}`, {
  headers: accept ? { accept } : {},
});

test('list:key 错/缺 → 403', async () => {
  const store = memDlStore();
  assert.equal((await handleDlList({ request: listReq('wrong'), env: { ADMIN_KEY: 'a1' }, store })).status, 403);
  assert.equal((await handleDlList({ request: listReq('a1'), env: {}, store })).status, 403);
});

test('list:JSON 视图带两套数与拆分;HTML 视图含数字', async () => {
  const now = Date.now();
  const day = (off) => new Date(now - off * 86400e3).toISOString().slice(0, 10) + ' 08:00:00';
  const store = memDlStore([
    { created_at: day(0), ver: '2.1.0', ua: 'Mozilla/5.0' },
    { created_at: day(0), ver: '2.1.0', ua: 'curl/8.0' },
  ]);
  const jr = await handleDlList({ request: listReq('a1', 'application/json'), env: { ADMIN_KEY: 'a1' }, store });
  assert.equal(jr.status, 200);
  assert.equal(jr.headers.get('content-type').includes('application/json'), true);
  const body = await jr.json();
  assert.equal(body.total, 2);
  assert.equal(body.human_total, 1);
  assert.equal(body.storage, 'ok');
  assert.deepEqual(body.by_version, [{ ver: '2.1.0', c: 1 }]);

  const hr = await handleDlList({
    request: listReq('a1', 'text/html,application/xhtml+xml'),
    env: { ADMIN_KEY: 'a1' }, store: memDlStore(store.rows),
  });
  assert.equal(hr.headers.get('content-type').includes('text/html'), true);
  const html = await hr.text();
  assert.ok(html.includes('桂桂 · 下载计数'));
  assert.ok(html.includes('>1<'));                            // 真人数
});

test('list:D1 挂 → 200 + storage=down + 零值(不 5xx)', async () => {
  const r = await handleDlList({ request: listReq('a1', 'application/json'), env: { ADMIN_KEY: 'a1' }, store: downDlStore() });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.storage, 'down');
  assert.equal(body.human_total, 0);
});

/* ── GET /download/count(公开端点:计数 + ver/size 元数据)── */

const routedAssets = (routes) => ({
  fetch: (input, init) => {                                  // 标准 fetch 签名:input 可为 string 或 Request
    const url = typeof input === 'string' ? input : input.url;
    const method = typeof input === 'string' ? ((init && init.method) || 'GET') : input.method;
    const mk = routes[new URL(url).pathname] || (() => new Response(null, { status: 404 }));
    return mk({ method });
  },
});
const stdAssets = (len) => routedAssets({
  '/version.json': () => new Response(JSON.stringify({ latest: '2.1.0' }), { status: 200 }),
  '/guigui-setup-2.1.0.exe': () => new Response(null, { status: 200, headers: len != null ? { 'content-length': String(len) } : {} }),
});
const rangeAssets = (total) => routedAssets({
  '/version.json': () => new Response(JSON.stringify({ latest: '2.1.0' }), { status: 200 }),
  '/guigui-setup-2.1.0.exe': (init) => (init.method === 'HEAD'
    ? new Response(null, { status: 405 })
    : new Response(null, { status: 206, headers: { 'content-range': `bytes 0-0/${total}` } })),
});
const noRangeAssets = (len) => routedAssets({                 // 生产实测形态:HEAD 无长,Range 被忽略(200+全量长)
  '/version.json': () => new Response(JSON.stringify({ latest: '2.1.0' }), { status: 200 }),
  '/guigui-setup-2.1.0.exe': (init) => (init.method === 'HEAD'
    ? new Response(null, { status: 200 })
    : new Response(null, { status: 200, headers: { 'content-length': String(len) } })),
});

test('count:真人数 + ver + size_mb(HEAD Content-Length,24897729B → 24MB)+ 缓存头', async () => {
  const now = Date.now();
  const day = (off) => new Date(now - off * 86400e3).toISOString().slice(0, 10) + ' 08:00:00';
  const store = memDlStore([
    { created_at: day(0), ver: '2.1.0', ua: 'Mozilla/5.0' },
    { created_at: day(0), ver: '2.1.0', ua: 'Mozilla/5.0' },
    { created_at: day(0), ver: '2.1.0', ua: 'wget/1.21' },
  ]);
  const a = stdAssets(24897729);
  const r = await handleDlCount({ request: req(), env: { ASSETS: a }, fetchImpl: a.fetch, store });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('cache-control'), /max-age=300/);
  assert.deepEqual(await r.json(), { ok: true, count: 2, ver: '2.1.0', size_mb: 24 });
});

test('count:HEAD 不给 → Range 206 兜底解析 content-range(26214400B → 25MB)', async () => {
  const a = rangeAssets(26214400);
  const r = await handleDlCount({ request: req(), env: { ASSETS: a }, fetchImpl: a.fetch, store: memDlStore() });
  const body = await r.json();
  assert.equal(body.size_mb, 25);
  assert.equal(body.ver, '2.1.0');
});

test('count:HEAD 无长且 Range 被忽略 → GET 200 头里拿全量长(生产实测形态)', async () => {
  const a = noRangeAssets(24897729);
  const r = await handleDlCount({ request: req(), env: { ASSETS: a }, fetchImpl: a.fetch, store: memDlStore() });
  const body = await r.json();
  assert.equal(body.size_mb, 24);
});

test('count:公网探测全挂 → version.json size_mb 兜底', async () => {
  const a = routedAssets({
    '/version.json': () => new Response(JSON.stringify({ latest: '2.1.0', size_mb: 25 }), { status: 200 }),
  });                                                        // exe 路由缺省 → 探测 404
  const r = await handleDlCount({ request: req(), env: { ASSETS: a }, fetchImpl: a.fetch, store: memDlStore() });
  const body = await r.json();
  assert.equal(body.ver, '2.1.0');
  assert.equal(body.size_mb, 25);
});

test('count:version.json 读不到 → ver/size null,count 照发(页面保留静态兜底)', async () => {
  const a = routedAssets({});
  const r = await handleDlCount({ request: req(), env: { ASSETS: a }, fetchImpl: a.fetch, store: memDlStore() });
  assert.deepEqual(await r.json(), { ok: true, count: 0, ver: null, size_mb: null });
});

test('count:D1 挂 → count=null 但 ver/size 照发(元数据不依赖计数库)', async () => {
  const a = stdAssets(24897729);
  const r = await handleDlCount({ request: req(), env: { ASSETS: a }, fetchImpl: a.fetch, store: downDlStore() });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, count: null, ver: '2.1.0', size_mb: 24 });
});

test('count:双源——主源健康,大小探主源(26214400B → 25MB),不碰同域', async () => {
  const a = vjDl('dl-e.test');                                 // ASSETS 只喂 version.json
  const f = async (input) => {                                 // 主源给长;同域被碰即炸(证明优先级)
    const url = typeof input === 'string' ? input : input.url;
    if (url.startsWith('https://dl-e.test/'))
      return new Response(null, { status: 200, headers: { 'content-length': '26214400' } });
    throw new Error('should not touch cf origin: ' + url);
  };
  const r = await handleDlCount({ request: req(), env: { ASSETS: a }, fetchImpl: f, store: memDlStore() });
  assert.equal((await r.json()).size_mb, 25);
});

test('count:双源——主源挂,回退同域 Cloudflare 源照常给长', async () => {
  const a = stdAssets(24897729);                               // 同域:HEAD 200 带 24897729
  const f = async (input) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.startsWith('https://dl-f.test/')) return new Response(null, { status: 502 });
    return a.fetch(input);
  };
  const env = { ASSETS: vjDl('dl-f.test') };
  const r = await handleDlCount({ request: req(), env, fetchImpl: f, store: memDlStore() });
  assert.equal((await r.json()).size_mb, 24);
});

test('count:双源——主源回 CF 错误页(生产实测 530+17B)不当资产大小,穿透到同域', async () => {
  const a = stdAssets(24897729);
  const f = async (input) => {                                 // 复刻生产:dl 子域在 CF 边缘=530+17 字节错误文本
    const url = typeof input === 'string' ? input : input.url;
    if (url.startsWith('https://dl-g.test/'))
      return new Response('error code: 1016\n', { status: 530, headers: { 'content-length': '17' } });
    return a.fetch(input);
  };
  const env = { ASSETS: vjDl('dl-g.test') };
  const r = await handleDlCount({ request: req(), env, fetchImpl: f, store: memDlStore() });
  const body = await r.json();
  assert.equal(body.size_mb, 24);                              // 17B 曾被当大小 → size_mb=0,修复后穿透到同域
});
