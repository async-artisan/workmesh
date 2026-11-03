import type { BoxContext } from '../context';
import { collectStatus, type StatusReport } from './status';

export type DoctorResult = {
  report: StatusReport;
  ok: boolean;
  failed: string[];
};

/** 只体检不启动：关键检查（数据库 / PG 客户端 / 数据目录）失败即退出码 1。 */
export async function runDoctor(ctx: BoxContext): Promise<DoctorResult> {
  const report = await collectStatus(ctx);
  const failed = report.checks.filter((check) => check.critical && !check.ok).map((c) => c.name);
  return { report, ok: failed.length === 0, failed };
}
