/* 桂桂官网反馈 API — Cloudflare Worker + D1
 * POST /fb                 提交反馈 { what, when, contact, log }
 * GET  /fb/list?key=KEY    管理端拉取最近 200 条(ADMIN_KEY 校验)
 * 设计:只存最小必要字段;IP 仅用于限流与排查;全部字段截断入库
 */
const MAX = { what: 120, when: 60, contact: 80, log: 4000 };
const RATE_PER_HOUR = 8;

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status: status,
    headers: Object.assign({ 'content-type': 'application/json; charset=utf-8' }, cors),
  });
}
function str(v) { return typeof v === 'string' ? v.trim() : ''; }
function cut(v, n) { return str(v).slice(0, n); }

export default {
  async fetch(request, env) {
    const cors = {
      'access-control-allow-origin': (env.ALLOWED_ORIGIN || '*'),
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'POST, GET, OPTIONS',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    const url = new URL(request.url);
    try {
      if (url.pathname === '/fb' && request.method === 'POST') return await submit(request, env, cors);
      if (url.pathname === '/fb/list' && request.method === 'GET') return await list(request, env, url, cors);
    } catch (e) {
      return json({ error: '服务开小差了,请走邮件反馈' }, 500, cors);
    }
    return json({ error: 'not found' }, 404, cors);
  },
};

async function submit(request, env, cors) {
  let d;
  try { d = await request.json(); } catch { return json({ error: '请求格式不对' }, 400, cors); }
  const what = cut(d.what, MAX.what);
  if (!what) return json({ error: '缺「什么现象」' }, 400, cors);

  const ip = request.headers.get('cf-connecting-ip') || '';
  const hourAgo = new Date(Date.now() - 3600e3).toISOString().replace('T', ' ').slice(0, 19);
  const { results } = await env.DB
    .prepare('SELECT COUNT(*) AS c FROM fb WHERE ip = ?1 AND created_at > ?2')
    .bind(ip, hourAgo).all();
  if (results[0].c >= RATE_PER_HOUR) return json({ error: '提交太频繁,一小时后再试' }, 429, cors);

  const info = await env.DB
    .prepare('INSERT INTO fb (ip, ua, what, when_desc, contact, log) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(
      ip,
      cut(request.headers.get('user-agent') || '', 200),
      what,
      cut(d.when, MAX.when),
      cut(d.contact, MAX.contact),
      cut(d.log, MAX.log),
    ).run();

  const code = 'GG-' + (info.meta.last_row_id || 0).toString(36).toUpperCase();
  return json({ ok: true, id: code }, 200, cors);
}

async function list(request, env, url, cors) {
  if (!env.ADMIN_KEY || url.searchParams.get('key') !== env.ADMIN_KEY) {
    return json({ error: 'forbidden' }, 403, cors);
  }
  const { results } = await env.DB
    .prepare('SELECT id, created_at, ip, what, when_desc, contact, log FROM fb ORDER BY id DESC LIMIT 200')
    .all();
  return json({ items: results }, 200, cors);
}
