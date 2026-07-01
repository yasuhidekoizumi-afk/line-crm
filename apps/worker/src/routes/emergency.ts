import { Hono } from 'hono';
import type { Env } from '../index.js';
import {
  areLineBroadcastsPaused,
  getLineDeliverySafetyStatus,
  setLineBroadcastsPaused,
} from '../services/delivery-safety.js';

const emergency = new Hono<Env>();

emergency.get('/api/emergency/status', async (c) => {
  try {
    const paused = await areLineBroadcastsPaused(c.env.DB);
    const safety = await getLineDeliverySafetyStatus(c.env.DB, null);
    const scheduled = await c.env.DB
      .prepare(`SELECT COUNT(*) AS count FROM broadcasts WHERE status = 'scheduled'`)
      .first<{ count: number }>();
    return c.json({
      success: true,
      data: {
        paused,
        riskLevel: safety.riskLevel,
        recentUnfollows: safety.recentUnfollows,
        scheduledBroadcasts: scheduled?.count ?? 0,
      },
    });
  } catch (err) {
    console.error('GET /api/emergency/status error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

emergency.post('/api/emergency/stop-broadcasts', async (c) => {
  try {
    await setLineBroadcastsPaused(c.env.DB, true);
    const result = await c.env.DB
      .prepare(
        `UPDATE broadcasts
         SET status = 'draft', scheduled_at = NULL
         WHERE status = 'scheduled'`,
      )
      .run();
    return c.json({
      success: true,
      data: {
        paused: true,
        unscheduledBroadcasts: result.meta?.changes ?? 0,
      },
    });
  } catch (err) {
    console.error('POST /api/emergency/stop-broadcasts error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

emergency.post('/api/emergency/resume-broadcasts', async (c) => {
  try {
    await setLineBroadcastsPaused(c.env.DB, false);
    return c.json({ success: true, data: { paused: false } });
  } catch (err) {
    console.error('POST /api/emergency/resume-broadcasts error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { emergency };
