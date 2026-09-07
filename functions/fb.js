/* /fb — POST 反馈接收(v2 桌面端真通道 + v1 官网表单兼容)。
 * 编排与全部逻辑在 lib/fb-core.js(PRD §7.2);本文件只做绑定与注入。
 * GET /fb/list 见 functions/fb/list.js;对账见 functions/fb/reconcile.js。
 */
import { handlePost, d1Store, githubAdapter } from '../lib/fb-core.js';

export async function onRequestPost({ request, env }) {
  return handlePost({
    request, env,
    store: d1Store(env),
    gh: githubAdapter(env),
  });
}
