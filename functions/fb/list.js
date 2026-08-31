/* GET /fb/list?key=管理密钥 — 管理端拉取最近 200 条反馈 */
const json = (obj, status) => new Response(JSON.stringify(obj), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8' },
});

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  if (!env.ADMIN_KEY || url.searchParams.get('key') !== env.ADMIN_KEY) {
    return json({ error: 'forbidden' }, 403);
  }
  const { results } = await env.DB
    .prepare('SELECT id, created_at, ip, what, when_desc, contact, log FROM fb ORDER BY id DESC LIMIT 200')
    .all();
  return json({ items: results });
}
