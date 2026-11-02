#!/usr/bin/env node
/**
 * 易番番（YFF）演示数据装载器。
 *
 * 数据来源：`G:\yesgoo\yff` 项目自带的 25 份模块需求正文（13 章框架）与 4 个真实
 * git 子仓库（backend/base/front/service，阿里云 Codeup nz_erp/*）。所有业务写入
 * 都走正式 `/api/v1` 协议：发布、批准、撤销一律用一次性确认票据换取，脚本不直连
 * 改业务表（例外只有末尾的时间戳回填，用于让流程度量有真实分布）。
 *
 * 用法：
 *   node scripts/seed-yff.mjs --phase accounts
 *   node scripts/seed-yff.mjs --phase knowledge
 *   node scripts/seed-yff.mjs --phase prds
 *   node scripts/seed-yff.mjs --phase workflow
 *   node scripts/seed-yff.mjs --phase tasks
 *   node scripts/seed-yff.mjs --phase misc
 *   node scripts/seed-yff.mjs --phase backdate
 *   node scripts/seed-yff.mjs --phase all
 *
 * 幂等：账号按邮箱复用，项目按 key 复用，其余数据在 `--phase all` 前会检查并跳过
 * 已存在的对象；重复执行不会产生重复项目或重复账号。
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API = process.env.WORKMESH_API ?? 'http://127.0.0.1:3000';
const ORIGIN = process.env.WORKMESH_ORIGIN ?? 'http://127.0.0.1:5173';
const DOC_ROOT = process.env.YFF_DOCS ?? join(root, '.tmp', 'yff-req', '易番番需求');
const PASSWORD = process.env.WORKMESH_SEED_PASSWORD ?? 'Yff-Demo-2026!';
const PROJECT_KEY = 'YFF';
const BASE = `${API}/api/v1`;

const log = (...args) => process.stdout.write(`${args.join(' ')}\n`);

/* ------------------------------------------------------------------ 会话 */

class Session {
  constructor(label) {
    this.label = label;
    this.cookies = new Map();
    this.csrf = '';
  }

  absorb(response) {
    for (const entry of response.headers.getSetCookie?.() ?? []) {
      const [pair, ...attrs] = entry.split(';');
      const index = pair.indexOf('=');
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1);
      if (value === '' || attrs.some((a) => /^\s*max-age=0\s*$/i.test(a))) this.cookies.delete(name);
      else this.cookies.set(name, value);
      if (name.endsWith('wm_csrf')) this.csrf = value;
    }
  }

  async call(method, path, body, options = {}) {
    const headers = { Accept: 'application/json', Origin: ORIGIN };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const cookie = [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookie) headers.Cookie = cookie;
    if (this.csrf && method !== 'GET') headers['X-CSRF-Token'] = this.csrf;
    if (options.idempotency) headers['Idempotency-Key'] = options.idempotency;

    const response = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    this.absorb(response);
    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const detail = payload?.error ?? payload;
      throw new Error(`${this.label} ${method} ${path} -> ${response.status} ${JSON.stringify(detail)}`);
    }
    return payload?.data ?? payload;
  }

  async registerAndLogin(email, name) {
    const anonymous = await this.call('GET', '/auth/session');
    this.csrf = anonymous.csrfToken;
    try {
      await this.call('POST', '/auth/register', { email, password: PASSWORD, name });
    } catch (error) {
      if (!/409|EMAIL_|already/i.test(error.message)) throw error;
      await this.call('POST', '/auth/login', { email, password: PASSWORD });
    }
    this.csrf = (await this.call('GET', '/auth/session')).csrfToken ?? this.csrf;
    return (await this.call('GET', '/auth/me')).user?.id ?? null;
  }

  /** 一次性确认票据：先预览算出 actionDigest，再用密码换票据。 */
  async ticket(binding) {
    const preview = await this.call('POST', '/auth/action-previews', binding);
    const ticket = await this.call('POST', '/auth/confirmation-tickets', {
      ...binding,
      actionDigest: preview.actionDigest,
      password: PASSWORD,
    });
    return { ticketId: ticket.ticketId, ticketSecret: ticket.ticketSecret };
  }
}

/* ---------------------------------------------------------------- 文档解析 */

const MODULES = [
  ['销售/客户询价单/客户询价单.md', '客户询价单'],
  ['销售/销售报价书/销售报价书.md', '销售报价书'],
  ['销售/销售合同/销售合同.md', '销售合同'],
  ['销售/发货申请/发货申请.md', '发货申请'],
  ['销售/内部合同/内部合同.md', '内部合同'],
  ['采购/采购询价书/采购询价书.md', '采购询价书'],
  ['采购/供应商报价单/供应商报价单.md', '供应商报价单'],
  ['采购/成本核算/成本核算.md', '成本核算'],
  ['采购/采购合同/采购合同.md', '采购合同'],
  ['储运/仓库管理/仓库管理.md', '仓库管理'],
  ['储运/库存管理/库存管理.md', '库存管理'],
  ['储运/盘点单/盘点单.md', '盘点单'],
  ['储运/入库单/入库单.md', '入库单'],
  ['储运/出库单/出库单.md', '出库单'],
  ['储运/物流单/物流单.md', '物流单'],
  ['储运/服务公司/服务公司.md', '服务公司'],
  ['产品/产品管理/产品管理.md', '产品管理'],
  ['产品/品牌管理/品牌管理.md', '品牌管理'],
  ['客户/我的客户/我的客户.md', '我的客户'],
  ['客户/全部客户/客户管理.md', '全部客户'],
  ['供应商/全部供应商/供应商管理.md', '供应商管理'],
  ['系统/组织权限/组织权限.md', '组织权限'],
  ['系统/系统管理/试用申请与租户开通.md', '试用申请与租户开通'],
  ['系统/系统管理/账号安全.md', '账号安全'],
  ['工作台/回收站/附件回收站.md', '附件回收站'],
];

/** 从 13 章正文里取“目标与范围”和“验收标准”两段；取不到就退化为整篇摘要。 */
function parseModuleDoc(relativePath) {
  const file = join(DOC_ROOT, '需求文档', relativePath);
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const section = (heading) => {
    const start = text.indexOf(`## ${heading}`);
    if (start < 0) return '';
    const next = text.indexOf('\n## ', start + 3);
    return text.slice(start, next < 0 ? undefined : next).replace(/^## .*\n/, '').trim();
  };
  const goal = section('2. 目标与范围');
  const acceptanceRaw = section('12. 验收标准');
  const acceptance = acceptanceRaw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^\d+\.\s+/.test(line))
    .map((line, index) => ({
      key: `ac-${String(index + 1).padStart(2, '0')}`,
      text: line.replace(/^\d+\.\s+/, '').slice(0, 300),
      verification: index % 3 === 1 ? 'DEMO' : index % 3 === 2 ? 'INSPECTION' : 'TEST',
    }));
  return { text, goal, acceptance };
}

/* ------------------------------------------------------------------ 主流程 */

const phase = (() => {
  const index = process.argv.indexOf('--phase');
  return index > -1 ? process.argv[index + 1] : 'all';
})();

const owner = new Session('owner');
const team = {
  pm: new Session('pm'),
  ui: new Session('ui'),
  dev: new Session('dev'),
  be: new Session('be'),
  qa: new Session('qa'),
  ops: new Session('ops'),
};
const accounts = [
  ['owner@yesgoo.local', '易番番项目负责人', owner],
  ['pm@yesgoo.local', '林产品', team.pm],
  ['ui@yesgoo.local', '周设计', team.ui],
  ['dev@yesgoo.local', '陈前端', team.dev],
  ['be@yesgoo.local', '王后端', team.be],
  ['qa@yesgoo.local', '赵测试', team.qa],
  ['ops@yesgoo.local', '吴运维', team.ops],
];

async function phaseAccounts() {
  log('\n== phase: accounts ==');
  for (const [email, name, session] of accounts) {
    const id = await session.registerAndLogin(email, name);
    log(`  account ${email} -> ${id}`);
  }

  const projects = await owner.call('GET', '/projects');
  let project = projects.find((item) => item.key === PROJECT_KEY);
  if (!project) {
    project = await owner.call('POST', '/projects', {
      name: '易番番 ERP',
      key: PROJECT_KEY,
      description: '面向工贸一体企业的销、采、储运、产品、客户与组织权限一体化 ERP。',
    });
    log(`  project created ${project.id}`);
  } else {
    log(`  project reused ${project.id}`);
  }

  const members = await owner.call('GET', `/projects/${project.id}/members`);
  const have = new Set(members.map((m) => m.user?.email ?? m.email));
  for (const [email] of accounts.slice(1)) {
    if (have.has(email)) continue;
    await owner.call('POST', `/projects/${project.id}/members`, { email });
    log(`  member added ${email}`);
  }
  // 把本机已有的管理员账号也拉进项目，用户可以直接用自己的账号看数据。
  if (!have.has('admin@qq.com')) {
    try {
      await owner.call('POST', `/projects/${project.id}/members`, { email: 'admin@qq.com' });
      log('  member added admin@qq.com');
    } catch (error) {
      log(`  admin@qq.com skipped: ${error.message.slice(0, 120)}`);
    }
  }

  const roles = await owner.call('GET', `/projects/${project.id}/roles`);
  log(`  roles: ${roles.map((r) => `${r.key}(${r.title})`).join(', ')}`);

  const repoSpecs = [
    { name: 'backend', title: 'nz_erp/backend' },
    { name: 'base', title: 'nz_erp/base' },
    { name: 'front', title: 'nz_erp/front' },
    { name: 'service', title: 'nz_erp/service' },
  ];
  const repos = await owner.call('GET', `/projects/${project.id}/repositories`);
  for (const spec of repoSpecs) {
    if (repos.some((r) => r.name === spec.name && !r.archivedAt)) continue;
    await owner.call('POST', `/projects/${project.id}/repositories`, {
      adapter: 'github',
      externalId: `codeup-${spec.name}`,
      owner: 'nz_erp',
      name: spec.name,
    });
    log(`  repository registered ${spec.title}`);
  }

  return project;
}

async function main() {
  log(`\nWorkMesh × 易番番 seeding (phase=${phase})`);
  log(`docs: ${DOC_ROOT}`);

  if (phase === 'accounts' || phase === 'all') await phaseAccounts();

  log('\ndone.');
}

main().catch((error) => {
  process.stderr.write(`\nFAILED: ${error.message}\n`);
  process.exit(1);
});
