import { Hono } from 'hono';
import { getTags, createTag, deleteTag, updateTag, getTagsWithCount } from '@line-crm/db';
import type { Tag as DbTag, TagWithCount as DbTagWithCount } from '@line-crm/db';
import type { Env } from '../index.js';

const tags = new Hono<Env>();

function serializeTag(row: DbTag) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    createdAt: row.created_at,
  };
}

function serializeTagWithCount(row: DbTagWithCount) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    createdAt: row.created_at,
    friendCount: row.friend_count,
  };
}

// GET /api/tags - list all tags
tags.get('/api/tags', async (c) => {
  try {
    const items = await getTags(c.env.DB);
    return c.json({ success: true, data: items.map(serializeTag) });
  } catch (err) {
    console.error('GET /api/tags error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/tags - create tag
tags.post('/api/tags', async (c) => {
  try {
    const body = await c.req.json<{ name: string; color?: string }>();
    const name = body.name?.trim();

    if (!name) {
      return c.json({ success: false, error: 'name is required' }, 400);
    }

    const tag = await createTag(c.env.DB, {
      name,
      color: body.color,
    });

    return c.json({ success: true, data: serializeTag(tag) }, 201);
  } catch (err) {
    console.error('POST /api/tags error:', err);
    if (err instanceof Error && /UNIQUE|constraint/i.test(err.message)) {
      return c.json({ success: false, error: '同じ名前のタグが既にあります' }, 409);
    }
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PATCH /api/tags/:id - update tag name/color
tags.patch('/api/tags/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json<{ name?: string; color?: string }>();
    if (body.name !== undefined && !body.name.trim()) {
      return c.json({ success: false, error: 'name must not be empty' }, 400);
    }
    const updated = await updateTag(c.env.DB, id, {
      name: body.name,
      color: body.color,
    });
    if (!updated) {
      return c.json({ success: false, error: 'tag not found' }, 404);
    }
    return c.json({ success: true, data: serializeTag(updated) });
  } catch (err) {
    console.error('PATCH /api/tags/:id error:', err);
    if (err instanceof Error && /UNIQUE|constraint/i.test(err.message)) {
      return c.json({ success: false, error: '同じ名前のタグが既にあります' }, 409);
    }
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/tags/:id - delete tag
tags.delete('/api/tags/:id', async (c) => {
  try {
    const id = c.req.param('id');
    await deleteTag(c.env.DB, id);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/tags/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/tags/with-count - 各タグの友だち付与人数つき（タグ管理画面用）
tags.get('/api/tags/with-count', async (c) => {
  try {
    const items = await getTagsWithCount(c.env.DB);
    return c.json({ success: true, data: items.map(serializeTagWithCount) });
  } catch (err) {
    console.error('GET /api/tags/with-count error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { tags };
