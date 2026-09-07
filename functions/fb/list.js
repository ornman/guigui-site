/* GET /fb/list?key=ADMIN_KEY — 管理端:最近 200 条 + 管道健康
 * (pending_issues / last_insert_at / gh_broken 红字数据源,§6.5)。 */
import { handleList, d1Store } from '../../lib/fb-core.js';

export async function onRequestGet({ request, env }) {
  return handleList({ request, env, store: d1Store(env) });
}
