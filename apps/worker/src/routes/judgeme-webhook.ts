import { Hono } from 'hono';
import type { Env } from '../index.js';

export const judgeme = new Hono<Env>();

judgeme.all('/api/webhooks/judgeme', (c) =>
  c.json(
    {
      success: false,
      error: 'Judge.me webhook is not implemented yet',
    },
    501,
  ),
);
