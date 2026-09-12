/* /fb — POST 反馈接收(v2 桌面端真通道 + v1 官网表单兼容)。
 * 编排与全部逻辑在 lib/fb-core.js(PRD §7.2);本文件只做绑定与注入。
 * board:issue 首建成功后匿名同步公开板(feedlog),ctx:waitUntil 后台执行。
 * GET /fb/list 见 functions/fb/list.js;对账见 functions/fb/reconcile.js。
 */
import { handlePost, d1Store, githubAdapter, boardAdapter } from '../lib/fb-core.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  return handlePost({
    request, env,
    store: d1Store(env),
    gh: githubAdapter(env),
    board: boardAdapter(env),
    ctx: context,
  });
}
