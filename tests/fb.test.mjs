/* /fb v2 服务端测试 — validate / render_issue 纯函数 + handlePost 编排。
 * Adapter 注入内存 store 与假 GitHub;对应 AC-F1/F2/F4/F10/F12/F15/F16。
 * 运行:npm test(= node --test tests/) */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  handlePost, validate, render_issue, sanitizeTitle, ggId, nowIso, hourAgoIso,
} from '../lib/fb-core.js';

/* ── 夹具 ─────────────────────────────────────── */

function memStore() {
  const rows = [];
  const ops = new Map();
  let seq = 40;
  return {
    rows, ops,
    async findClientId(cid) { const r = rows.find((x) => x.client_id === cid); return r ? r.id : null; },
    async countClient(cid, since) {
      return rows.filter((r) => r.client_id === cid && r.created_at > since).length;
    },
    async countIp(ip, since) {
      return rows.filter((r) => r.ip === ip && r.created_at > since).length;
    },
    async insert(row) {
      if (row.client_id && rows.some((r) => r.client_id === row.client_id))
        return { ok: false, conflict: true };
      const id = ++seq;
      rows.push({ id, created_at: nowIso(), ...row });
      return { ok: true, id };
    },
    async setIssue(id, issueId, issueAt) {
      const r = rows.find((x) => x.id === id);
      if (r) { r.issue_id = issueId; r.issue_at = issueAt; }
      return true;
    },
    async budgetUsed(since) {
      return rows.filter((r) => r.issue_id != null && r.issue_id !== -1
        && (r.issue_at || '') > since).length;
    },
    async pendingIssues(limit) {
      return rows.filter((r) => r.issue_id == null && r.diag_json)
        .slice(0, limit).map((r) => ({ ...r }));
    },
    async claimIssue(rowId) {
      const r = rows.find((x) => x.id === rowId);
      if (r && r.issue_id == null) { r.issue_id = -1; return true; }
      return false;
    },
    async unclaimIssue(rowId) {
      const r = rows.find((x) => x.id === rowId);
      if (r && r.issue_id === -1) r.issue_id = null;
      return true;
    },
    async health() {
      return {
        pending_issues: rows.filter((r) => r.issue_id == null && r.diag_json).length,
        last_insert_at: rows.length ? rows.map((r) => r.created_at).sort().pop() : null,
        gh_fail_streak: Number(ops.get('gh_fail_streak') || 0),
        gh_broken: !!ops.get('gh_broken_since'),
      };
    },
    async recentRows(limit) {
      return [...rows].sort((a, b) => b.id - a.id).slice(0, limit);
    },
    async opGet(k) { return ops.has(k) ? ops.get(k) : null; },
    async opIncr(k) { ops.set(k, String(Number(ops.get(k) || 0) + 1)); return true; },
    async opSet(k, v) { ops.set(k, String(v)); return true; },
  };
}

const req = (body, headers = {}) => new Request('https://guigui-guat.pages.dev/fb', {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

const payload = (over = {}) => ({
  v: 2,
  client_id: '8f14e45f-9a4c-4a8b-9d1e-111111111111',
  sender_uid: '2025090270209',
  app: 'desktop', app_ver: '2.1.0',
  kind: ['problem'],
  what: '今早七点没登上,日志说登录被拒',
  contact: '', when: '09-07 06:52',
  env: { os: 'Windows 11 26200 x64', errors: [] },
  self: { config: { trigger_time: '07:00' }, errors: [] },
  net: { http: 200, latency_ms: 340 },
  server: { chkstatus: { state: 'no_session' } },
  logs: [{ date: '09-07', entries: [{ ts: '06:52:11', level: 'fail', text: '登录被拒', data: { rej: 'limit_users', body_head: 'Oppp error: Limit Users Err' } }] }],
  summary: '09-01 ✓ · 09-07 ✗',
  crashes: [], latest_ver: '2.1.2',
  ...over,
});

function ghFake() {
  const calls = [];
  const comments = [];
  return {
    calls, comments,
    ok: {
      async create({ title, body, labels }) { calls.push({ title, body, labels }); return { ok: true, number: 700 + calls.length }; },
      async findOpenMeta() { return 555; },
      async comment(n, body) { comments.push({ n, body }); return true; },
    },
    fail: {
      async create(p) { calls.push(p); return { ok: false, status: 401 }; },
      async findOpenMeta() { return null; },
      async comment() { return false; },
    },
  };
}

const post = async ({ body, headers, store, gh, env }) =>
  handlePost({ request: req(body, headers), env: env || {}, store, gh: gh || ghFake().ok });

const jsonOf = async (r) => ({ status: r.status, body: await r.json() });

/* ── validate / render_issue(纯函数)─────────── */

test('validate:合法包归一,kind 去重,超限截断', () => {
  const { ok, norm } = validate(payload({ kind: ['problem', 'problem'] }));
  assert.ok(ok);
  assert.deepEqual(norm.kind, ['problem']);
  assert.equal(norm.app, 'desktop');
});

test('validate:缺必填/坏枚举/坏 client_id → VALIDATION 问题表', () => {
  assert.equal(validate(payload({ what: '   ' })).ok, false);
  assert.equal(validate(payload({ kind: [] })).ok, false);
  assert.equal(validate(payload({ client_id: 'x' })).ok, false);
  assert.equal(validate(payload({ what: '长'.repeat(121) })).ok, false);
  assert.equal(validate(payload({ env: null })).ok, false);
});

test('validate:诊断区超长悄悄截断(机器生成不拒人)', () => {
  const { norm } = validate(payload({
    logs: [{ date: '09-07', entries: Array.from({ length: 200 }, (_, i) => ({ ts: `0${i}:00`, level: 'ok', text: 'x'.repeat(500) })) }],
    crashes: Array.from({ length: 9 }, () => ({ trace: 't'.repeat(9999) })),
  }));
  assert.equal(norm.diag.logs[0].entries.length, 80);
  assert.equal(norm.diag.logs[0].entries[0].text.length, 200);
  assert.equal(norm.diag.crashes.length, 3);
  assert.equal(norm.diag.crashes[0].trace.length, 8192);
});

test('render_issue:注入防护(AC-F16)', () => {
  const rec = {
    id: 'GG-33', kind: ['problem'], app_ver: '2.1.0',
    what: '看这个 `code` <script>alert(1)</script> [假链接](https://evil.example) ``双反引号``',
    when: '', contact: '', sender_uid: '2025090270209', created_at: nowIso(),
    diag: { env: { os: 'x' }, self: {}, latest_ver: '2.1.2' },
  };
  const { title, body, labels } = render_issue(rec);
  assert.deepEqual(labels, ['problem']);                  // 标签服务端固定
  assert.ok(!title.includes('`'));                       // 反引号/控制字符清掉
  assert.ok(!title.includes('\x07'));
  // what 原样字面量出现在正文(围栏足够厚,内部反引号跑不出来)
  assert.ok(body.includes('看这个 `code` <script>alert(1)</script>'));
  assert.ok(body.includes('``双反引号``'));
});

test('render_issue:纯建议标签 + 折叠区', () => {
  const { title, body, labels } = render_issue({
    id: 'GG-9', kind: ['suggestion'], what: '建议加深色模式', app_ver: '2.1.0',
    contact: '', when: '', sender_uid: '', created_at: nowIso(),
    diag: { env: {}, self: {}, logs: [], summary: undefined, crashes: [] },
  });
  assert.deepEqual(labels, ['suggestion']);
  assert.ok(title.startsWith('[反馈·建议]'));
  assert.ok(body.includes('<details>'));                  // 长日志折 details
});

test('sanitizeTitle 去控制字符/反引号,截 40', () => {
  assert.equal(sanitizeTitle('a`b\x07c\n\td'), 'a b c d');
  assert.equal(sanitizeTitle('x'.repeat(60)).length, 40);
});

/* ── handlePost 编排 ──────────────────────────── */

test('v2 主链路:SUBMITTED + 入库 + 单条 issue(AC-F1)', async () => {
  const store = memStore(), gh = ghFake();
  const { status, body } = await jsonOf(await post({ body: payload(), store, gh: gh.ok }));
  assert.equal(status, 200);
  assert.equal(body.code, 'SUBMITTED');
  assert.match(body.id, /^GG-/);
  const row = store.rows[0];
  assert.equal(row.kind, 'problem');
  assert.equal(row.sender_uid, '2025090270209');
  assert.ok(row.diag_json.includes('limit_users'));
  assert.equal(row.issue_id, 701);                        // 回写
  assert.equal(gh.calls.length, 1);
  assert.ok(gh.calls[0].title.includes('GG-'));
  assert.deepEqual(gh.calls[0].labels, ['problem']);
});

test('幂等:同 client_id 重发返回原 GG-xx,不开第二条 issue(AC-F4)', async () => {
  const store = memStore(), gh = ghFake();
  const first = await jsonOf(await post({ body: payload(), store, gh: gh.ok }));
  const second = await jsonOf(await post({ body: payload({ what: '重发' }), store, gh: gh.ok }));
  assert.equal(second.status, 200);
  assert.equal(second.body.id, first.body.id);
  assert.equal(second.body.replay, true);
  assert.equal(store.rows.length, 1);
  assert.equal(gh.calls.length, 1);
});

test('限频:client_id 30/h、桌面 IP 300/h、匿名 IP 8/h,429 带 retry_after(AC-F10)', async () => {
  // client 层:重放未命中而行数已满(行被 90 天清理/竞态窗的防御路径)
  const s1 = memStore();
  s1.findClientId = async () => null;
  for (let i = 0; i < 30; i++)
    s1.rows.push({ id: 100 + i, client_id: '8f14e45f-9a4c-4a8b-9d1e-111111111111', ip: '1.1.1.1', created_at: nowIso(), issue_id: 1, issue_at: nowIso() });
  const r1 = await jsonOf(await post({
    body: payload(), store: s1, headers: { 'user-agent': 'GuiguiDesktop/2.1.0' } }));
  assert.equal(r1.status, 429);
  assert.equal(r1.body.code, 'RATE_LIMITED');
  assert.ok(r1.body.retry_after >= 60);

  // 匿名 IP 层:9 条同 IP(不同 client_id)
  const s2 = memStore();
  for (let i = 0; i < 8; i++)
    s2.rows.push({ id: 200 + i, client_id: 'c' + i, ip: '2.2.2.2', created_at: nowIso(), issue_id: 1, issue_at: nowIso() });
  const r2 = await jsonOf(await post({
    body: payload({ client_id: '8f14e45f-9a4c-4a8b-9d1e-222222222222' }),
    store: s2, headers: { 'user-agent': 'Mozilla/5.0', 'cf-connecting-ip': '2.2.2.2' },
  }));
  assert.equal(r2.status, 429);

  // 桌面标记 IP 层:同 IP 第 300 条仍放行(300/h 挡的是第 301)
  const s3 = memStore();
  for (let i = 0; i < 299; i++)
    s3.rows.push({ id: 300 + i, client_id: 'c' + i, ip: '3.3.3.3', created_at: nowIso(), issue_id: 1, issue_at: nowIso() });
  const r3 = await jsonOf(await post({
    body: payload({ client_id: '8f14e45f-9a4c-4a8b-9d1e-333333333333' }),
    store: s3, headers: { 'user-agent': 'GuiguiDesktop/2.1.0', 'cf-connecting-ip': '3.3.3.3' },
  }));
  assert.equal(r3.status, 200);
  // 同 IP 第 301 条:拦
  const r4 = await jsonOf(await post({
    body: payload({ client_id: '8f14e45f-9a4c-4a8b-9d1e-444444444444' }),
    store: s3, headers: { 'user-agent': 'GuiguiDesktop/2.1.0', 'cf-connecting-ip': '3.3.3.3' },
  }));
  assert.equal(r4.status, 429);
});

test('64KB 大包早拒,不进 JSON 解析(AC-F10 第 4 层)', async () => {
  const store = memStore();
  // content-length 是 fetch 禁设头,构造层用最小假 request 直打编排层
  const fake = { headers: { get: (h) => (h === 'content-length' ? String(65 * 1024) : null) } };
  const r = await handlePost({ request: fake, env: {}, store, gh: ghFake().ok });
  const body = await r.json();
  assert.equal(r.status, 413);
  assert.equal(body.code, 'VALIDATION');
  assert.equal(store.rows.length, 0);
});

test('issue 预算闸:预算耗尽只入 D1,DEGRADED 不丢(AC-F15)', async () => {
  const store = memStore(), gh = ghFake();
  for (let i = 0; i < 500; i++)
    store.rows.push({ id: 500 + i, client_id: 'b' + i, ip: '9.9.9.9', created_at: nowIso(), issue_id: 1, issue_at: nowIso() });
  const { status, body } = await jsonOf(await post({
    body: payload({ client_id: '8f14e45f-9a4c-4a8b-9d1e-444444444444' }), store, gh: gh.ok }));
  assert.equal(status, 200);
  assert.equal(body.code, 'SUBMITTED_DEGRADED');
  assert.equal(body.issue_pending, true);
  assert.equal(gh.calls.length, 0);                       // 不发起 GitHub 调用
});

test('GitHub 挂:D1 成功仍 200 DEGRADED;连续失败 ≥10 打 gh_broken(AC-F7 前半)', async () => {
  const store = memStore(), gh = ghFake();
  const headers = { 'user-agent': 'GuiguiDesktop/2.1.0' };   // 桌面层,300/h 放行 12 连发
  for (let i = 0; i < 12; i++) {
    const { body } = await jsonOf(await post({
      body: payload({ client_id: '8f14e45f-9a4c-4a8b-9d1e-5' + String(i).padStart(7, '0') }),
      store, gh: gh.fail, headers }));
    assert.equal(body.code, 'SUBMITTED_DEGRADED');        // issue 失败永不失败请求
  }
  assert.equal(store.rows.length, 12);
  assert.equal(store.ops.get('gh_fail_streak'), '12');
  assert.ok(store.ops.get('gh_broken_since'));            // 报警置位(§6.5)
});

test('D1 挂 + GitHub 活:issue 直建,回执 GH- 前缀(§6.3)', async () => {
  const gh = ghFake();
  const down = {
    ...memStore(),
    async findClientId() { return undefined; },           // undefined = D1 不可达
    async countClient() { return undefined; },
    async countIp() { return undefined; },
    async insert() { return { ok: false, conflict: false }; },
    async budgetUsed() { return 0; },
  };
  const { status, body } = await jsonOf(await post({ body: payload(), store: down, gh: gh.ok }));
  assert.equal(status, 200);
  assert.equal(body.code, 'SUBMITTED');
  assert.match(body.id, /^GH-\d+$/);
  assert.equal(body.storage, 'issue_only');
});

test('双挂:SINK_DOWN 503(§4.2)', async () => {
  const gh = ghFake();
  const down = {
    ...memStore(),
    async findClientId() { return undefined; },
    async countClient() { return undefined; },
    async countIp() { return undefined; },
    async insert() { return { ok: false, conflict: false }; },
  };
  const { status, body } = await jsonOf(await post({ body: payload(), store: down, gh: gh.fail }));
  assert.equal(status, 503);
  assert.equal(body.code, 'SINK_DOWN');
});

test('v1 兼容:旧表单照常入库,旧响应形状(AC-F12)', async () => {
  const store = memStore(), gh = ghFake();
  const { status, body } = await jsonOf(await post({
    body: { what: '官网表单反馈', when: '今天早上', contact: 'qq1', log: 'log tail' }, store, gh: gh.ok }));
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.match(body.id, /^GG-/);
  const row = store.rows[0];
  assert.ok(row.client_id == null);                       // 默认值映射(null/undefined)
  assert.equal(row.kind, 'problem');
  assert.ok(row.diag_json == null);
  assert.equal(gh.calls.length, 0);                       // v1 不开 issue
});

test('v2 VALIDATION:400 + fields 表单内提示', async () => {
  const store = memStore();
  const { status, body } = await jsonOf(await post({ body: payload({ kind: [] }), store }));
  assert.equal(status, 400);
  assert.equal(body.code, 'VALIDATION');
  assert.ok(body.fields.kind);
  assert.equal(store.rows.length, 0);
});

/* ── S4:对账端点 + meta-issue 报警 + 管理端健康(AC-F7/F14)── */

import { handleReconcile, handleList } from '../lib/fb-core.js';

const recon = async ({ key, store, gh, env }) => handleReconcile({
  request: new Request(`https://x/fb/reconcile?key=${key ?? 'k1'}`),
  env: { CRON_KEY: 'k1', ...(env || {}) }, store, gh,
});

async function seedPending(store, n) {
  // 预算闸耗尽时提交留下的存量:D1 有行、issue 缺失
  for (let i = 0; i < n; i++)
    store.rows.push({
      id: 900 + i, created_at: nowIso(), ip: '4.4.4.4',
      kind: 'problem', client_id: 'seed' + i, sender_uid: '2025090270209',
      app_ver: '2.1.0', what: '灾情日积压 ' + i, when_desc: '', contact: '',
      diag_json: JSON.stringify({ env: {}, self: {} }),
    });
}

test('reconcile:key 错 → 403', async () => {
  const r = await recon({ key: 'wrong', store: memStore(), gh: ghFake().ok });
  assert.equal(r.status, 403);
});

test('reconcile:补建积压 + 幂等重跑不重复(AC-F14)', async () => {
  const store = memStore(), gh = ghFake();
  await seedPending(store, 3);
  const first = await jsonOf(await recon({ store, gh: gh.ok }));
  assert.equal(first.status, 200);
  assert.equal(first.body.code, 'RECONCILED');
  assert.equal(first.body.created, 3);
  assert.equal(first.body.pending_issues, 0);
  assert.equal(gh.calls.length, 3);                        // 一行一 issue,标题含 GG-
  assert.ok(gh.calls.every((c) => c.title.includes('GG-')));
  // 重跑:无积压可补,零调用
  const second = await jsonOf(await recon({ store, gh: gh.ok }));
  assert.equal(second.body.created, 0);
  assert.equal(gh.calls.length, 3);
});

test('reconcile:GitHub 失败 → 行回滚留下一轮,报警也发不出去时走 D1 兜底(AC-F7)', async () => {
  const store = memStore(), gh = ghFake();
  await seedPending(store, 2);
  const first = await jsonOf(await recon({ store, gh: gh.fail }));
  assert.equal(first.body.failed, 2);
  assert.equal(first.body.pending_issues, 2);              // unclaim 回滚
  assert.equal(first.body.alerted, false);                 // GH 挂 → 评论也发不出(§6.5 兜底场景)
  assert.equal(gh.comments.length, 0);
  assert.equal(store.ops.get('gh_fail_streak'), '2');      // D1 计数在涨(≥10 置 gh_broken 红字)
  // PAT 换新后一次调用追平(AC-F7 后半)
  const third = await jsonOf(await recon({ store, gh: gh.ok }));
  assert.equal(third.body.created, 2);
  assert.equal(third.body.pending_issues, 0);
});

test('reconcile:预算限速积压 → meta-issue 评论报警 + 1h 节流(AC-F14)', async () => {
  const store = memStore(), gh = ghFake();
  for (let i = 0; i < 500; i++)
    store.rows.push({ id: 9500 + i, client_id: 'b' + i, ip: '5.5.5.5',
      created_at: nowIso(), issue_id: 1, issue_at: nowIso(), diag_json: '{}' });
  await seedPending(store, 3);
  const first = await jsonOf(await recon({ store, gh: gh.ok }));
  assert.equal(first.body.code, 'BUDGET_EXHAUSTED');
  assert.equal(first.body.pending_issues, 3);
  assert.equal(first.body.alerted, true);                  // GH 健康 → 已有 OPEN meta(555)评论追加
  assert.equal(gh.comments.length, 1);
  assert.ok(gh.comments[0].body.includes('预算'));
  assert.equal(gh.calls.length, 0);                       // 预算耗尽:零 GitHub 建单调用
  const second = await jsonOf(await recon({ store, gh: gh.ok }));
  assert.equal(second.body.alerted, false);               // 1/h 节流,不刷屏
  assert.equal(gh.comments.length, 1);
});

test('reconcile:预算耗尽且无积压 → 不报警', async () => {
  const store = memStore(), gh = ghFake();
  for (let i = 0; i < 500; i++)
    store.rows.push({ id: 9500 + i, client_id: 'b' + i, ip: '5.5.5.5',
      created_at: nowIso(), issue_id: 1, issue_at: nowIso(), diag_json: '{}' });
  const r = await jsonOf(await recon({ store, gh: gh.ok }));
  assert.equal(r.body.alerted, false);
  assert.equal(gh.comments.length, 0);
});

test('reconcile:预算耗尽本轮不动,不发起 GitHub 调用', async () => {
  const store = memStore(), gh = ghFake();
  for (let i = 0; i < 500; i++)
    store.rows.push({ id: 9500 + i, client_id: 'b' + i, ip: '5.5.5.5',
      created_at: nowIso(), issue_id: 1, issue_at: nowIso(), diag_json: '{}' });
  await seedPending(store, 1);
  const r = await jsonOf(await recon({ store, gh: gh.ok }));
  assert.equal(r.body.code, 'BUDGET_EXHAUSTED');
  assert.equal(r.body.pending_issues, 1);
  assert.equal(gh.calls.length, 0);
});

test('并发对账:claim 抢占,同一行只补建一次', async () => {
  const store = memStore();
  await seedPending(store, 1);
  assert.equal(await store.claimIssue(store.rows[0].id), true);
  assert.equal(await store.claimIssue(store.rows[0].id), false);   // 第二个并发者抢不到
  await store.unclaimIssue(store.rows[0].id);
  assert.equal(await store.claimIssue(store.rows[0].id), true);    // 回滚后可再抢
});

test('list:key 错 → 403;对则带健康区', async () => {
  const store = memStore(), gh = ghFake();
  const bad = await handleList({
    request: new Request('https://x/fb/list?key=wrong'),
    env: { ADMIN_KEY: 'a1' }, store });
  assert.equal(bad.status, 403);

  await seedPending(store, 2);                              // 2 条待补
  store.ops.set('gh_broken_since', nowIso());               // PAT 失效红字
  const r = await jsonOf(await handleList({
    request: new Request('https://x/fb/list?key=a1'),
    env: { ADMIN_KEY: 'a1' }, store }));
  assert.equal(r.status, 200);
  assert.equal(r.body.items.length, 2);
  assert.equal(r.body.health.pending_issues, 2);
  assert.equal(r.body.health.gh_broken, true);
  assert.ok(r.body.health.last_insert_at);
});
