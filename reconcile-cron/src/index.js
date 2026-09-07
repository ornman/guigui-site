/* 反馈管道对账 cron(§6.3):每小时整点 POST /fb/reconcile。
 * 端点本身幂等可重跑——本 Worker 只是调度器之一,手动 curl / 换调度器都不影响。 */
export default {
  async scheduled(event, env, ctx) {
    const url = `https://guigui-guat.pages.dev/fb/reconcile?key=${env.CRON_KEY}`;
    ctx.waitUntil(fetch(url, { method: 'POST' }).then(async (r) => {
      const body = await r.text();
      console.log(`reconcile ${r.status}: ${body.slice(0, 200)}`);
    }).catch((e) => console.error('reconcile failed:', e)));
  },
};
