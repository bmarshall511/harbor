import { AuditLogRepository } from '@harbor/database';
import type { AuthContext } from '@/lib/auth';

const auditRepo = new AuditLogRepository();

export async function audit(
  ctx: AuthContext | null,
  action: string,
  entityType: 'FILE' | 'FOLDER',
  entityId: string,
  before?: unknown,
  after?: unknown,
) {
  try {
    await auditRepo.log({
      userId: ctx?.userId,
      action,
      entityType,
      entityId,
      before,
      after,
    });
  } catch (err) {
    console.error('Audit log failed:', err);
  }
}
