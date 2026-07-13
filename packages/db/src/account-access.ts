export type AccountRole = 'account_admin' | 'operator';

export async function getAccessibleLineAccountIds(db: D1Database, staffId: string, globalRole: string): Promise<string[]> {
  if (globalRole === 'owner' || globalRole === 'admin' || staffId === 'env-owner') {
    const result = await db.prepare('SELECT id FROM line_accounts').all<{ id: string }>();
    return result.results.map((row) => row.id);
  }
  const result = await db
    .prepare('SELECT line_account_id AS id FROM staff_line_account_permissions WHERE staff_member_id = ?')
    .bind(staffId)
    .all<{ id: string }>();
  return result.results.map((row) => row.id);
}

export async function getAccountRole(db: D1Database, staffId: string, globalRole: string, lineAccountId: string): Promise<AccountRole | 'global' | null> {
  if (globalRole === 'owner' || globalRole === 'admin' || staffId === 'env-owner') return 'global';
  const row = await db
    .prepare('SELECT account_role FROM staff_line_account_permissions WHERE staff_member_id = ? AND line_account_id = ?')
    .bind(staffId, lineAccountId)
    .first<{ account_role: AccountRole }>();
  return row?.account_role ?? null;
}

export async function setStaffLineAccountPermission(db: D1Database, staffId: string, lineAccountId: string, role: AccountRole): Promise<void> {
  await db
    .prepare(`INSERT INTO staff_line_account_permissions (staff_member_id, line_account_id, account_role)
              VALUES (?, ?, ?)
              ON CONFLICT(staff_member_id, line_account_id) DO UPDATE SET account_role = excluded.account_role`)
    .bind(staffId, lineAccountId, role)
    .run();
}

export async function removeStaffLineAccountPermission(db: D1Database, staffId: string, lineAccountId: string): Promise<void> {
  await db.prepare('DELETE FROM staff_line_account_permissions WHERE staff_member_id = ? AND line_account_id = ?')
    .bind(staffId, lineAccountId).run();
}
