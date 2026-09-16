/* GET /download/list?key=ADMIN_KEY — 下载计数查看(浏览器开=小页,脚本拉=JSON)。 */
import { handleDlList, dlStore } from '../../lib/dl-core.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  return handleDlList({ request, env, store: dlStore(env) });
}
