/* fb-core.js — /fb v2 服务端核心(PRD §7.2)。
 *
 * 分层:
 *   纯函数:validate / normalize / render_issue / md 转义助手
 *   Adapter:d1Store(SQL)/ githubAdapter(fetch,5s 超时,任何异常→失败)
 *   编排:handlePost({request, env, store, gh}) —— handler 只做读 secrets 与注入
 *
 * 契约唯一来源:PRD docs/prd/guigui-feedback-system.md §4.1(附录 B)。
 * 不变量:issue 失败永不失败用户请求;同 client_id 返回同 GG-xx;
 *         v1 载荷(无 v 字段)按默认值映射照常入库。
 */

export const LIMITS = {
  what: 120, when: 20, contact: 80,
  sender_uid: 32, app_ver: 20, latest_ver: 20, client_id: 64,
  summary: 240,
  logs_days: 7, logs_per_day: 80, crashes: 3,
  diag_json: 48 * 1024,
  payload: 64 * 1024,          // Content-Length 早拒(不进 JSON 解析)
};
export const KINDS = ['problem', 'suggestion'];
export const RATE = { client: 30, desktop_ip: 300, anon_ip: 8 };
const CLIENT_ID_RE = /^[0-9a-fA-F-]{8,64}$/;

const json = (obj, status) => new Response(JSON.stringify(obj), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8' },
});
const cut = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
export const nowIso = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
export const hourAgoIso = () =>
  new Date(Date.now() - 3600e3).toISOString().replace('T', ' ').slice(0, 19);
export const ggId = (rowId) => 'GG-' + Number(rowId).toString(36).toUpperCase();

/* ── 校验与归一(§4.1)──────────────────────────── */

export function validate(d) {
  const problems = {};
  if (!(typeof d === 'object' && d !== null)) return { ok: false, problems: { _: '请求格式不对' } };

  if (d.v !== 2) problems.v = '协议版本不对';
  if (typeof d.client_id !== 'string' || !CLIENT_ID_RE.test(d.client_id))
    problems.client_id = 'client_id 不合法';
  const kind = Array.isArray(d.kind) ? d.kind.filter((k) => KINDS.includes(k)) : [];
  if (!kind.length) problems.kind = '分类至少选一个(问题/建议)';
  const what = typeof d.what === 'string' ? d.what.trim() : '';
  if (!what) problems.what = '缺「说说具体情况」';
  else if (what.length > LIMITS.what) problems.what = `具体情况限 ${LIMITS.what} 字`;
  if (cut(d.contact, 1e9).length > LIMITS.contact) problems.contact = `联系方式限 ${LIMITS.contact} 字`;
  if (typeof d.env !== 'object' || d.env === null) problems.env = '缺环境区';
  if (typeof d.self !== 'object' || d.self === null) problems.self = '缺自身区';
  if (Object.keys(problems).length) return { ok: false, problems };

  return {
    ok: true,
    norm: {
      v: 2,
      client_id: d.client_id,
      kind: [...new Set(kind)],
      what,
      contact: cut(d.contact, LIMITS.contact),
      when: cut(d.when, LIMITS.when),
      sender_uid: cut(d.sender_uid, LIMITS.sender_uid),
      app: d.app === 'web' ? 'web' : 'desktop',
      app_ver: cut(d.app_ver, LIMITS.app_ver),
      diag: normalizeDiag(d),
    },
  };
}

/* 诊断区归一:类型必须对;字符串截断(机器生成,悄悄截);数组按容量切片。 */
function normalizeDiag(d) {
  const diag = {};
  const obj = (x) => (typeof x === 'object' && x !== null && !Array.isArray(x) ? trimDeep(x) : { errors: ['形状不对'] });
  diag.env = obj(d.env);
  diag.self = obj(d.self);
  for (const key of ['net', 'server']) if (d[key] !== undefined) diag[key] = obj(d[key]);
  if (d.logs !== undefined) {
    diag.logs = Array.isArray(d.logs)
      ? d.logs.slice(0, LIMITS.logs_days).map((day) => ({
        date: cut(day && day.date, 10),
        entries: Array.isArray(day && day.entries)
          ? day.entries.slice(0, LIMITS.logs_per_day).map((e) => trimDeep(e || {}))
          : [],
      })) : [];
  }
  if (d.crashes !== undefined) {
    diag.crashes = Array.isArray(d.crashes)
      ? d.crashes.slice(0, LIMITS.crashes).map((c) => trimDeep(c || {})) : [];
  }
  if (d.summary !== undefined) diag.summary = cut(d.summary, LIMITS.summary);
  if (d.latest_ver !== undefined)
    diag.latest_ver = d.latest_ver === null ? null : cut(d.latest_ver, LIMITS.latest_ver);
  return diag;
}

const KEY_TRIM = { body_head: 120, msga: 120, raw_head: 120, ubind: 200, trace: 8192, text: 200 };
function trimDeep(v, depth = 0) {
  if (typeof v === 'string') return v.slice(0, 240);
  if (Array.isArray(v)) return v.slice(0, 60).map((x) => trimDeep(x, depth + 1));
  if (v === null || typeof v !== 'object' || depth >= 6) return v;
  const out = {};
  for (const [k, val] of Object.entries(v)) {
    out[k] = typeof val === 'string' && KEY_TRIM[k] ? val.slice(0, KEY_TRIM[k]) : trimDeep(val, depth + 1);
  }
  return out;
}

/* ── issue 渲染(§6.1.4:版式改边缘端即时生效)────
 * 注入防护(§6.6):用户字符串一律代码字面量(自适应反引号围栏);
 * 标题去控制字符/反引号;诊断区整体入 fenced block;标签服务端固定。 */

function fenceFor(s) {
  const runs = String(s).match(/`+/g) || [];
  const longest = runs.reduce((m, r) => Math.max(m, r.length), 0);
  return '`'.repeat(Math.max(3, longest + 1));
}
function fenced(s, lang = '') {
  const f = fenceFor(s);
  return `${f}${lang}\n${s}\n${f}`;
}

export function sanitizeTitle(s) {
  return String(s || '')
    .replace(/[\x00-\x1f\x7f`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}

export function render_issue(rec) {
  const kindWord = rec.kind.includes('problem') ? '问题' : '建议';
  const labels = KINDS.filter((k) => rec.kind.includes(k));      // 服务端固定,payload 永不决定 label
  const lines = [];
  lines.push(`### ${rec.id} · ${kindWord}`);
  lines.push('');
  lines.push(`| 字段 | 值 |`);
  lines.push(`| --- | --- |`);
  lines.push(`| 回执 | ${rec.id} |`);
  lines.push(`| 分类 | ${labels.join(' + ')} |`);
  lines.push(`| 版本 | ${rec.app_ver || '?'}(最新 ${rec.diag.latest_ver ?? '?'}) |`);
  lines.push(`| 学号 | ${rec.sender_uid || '—'} |`);
  lines.push(`| 联系 | ${rec.contact || '—'} |`);
  lines.push(`| 时间 | ${rec.when || '—'} · 入库 ${rec.created_at} |`);
  lines.push('');
  lines.push('**用户说:**');
  lines.push('');
  lines.push(fenced(rec.what));
  lines.push('');

  const region = (title, key, fold) => {
    const value = rec.diag[key];
    if (value === undefined) return;
    const body = fenced(JSON.stringify(value, null, 1), 'json');
    lines.push(fold ? `<details><summary>${title}</summary>\n\n${body}\n\n</details>` : `**${title}**\n\n${body}`);
    lines.push('');
  };
  region('环境 env', 'env');
  region('自身 self', 'self');
  region('网络 net(实时)', 'net');
  region('服务器 server', 'server');
  region(`日志 logs(${rec.diag.logs ? rec.diag.logs.length : 0} 天)`, 'logs', true);
  if (rec.diag.summary !== undefined) {
    lines.push(`**七天摘要:** \`${rec.diag.summary.replace(/`/g, "'")}\``);
    lines.push('');
  }
  region('崩溃 crashes', 'crashes', true);
  return { title: `[反馈·${kindWord}] ${rec.id} · ${sanitizeTitle(rec.what)}`, body: lines.join('\n'), labels };
}

/* ── Adapters ─────────────────────────────────── */

export function d1Store(env) {
  const q = async (sql, ...bind) => {
    const { results, meta } = await env.DB.prepare(sql).bind(...bind).all();
    return { results: results || [], meta };
  };
  return {
    d1: true,
    async findClientId(client_id) {
      try {
        const { results } = await q('SELECT id FROM fb WHERE client_id = ?1', client_id);
        return results[0] ? results[0].id : null;
      } catch { return undefined; }        // undefined = D1 不可达(区别于 null=没有)
    },
    async countClient(client_id, since) {
      try {
        const { results } = await q(
          'SELECT COUNT(*) AS c FROM fb WHERE client_id = ?1 AND created_at > ?2', client_id, since);
        return results[0].c;
      } catch { return undefined; }
    },
    async countIp(ip, since) {
      try {
        const { results } = await q(
          'SELECT COUNT(*) AS c FROM fb WHERE ip = ?1 AND created_at > ?2', ip, since);
        return results[0].c;
      } catch { return undefined; }
    },
    async insert(row) {
      try {
        const { meta } = await q(
          `INSERT INTO fb (ip, ua, what, when_desc, contact, log, kind, client_id, sender_uid, app_ver, diag_json)
           VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)`,
          row.ip, row.ua, row.what, row.when_desc || null, row.contact || null,
          row.log || null, row.kind || 'problem', row.client_id || null,
          row.sender_uid || null, row.app_ver || null, row.diag_json || null);
        return { ok: true, id: meta.last_row_id };
      } catch (e) {
        const msg = String((e && e.message) || e);
        if (/UNIQUE|constraint/i.test(msg)) return { ok: false, conflict: true };
        return { ok: false, conflict: false };    // D1 挂
      }
    },
    async setIssue(id, issueId, issueAt) {
      try {
        await q('UPDATE fb SET issue_id = ?1, issue_at = ?2 WHERE id = ?3', issueId, issueAt, id);
        return true;
      } catch { return false; }
    },
    async budgetUsed(since) {
      try {
        const { results } = await q(
          'SELECT COUNT(*) AS c FROM fb WHERE issue_id IS NOT NULL AND issue_at > ?1', since);
        return results[0].c;
      } catch { return 0; }
    },
    async pendingIssues(limit) {
      const { results } = await q(
        'SELECT id, kind, client_id, sender_uid, app_ver, what, when_desc, contact, diag_json, created_at FROM fb WHERE issue_id IS NULL AND diag_json IS NOT NULL AND kind != \'alert\' ORDER BY id LIMIT ?1', limit);
      return results;
    },
    async claimIssue(rowId) {
      // 条件更新当锁:抢到(issue_id 从 NULL → -1)才允许补建,双 reconcile 并发安全
      const { meta } = await q(
        'UPDATE fb SET issue_id = -1 WHERE id = ?1 AND issue_id IS NULL', rowId);
      return (meta.changes || 0) === 1;
    },
    async unclaimIssue(rowId) {
      try {
        await q('UPDATE fb SET issue_id = NULL WHERE id = ?1 AND issue_id = -1', rowId);
        return true;
      } catch { return false; }
    },
    async health() {
      try {
        const p = await q('SELECT COUNT(*) AS c FROM fb WHERE issue_id IS NULL AND diag_json IS NOT NULL');
        const l = await q('SELECT MAX(created_at) AS m FROM fb');
        return {
          pending_issues: p.results[0].c,
          last_insert_at: l.results[0].m || null,
          gh_fail_streak: Number((await this.opGet('gh_fail_streak')) || 0),
          gh_broken: !!(await this.opGet('gh_broken_since')),
        };
      } catch { return { pending_issues: null, last_insert_at: null }; }
    },
    async recentRows(limit) {
      const { results } = await q(
        `SELECT id, created_at, ip, kind, what, when_desc, contact, issue_id, app_ver
         FROM fb ORDER BY id DESC LIMIT ?1`, limit);
      return results;
    },
    async opGet(k) {
      try {
        const { results } = await q('SELECT v FROM fb_ops WHERE k = ?1', k);
        return results[0] ? results[0].v : null;
      } catch { return null; }
    },
    async opIncr(k) {
      try {
        await q(`INSERT INTO fb_ops (k, v) VALUES (?1, '1')
                 ON CONFLICT(k) DO UPDATE SET v = CAST(CAST(v AS INTEGER) + 1 AS TEXT)`, k);
        return true;
      } catch { return false; }
    },
    async opSet(k, v) {
      try {
        await q('INSERT INTO fb_ops (k, v) VALUES (?1, ?2) ON CONFLICT(k) DO UPDATE SET v = ?2', k, String(v));
        return true;
      } catch { return false; }
    },
  };
}

export function githubAdapter(env, fetchImpl = fetch) {
  const call = async (url, init = {}) => {
    const pat = env.GH_PAT, repo = env.GH_REPO;
    if (!pat || !repo) return { ok: false, status: 0 };      // 未配置 = 建不了,降级
    try {
      const res = await fetchImpl(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${pat}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
          'User-Agent': 'guigui-fb',
        },
        signal: AbortSignal.timeout(5000),
      });
      if (!(res.status >= 200 && res.status < 300))
        return { ok: false, status: res.status };
      return { ok: true, status: res.status, data: await res.json() };
    } catch { return { ok: false, status: 0 }; }             // timeout/网络:永不抛(§6.5)
  };
  const repoUrl = (path) => `https://api.github.com/repos/${env.GH_REPO}${path}`;
  return {
    async create({ title, body, labels }) {
      const r = await call(repoUrl('/issues'),
        { method: 'POST', body: JSON.stringify({ title, body, labels }) });
      return r.ok ? { ok: true, number: r.data.number } : { ok: false, status: r.status };
    },
    async findOpenMeta() {
      // 已 OPEN 的报警 meta-issue(§6.3:评论追加,不每次新开;search 端点在根路径)
      const q = encodeURIComponent('is:issue is:open label:meta');
      const r = await call(`https://api.github.com/search/issues?per_page=1&q=${q}`);
      return r.ok && r.data.items && r.data.items.length ? r.data.items[0].number : null;
    },
    async comment(number, body) {
      const r = await call(repoUrl(`/issues/${number}/comments`),
        { method: 'POST', body: JSON.stringify({ body }) });
      return r.ok;
    },
  };
}

/* GitHub 调用结果 → 失败计数/报警(§6.5:连续 ≥10 失败 → gh_broken) */
async function trackGh(store, result) {
  if (result.ok) {
    await store.opSet('gh_fail_streak', 0);
    await store.opSet('gh_broken_since', '');
  } else {
    await store.opIncr('gh_fail_streak');
    const streak = Number(await store.opGet('gh_fail_streak') || 0);
    if (streak >= 10 && !(await store.opGet('gh_broken_since')))
      await store.opSet('gh_broken_since', nowIso());
  }
}

/* ── POST /fb 编排 ────────────────────────────── */

export async function handlePost({ request, env, store, gh, board, ctx }) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > LIMITS.payload)
    return json({ ok: false, code: 'VALIDATION', message: '包太大' }, 413);

  let d;
  try { d = await request.json(); } catch {
    return json({ error: '请求格式不对' }, 400);               // v1 形状(旧表单)
  }

  if (d && d.v === 2) return postV2({ d, request, env, store, gh, board, ctx });
  return postV1({ d, request, store });
}

async function postV2({ d, request, env, store, gh, board, ctx }) {
  const { ok, problems, norm } = validate(d);
  if (!ok) {
    const message = Object.values(problems)[0];
    return json({ ok: false, code: 'VALIDATION', message, fields: problems }, 400);
  }

  // 幂等(§6.3):重复提交返回原 GG-xx,不重复开 issue;重放不计限频
  const existing = await store.findClientId(norm.client_id);
  if (existing !== undefined && existing !== null)
    return json({ ok: true, code: 'SUBMITTED', id: ggId(existing), replay: true });

  // 四层限频之三层计数层(§6.2;payload 早拒已在最前)
  const ip = request.headers.get('cf-connecting-ip') || '';
  const ua = cut(request.headers.get('user-agent'), 200);
  const since = hourAgoIso();
  const desktop = ua.startsWith('GuiguiDesktop/');
  const cClient = await store.countClient(norm.client_id, since);
  if (cClient !== undefined && cClient >= RATE.client)
    return json({ ok: false, code: 'RATE_LIMITED', retry_after: 3600, message: '提交太频繁,稍后自动补发' }, 429);
  const cIp = await store.countIp(ip, since);
  if (cIp !== undefined && cIp >= (desktop ? RATE.desktop_ip : RATE.anon_ip))
    return json({ ok: false, code: 'RATE_LIMITED', retry_after: 3600, message: '提交太频繁,稍后自动补发' }, 429);

  const diag_json = JSON.stringify(norm.diag);
  if (diag_json.length > LIMITS.diag_json * 2)
    return json({ ok: false, code: 'VALIDATION', message: '诊断包超尺寸' }, 400);
  const ins = await store.insert({
    ip, ua, what: norm.what, when_desc: norm.when, contact: norm.contact,
    kind: norm.kind.join('+'), client_id: norm.client_id,
    sender_uid: norm.sender_uid, app_ver: norm.app_ver, diag_json,
  });

  if (ins.conflict) {                                            // 幂等竞态:并发同 client_id
    const again = await store.findClientId(norm.client_id);
    if (again) return json({ ok: true, code: 'SUBMITTED', id: ggId(again), replay: true });
  }

  const rowId = ins.ok ? ins.id : null;
  const rec = {
    id: rowId ? ggId(rowId) : null,
    kind: norm.kind, what: norm.what, when: norm.when, contact: norm.contact,
    sender_uid: norm.sender_uid, app_ver: norm.app_ver,
    created_at: nowIso(), diag: norm.diag,
  };

  if (!ins.ok) {
    // D1 挂 → issue 直建,回执 GH-<号>(§6.3:此类以 issue 为唯一存底,无对账义务)
    const made = await makeIssue(gh, store, rec, env, false, null);
    if (made.number) {
      await fanOutBoard(board, ctx, rec, `GH-${made.number}`);
      return json({ ok: true, code: 'SUBMITTED', id: `GH-${made.number}`, storage: 'issue_only' });
    }
    return json({ ok: false, code: 'SINK_DOWN', message: '两边都够不着,稍后自动补发' }, 503);
  }

  const rec2 = { ...rec, id: ggId(rowId) };
  const made = await makeIssue(gh, store, rec2, env, true, rowId);
  const code = made.number ? 'SUBMITTED' : 'SUBMITTED_DEGRADED';
  if (made.number) await fanOutBoard(board, ctx, rec2, ggId(rowId));
  return json({ ok: true, code, id: ggId(rowId), issue_pending: !made.number });
}

/* 预算闸(§6.5)+ issue 后建(尽力而为);rowId 非空时回写 issue_id。
 * 返回 {number|null, skipped?};issue 的任何失败都不失败用户请求(§6.5 不变量)。 */
async function makeIssue(gh, store, rec, env, budgetCheck, rowId) {
  if (budgetCheck) {
    const budget = Number(env && env.ISSUE_BUDGET_PER_HOUR) || 500;
    if (await store.budgetUsed(hourAgoIso()) >= budget) return { number: null, skipped: 'budget' };
  }
  const { title, body, labels } = render_issue(rec);
  const result = await gh.create({ title, body, labels });
  await trackGh(store, result);
  if (result.ok && rowId != null) await store.setIssue(rowId, result.number, nowIso());
  return result.number ? { number: result.number } : { number: null };
}

/* ── 反馈板匿名上板(2026-09-13,路由 b 拍板)────────────────
 * issue 首建成功后,把用户的一句话以匿名帖同步到公开板(guigui-guat.pages.dev/zh,
 * 自部署 feedlog)。尽力而为:板不可达/板块缺失/任何异常 → 静默跳过,绝不拖回执。
 * 幂等口径:仅请求路径首建 issue 时上板;replay 直接返回不上板,reconcile 补建
 * 不上板(补建行多为 D1 有底但 issue 失败的旧反馈,重上板会重复,v1 先不追)。
 * 链路:POST /api/auth/sign-in/anonymous 拿 Bearer 会话 → GET /api/boards 按
 * 中文名选板(problem 优先→问题反馈,纯 suggestion→功能建议) → POST /api/posts。 */
const BOARD_NAMES = { problem: '问题反馈', suggestion: '功能建议' };

export function boardAdapter(env) {
  const origin = (env && env.FEEDLOG_ORIGIN) || 'https://guigui-guat.pages.dev';
  const jfetch = async (path, opts) => {
    const res = await fetch(origin + path, opts);
    return { ok: res.ok, status: res.status, data: res.ok ? await res.json().catch(() => null) : null };
  };
  return {
    origin,
    async post({ kind, what, ticket }) {
      const kinds = Array.isArray(kind) ? kind : [];
      const boardName = kinds.includes('problem') || !kinds.includes('suggestion')
        ? BOARD_NAMES.problem : BOARD_NAMES.suggestion;
      const flat = String(what || '').trim();
      if (!flat) return null;
      const s = await jfetch('/api/auth/sign-in/anonymous', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
      });
      const token = s.ok && s.data && s.data.token;
      if (!token) return null;
      const b = await jfetch('/api/boards');
      const boards = b.ok && b.data && (Array.isArray(b.data) ? b.data : b.data.data);
      const board = Array.isArray(boards) ? boards.find((x) => x && x.name === boardName) : null;
      if (!board) return null;
      const title = flat.length > 60 ? flat.slice(0, 60) + '…' : flat;
      const p = await jfetch('/api/posts', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
        body: JSON.stringify({
          title,
          content: flat + '\n\n(凭据 ' + ticket + ' · 来自桂桂客户端)',
          boardId: board.id,
        }),
      });
      return p.ok ? p.data : null;
    },
  };
}

/* ctx.waitUntil 在场(生产)=回执先走、上板后台补;无 ctx(测试)=同步等完可断言。 */
async function fanOutBoard(board, ctx, rec, ticket) {
  if (!board) return;
  const p = board.post({ kind: rec.kind, what: rec.what, ticket }).catch(() => null);
  if (ctx && typeof ctx.waitUntil === 'function') { ctx.waitUntil(p); return; }
  await p;
}

/* ── v1 兼容路径(§6.4:旧网页表单,无 v 字段)── */

const V1_MAX = { what: 120, when: 60, contact: 80, log: 4000 };

async function postV1({ d, request, store }) {
  const what = cut(d && d.what, V1_MAX.what);
  if (!what) return json({ error: '缺「什么现象」' }, 400);
  const ip = request.headers.get('cf-connecting-ip') || '';
  const ua = cut(request.headers.get('user-agent'), 200);
  const since = hourAgoIso();
  const cIp = await store.countIp(ip, since);
  if (cIp !== undefined && cIp >= RATE.anon_ip)
    return json({ error: '提交太频繁,一小时后再试' }, 429);
  const ins = await store.insert({
    ip, ua, what,
    when_desc: cut(d.when, V1_MAX.when),
    contact: cut(d.contact, V1_MAX.contact),
    log: cut(d.log, V1_MAX.log),
    kind: 'problem',                       // §6.4:v1 兼容路径按默认值映射
  });
  if (!ins.ok) return json({ error: '服务开小差了,请走邮件反馈' }, 500);
  return json({ ok: true, id: ggId(ins.id) });
}

/* ── POST /fb/reconcile(§6.3 对账端点,调度器无关)──
 * 行为:扫 issue_id IS NULL 的行 → 条件更新抢占 → 逐条补建(预算内,单次≤50 匀速)
 * → 幂等可重跑。PAT 换新后一次调用即追平全部积压。
 * 报警:仍有积压/本轮有失败 → meta-issue 评论追加(节流 1/h;无 OPEN 才新建)。 */

const RECONCILE_BATCH = 50;

function rowToRec(row) {
  let diag = {};
  try { diag = JSON.parse(row.diag_json || '{}'); } catch { /* 坏行按空包渲染 */ }
  return {
    id: ggId(row.id),
    kind: String(row.kind || 'problem').split('+').filter((k) => KINDS.includes(k)),
    what: row.what || '(原文缺失)', when: row.when_desc || '',
    contact: row.contact || '', sender_uid: row.sender_uid || '',
    app_ver: row.app_ver || '', created_at: row.created_at || nowIso(),
    diag,
  };
}

export async function handleReconcile({ request, env, store, gh }) {
  const url = new URL(request.url);
  if (!env.CRON_KEY || url.searchParams.get('key') !== env.CRON_KEY)
    return json({ ok: false, code: 'FORBIDDEN' }, 403);

  const budget = Number(env.ISSUE_BUDGET_PER_HOUR) || 500;
  const used = await store.budgetUsed(hourAgoIso());
  const quota = Math.min(budget - used, RECONCILE_BATCH);
  if (quota <= 0) {
    const health = await store.health();
    // 预算限速中的积压:GH 健康,meta-issue 评论报一次(1/h 节流)
    const alerted = (health.pending_issues || 0) > 0
      ? await metaAlert(store, gh, { created: 0, failed: 0, pending: health.pending_issues })
      : false;
    return json({ ok: true, code: 'BUDGET_EXHAUSTED', created: 0, failed: 0,
                  pending_issues: health.pending_issues, alerted });
  }

  let rows = [];
  try { rows = await store.pendingIssues(quota); }
  catch { return json({ ok: false, code: 'SINK_DOWN' }, 503); }

  let created = 0, failed = 0;
  for (const row of rows) {
    if (!(await store.claimIssue(row.id))) continue;         // 并发对账:抢不到跳过
    const { title, body, labels } = render_issue(rowToRec(row));
    const result = await gh.create({ title, body, labels });
    await trackGh(store, result);
    if (result.ok) {
      await store.setIssue(row.id, result.number, nowIso());
      created++;
    } else {
      await store.unclaimIssue(row.id);                      // 留给下一轮
      failed++;
    }
  }

  const health = await store.health();
  const stillBacklogged = (health.pending_issues || 0) > 0;
  let alerted = false;
  if (stillBacklogged || failed > 0) {
    // GH 挂/PAT 失效时评论也发不出去(metaAlert 返回 false,不抛)——
    // 那正是 §6.5 的兜底场景:gh_fail_streak ≥10 → gh_broken 红字在 /fb/list
    alerted = await metaAlert(store, gh, { created, failed, pending: health.pending_issues });
  }
  return json({ ok: true, code: 'RECONCILED', attempted: rows.length,
                created, failed, pending_issues: health.pending_issues, alerted });
}

/* 报警走 meta-issue 评论追加(§6.3:复用已 OPEN 的,不刷屏;1/h 节流) */
async function metaAlert(store, gh, stats) {
  const last = await store.opGet('last_meta_alert_at');
  if (last && last > hourAgoIso()) return false;
  await store.opSet('last_meta_alert_at', nowIso());
  const lines = [
    `**反馈管道积压:${stats.pending} 条待补建**`,
    `- 本轮补建 ${stats.created} 条,失败 ${stats.failed} 条`,
    stats.failed
      ? '- GitHub 调用失败 — 大概率 GH_PAT 过期/失效,换新后调一次本端点即追平'
      : '- issue 预算限速中,后续对账会自动追平',
  ];
  const body = lines.join('\n');
  const open = await gh.findOpenMeta();
  if (open) return await gh.comment(open, body);
  const made = await gh.create({
    title: '[反馈管道] 积压报警(meta)', body, labels: ['meta'],
  });
  return made.ok;
}

/* ── GET /fb/list(管理端:最近 200 条 + 管道健康)── */

export async function handleList({ request, env, store }) {
  const url = new URL(request.url);
  if (!env.ADMIN_KEY || url.searchParams.get('key') !== env.ADMIN_KEY)
    return json({ error: 'forbidden' }, 403);
  const items = await store.recentRows(200);
  const health = await store.health();
  return json({ items, health });
}
