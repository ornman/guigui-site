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
  return {
    async create({ title, body, labels }) {
      const pat = env.GH_PAT, repo = env.GH_REPO;
      if (!pat || !repo) return { ok: false, status: 0 };      // 未配置 = 建不了,降级
      try {
        const res = await fetchImpl(`https://api.github.com/repos/${repo}/issues`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${pat}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json',
            'User-Agent': 'guigui-fb',
          },
          body: JSON.stringify({ title, body, labels }),
          signal: AbortSignal.timeout(5000),
        });
        if (!(res.status >= 200 && res.status < 300)) return { ok: false, status: res.status };
        const data = await res.json();
        return { ok: true, number: data.number, url: data.html_url };
      } catch { return { ok: false, status: 0 }; }             // timeout/网络:永不抛(§6.5)
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

export async function handlePost({ request, env, store, gh }) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > LIMITS.payload)
    return json({ ok: false, code: 'VALIDATION', message: '包太大' }, 413);

  let d;
  try { d = await request.json(); } catch {
    return json({ error: '请求格式不对' }, 400);               // v1 形状(旧表单)
  }

  if (d && d.v === 2) return postV2({ d, request, env, store, gh });
  return postV1({ d, request, store });
}

async function postV2({ d, request, env, store, gh }) {
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
    if (made.number) return json({ ok: true, code: 'SUBMITTED', id: `GH-${made.number}`, storage: 'issue_only' });
    return json({ ok: false, code: 'SINK_DOWN', message: '两边都够不着,稍后自动补发' }, 503);
  }

  const made = await makeIssue(gh, store, { ...rec, id: ggId(rowId) }, env, true, rowId);
  const code = made.number ? 'SUBMITTED' : 'SUBMITTED_DEGRADED';
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
