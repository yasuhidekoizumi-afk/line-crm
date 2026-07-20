import { Hono } from 'hono';
import type { Env } from '../index.js';
import { processScheduledBroadcasts } from '../services/broadcast.js';
import { finishCronExecution, startCronExecution } from '../services/cron-monitor.js';

const cronWatchdog = new Hono<Env>();

// Cloudflare Cronが停止しても、GitHub Actionsから5分ごとに同じ安全な処理を起動する。
cronWatchdog.post('/api/internal/scheduled-broadcasts/run', async (c) => {
  if (!c.env.CRON_WATCHDOG_TOKEN || c.req.header('X-Cron-Watchdog-Token') !== c.env.CRON_WATCHDOG_TOKEN) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  let executionId: string | null = null;
  try {
    executionId = await startCronExecution(c.env.DB, 'scheduled-broadcasts', 'github-watchdog');
    await processScheduledBroadcasts(c.env.DB, c.env.LINE_CHANNEL_ACCESS_TOKEN, c.env.WORKER_URL);
    await finishCronExecution(c.env.DB, executionId);
    return c.json({ success: true, data: { executionId } });
  } catch (error) {
    if (executionId) await finishCronExecution(c.env.DB, executionId, error).catch(() => undefined);
    console.error('[cron-watchdog] scheduled broadcasts failed:', error);
    return c.json({ success: false, error: 'Scheduled broadcast processing failed' }, 500);
  }
});

export { cronWatchdog };
