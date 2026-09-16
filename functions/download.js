/* /download — 下载计数跳板:读 version.json 推导直链,D1 落事件(waitUntil 不挡 302)。
 * 统计见 functions/download/list.js;核心在 lib/dl-core.js。 */
import { handleDownload, dlStore } from '../lib/dl-core.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  return handleDownload({ request, env, store: dlStore(env), ctx: context });
}
