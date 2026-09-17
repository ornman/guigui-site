/* GET /download/count — 公开下载计数 + 页面元数据(ver/size_mb,5 分钟边缘缓存)。 */
import { handleDlCount, dlStore } from '../../lib/dl-core.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  return handleDlCount({ request, env, store: dlStore(env) });
}
