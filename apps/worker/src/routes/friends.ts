// GET /api/friends/:id/messages - get message history (パフォーマンス改善: LIMIT 200→50)
friends.get('/api/friends/:id/messages', async (c) => {
  try {
    const friendId = c.req.param('id');
    const limit = Math.min(Number(c.req.query('limit') ?? '50'), 200);
    const result = await c.env.DB
      .prepare(`SELECT id, direction, message_type as messageType, content, created_at as createdAt FROM messages_log WHERE friend_id = ? ORDER BY created_at ASC LIMIT ?`)
      .bind(friendId, limit)
      .all<{ id: string; direction: string; messageType: string; content: string; createdAt: string }>();
    return c.json({ success: true, data: result.results });
  } catch (err) {
    console.error('GET /api/friends/:id/messages error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});
