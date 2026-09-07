/* POST /fb/reconcile?key=CRON_KEY — 对账端点(§6.3,调度器无关:
 * Pages 定时触发 / 独立 Worker cron / 手动 curl 都能调;幂等可重跑)。 */
import { handleReconcile, d1Store, githubAdapter } from '../../lib/fb-core.js';

export async function onRequestPost({ request, env }) {
  return handleReconcile({
    request, env,
    store: d1Store(env),
    gh: githubAdapter(env),
  });
}
