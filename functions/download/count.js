/* GET /download/count — 公开下载计数(官网下载区灰字拉取,5 分钟边缘缓存)。 */
import { handleDlCount, dlStore } from '../../lib/dl-core.js';

export async function onRequestGet(context) {
  const { env } = context;
  return handleDlCount({ store: dlStore(env) });
}
