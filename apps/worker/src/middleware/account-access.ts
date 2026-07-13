import type { Context } from 'hono';
import { getAccountRole, getAccessibleLineAccountIds } from '@line-crm/db';
import type { Env } from '../index.js';

/** URL/本文で指定されたアカウントIDを、ログイン担当者が実際に触れるか検査する。 */
export async function requireLineAccountAccess(c: Context<Env>, lineAccountId: string | null | undefined, write = false): Promise<Response | null> {
  if (!lineAccountId) return c.json({ success: false, error: 'lineAccountId is required' }, 400);
  const staff = c.get('staff');
  const role = await getAccountRole(c.env.DB, staff.id, staff.role, lineAccountId);
  if (!role) return c.json({ success: false, error: 'このLINEアカウントへのアクセス権限がありません' }, 403);
  if (write && role === 'operator') return c.json({ success: false, error: 'この操作にはアカウント管理者権限が必要です' }, 403);
  return null;
}

/** アカウント指定なしの一覧でも、担当者の見える範囲だけに必ず絞る。 */
export async function accessibleLineAccountIds(c: Context<Env>): Promise<string[]> {
  const staff = c.get('staff');
  return getAccessibleLineAccountIds(c.env.DB, staff.id, staff.role);
}
