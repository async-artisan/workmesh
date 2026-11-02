#!/usr/bin/env node
// CLI：解析并核验隔离测试数据库目标。
// 通过：stdout 输出脱敏目标 JSON，退出 0。拒绝：stderr 输出原因，退出 2（不创建任何连接）。
import { refuseAndExit, resolveTestDatabase } from './test-database-guard.mjs';

const resolved = await resolveTestDatabase();
if (!resolved.ok) refuseAndExit(resolved.rejection);
process.stdout.write(`${JSON.stringify({ ok: true, target: resolved.describe }, null, 2)}\n`);
