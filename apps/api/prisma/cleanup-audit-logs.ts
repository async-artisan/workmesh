import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const retentionDays = Number(process.env.AUDIT_LOG_RETENTION_DAYS ?? 180);
const apply = process.argv.includes('--apply');
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) throw new Error('DATABASE_URL must be explicitly set for local cleanup');
const databaseHost = new URL(databaseUrl).hostname;
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(databaseHost)) {
  throw new Error('Audit cleanup is restricted to a local database');
}

if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
  throw new Error('AUDIT_LOG_RETENTION_DAYS must be an integer between 1 and 3650');
}

const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
try {
  const where = { createdAt: { lt: cutoff } };
  const count = await prisma.auditLog.count({ where });
  const deleted = apply && count > 0 ? (await prisma.auditLog.deleteMany({ where })).count : 0;
  console.log(JSON.stringify({ apply, retentionDays, eligible: count, deleted }));
} finally {
  await prisma.$disconnect();
}
