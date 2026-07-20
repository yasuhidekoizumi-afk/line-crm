import { jstNow } from '@line-crm/db';

export type CronTriggerSource = 'cloudflare-cron' | 'github-watchdog';

export async function startCronExecution(
  db: D1Database,
  jobName: string,
  triggerSource: CronTriggerSource,
  cronExpression?: string,
): Promise<string> {
  const id = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO cron_execution_logs
      (id, job_name, trigger_source, cron_expression, status, started_at)
     VALUES (?, ?, ?, ?, 'running', ?)`,
  ).bind(id, jobName, triggerSource, cronExpression ?? null, jstNow()).run();
  return id;
}

export async function finishCronExecution(db: D1Database, id: string, error?: unknown): Promise<void> {
  const failed = error !== undefined;
  const message = failed
    ? (error instanceof Error ? error.message : String(error)).slice(0, 500)
    : null;
  await db.prepare(
    `UPDATE cron_execution_logs
     SET status = ?, error_message = ?, completed_at = ?
     WHERE id = ?`,
  ).bind(failed ? 'failed' : 'succeeded', message, jstNow(), id).run();
}
