/* 桂桂官网反馈 API — Cloudflare Pages Functions + D1(与站点同域,免 CORS)
 * POST /fb  提交 { what, when, contact, log };GET /fb/list 见 functions/fb/list.js
 */
const MAX = { what: 120, when: 60, contact: 80, log: 4000 };
const RATE_PER_HOUR = 8;

const json = (obj, status) => new Response(JSON.stringify(obj), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8' },
});
const cut = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

export async function onRequestPost({ request, env }) {
  let d;
  try { d = await request.json(); } catch { return json({ error: '请求格式不对' }, 400); }
  const what = cut(d.what, MAX.what);
  if (!what) return json({ error: '缺「什么现象」' }, 400);
  try {
    const ip = request.headers.get('cf-connecting-ip') || '';
    const hourAgo = new Date(Date.now() - 3600e3).toISOString().replace('T', ' ').slice(0, 19);
    const { results } = await env.DB
      .prepare('SELECT COUNT(*) AS c FROM fb WHERE ip = ?1 AND created_at > ?2')
      .bind(ip, hourAgo).all();
    if (results[0].c >= RATE_PER_HOUR) return json({ error: '提交太频繁,一小时后再试' }, 429);
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
    return json({ ok: true, id: 'GG-' + (info.meta.last_row_id || 0).toString(36).toUpperCase() });
  } catch (e) {
    return json({ error: '服务开小差了,请走邮件反馈' }, 500);
  }
}
