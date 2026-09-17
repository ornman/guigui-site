/* 静态断言:4 处 GitHub 链接 + 页脚年份标记是否齐全。
 * 跑 npm test:与 fb/dl 套共用。纯文本扫描,零依赖。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'site', 'index.html'), 'utf8');

test('GitHub 抽常量后:页面只剩占位,不再持有绝对 URL', () => {
  const direct = html.match(/href="https:\/\/github\.com\//g) || [];
  assert.equal(direct.length, 0, '页面里不该再有任何 GitHub 绝对 URL,全走 data-gh-repo 占位');
});

test('GitHub 抽常量后:4 处占位齐,prod×3 / issues×1', () => {
  const prod = html.match(/data-gh-repo="prod"/g) || [];
  const issues = html.match(/data-gh-repo="issues"/g) || [];
  assert.equal(prod.length, 3, 'prod 仓(Star/Hero/查看源码)应该是 3 处');
  assert.equal(issues.length, 1, 'issues 仓(反馈 Issue 链)应该是 1 处');
});

test('GitHub 抽常量后:常量定义在脚本顶部,4 处共享同一 source-of-truth', () => {
  assert.match(html, /var GH_REPO = 'ornman\/guigui';/);
  assert.match(html, /var GH_ISSUES_REPO = 'ornman\/guigui-site';/);
  assert.match(html, /document\.querySelectorAll\('\[data-gh-repo\]'\)\.forEach/);
});

test('页脚年份:2026 写死移除,改 footer-year 占位 + JS 自动取当前年', () => {
  assert.doesNotMatch(html, /© 2026 桂林/, '页面里不该再有 © 2026 静态字面量');
  assert.match(html, /<span class="footer-year">2026<\/span>/, '年份占位兜底文本');
  assert.match(html, /footer-year'\)\.forEach\(function\(el\)\{ el\.textContent = new Date\(\)\.getFullYear\(\)/, 'JS 自动取当前年');
});