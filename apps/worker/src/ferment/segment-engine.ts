/**
 * FERMENT: セグメント計算エンジン
 *
 * JSON の rules 条件式を評価して対象顧客 ID を抽出する。
 * SQL に変換することで D1 上で大規模データを効率的に処理。
 *
 * 呼び出し元:
 *   - apps/worker/src/ferment/cron-segments.ts
 *   - apps/worker/src/ferment/routes/segments.ts
 *
 * 依存:
 *   - @line-crm/db (customers, segments, segment_members)
 */

import { replaceSegmentMembers, getSegmentById } from '@line-crm/db';

// ============================================================
// セグメントルール DSL 型定義
// ============================================================

export type SegmentOperator =
  | '='
  | '!='
  | '>'
  | '>='
  | '<'
  | '<='
  | 'in'
  | 'not_in'
  | 'contains'
  | 'starts_with'
  | 'within_days'
  | 'older_than_days'
  | 'is_null'
  | 'is_not_null';

export interface SegmentLeafCondition {
  field: string;
  operator: SegmentOperator;
  value?: string | number | string[];
}

export interface SegmentGroupCondition {
  operator: 'AND' | 'OR';
  conditions: Array<SegmentLeafCondition | SegmentGroupCondition>;
}

export type SegmentRules = SegmentGroupCondition;

/** 許可されたフィールド（SQL インジェクション対策） */
const ALLOWED_FIELDS = new Set([
  'email',
  'line_user_id',
  'display_name',
  'region',
  'language',
  'ltv',
  'ltv_currency',
  'order_count',
  'first_order_at',
  'last_order_at',
  'avg_order_value',
  'subscribed_email',
  'subscribed_line',
  'email_bounced',
  'source',
  'tags',
  'preferred_products',
  // 派生フィールド
  'days_since_last_order',
  'days_since_created',
  // LINE CRM 連携
  'friend_tag',
  // ロイヤルティ連携
  'loyalty_rank',
  'loyalty_balance',
]);

// ============================================================
// SQL 生成
// ============================================================

interface QueryPart {
  sql: string;
  bindings: unknown[];
}

/**
 * 単一の条件式を SQL に変換する
 */
function leafToSql(cond: SegmentLeafCondition): QueryPart {
  const { field, operator: op, value } = cond;

  // フィールド名の検証（SQL インジェクション対策）
  if (!ALLOWED_FIELDS.has(field)) {
    throw new Error(`許可されていないフィールドです: ${field}`);
  }

  // 派生フィールドの変換
  if (field === 'friend_tag') {
    // LINE CRM の friend_tags をサブクエリで参照
    const tagName = String(value ?? '');
    switch (op) {
      case '=':
        return {
          sql: `EXISTS (
            SELECT 1 FROM friend_tags ft
            JOIN tags t ON t.id = ft.tag_id
            JOIN friends f ON f.id = ft.friend_id
            WHERE f.line_user_id = c.line_user_id AND t.name = ?
          )`,
          bindings: [tagName],
        };
      case '!=':
        return {
          sql: `NOT EXISTS (
            SELECT 1 FROM friend_tags ft
            JOIN tags t ON t.id = ft.tag_id
            JOIN friends f ON f.id = ft.friend_id
            WHERE f.line_user_id = c.line_user_id AND t.name = ?
          )`,
          bindings: [tagName],
        };
      default:
        throw new Error(`friend_tag で未対応の演算子: ${op}（= または != のみ対応）`);
    }
  }

  // ロイヤルティ連携: loyalty_points テーブルをサブクエリ参照
  if (field === 'loyalty_rank') {
    const rankName = String(value ?? '');
    switch (op) {
      case '=':
        return {
          sql: `EXISTS (
            SELECT 1 FROM loyalty_points lp
            JOIN friends f ON f.id = lp.friend_id
            WHERE f.line_user_id = c.line_user_id AND lp.rank = ?
          )`,
          bindings: [rankName],
        };
      case '!=':
        return {
          sql: `NOT EXISTS (
            SELECT 1 FROM loyalty_points lp
            JOIN friends f ON f.id = lp.friend_id
            WHERE f.line_user_id = c.line_user_id AND lp.rank = ?
          )`,
          bindings: [rankName],
        };
      default:
        throw new Error(`loyalty_rank で未対応の演算子: ${op}（= または != のみ対応）`);
    }
  }

  if (field === 'loyalty_balance') {
    const subquery = `(SELECT lp.balance FROM loyalty_points lp JOIN friends f ON f.id = lp.friend_id WHERE f.line_user_id = c.line_user_id)`;
    const numValue = Number(value);
    switch (op) {
      case '=':  return { sql: `${subquery} = ?`, bindings: [numValue] };
      case '!=': return { sql: `${subquery} != ?`, bindings: [numValue] };
      case '>':  return { sql: `${subquery} > ?`, bindings: [numValue] };
      case '>=': return { sql: `${subquery} >= ?`, bindings: [numValue] };
      case '<':  return { sql: `${subquery} < ?`, bindings: [numValue] };
      case '<=': return { sql: `${subquery} <= ?`, bindings: [numValue] };
      case 'is_null':     return { sql: `${subquery} IS NULL`, bindings: [] };
      case 'is_not_null': return { sql: `${subquery} IS NOT NULL`, bindings: [] };
      default:
        throw new Error(`loyalty_balance で未対応の演算子: ${op}`);
    }
  }

  const sqlField =
    field === 'days_since_last_order'
      ? `CAST((julianday('now') - julianday(c.last_order_at)) AS INTEGER)`
      : field === 'days_since_created'
        ? `CAST((julianday('now') - julianday(c.created_at)) AS INTEGER)`
        : `c.${field}`;

  switch (op) {
    case '=':
      return { sql: `${sqlField} = ?`, bindings: [value] };
    case '!=':
      return { sql: `${sqlField} != ?`, bindings: [value] };
    case '>':
      return { sql: `${sqlField} > ?`, bindings: [value] };
    case '>=':
      return { sql: `${sqlField} >= ?`, bindings: [value] };
    case '<':
      return { sql: `${sqlField} < ?`, bindings: [value] };
    case '<=':
      return { sql: `${sqlField} <= ?`, bindings: [value] };
    case 'in': {
      const arr = Array.isArray(value) ? value : [value];
      // tags / preferred_products はカンマ区切り文字列で保存されるため、
      // 完全一致(IN)ではなく各値の部分一致(LIKE)の OR で「いずれかを含む」を表現する。
      // 例: 値「いちご」→ タグ列「dokopoi,いちご購入者,…」にヒットする。
      if (field === 'tags' || field === 'preferred_products') {
        const sql = arr.map(() => `${sqlField} LIKE ?`).join(' OR ');
        return { sql: `(${sql})`, bindings: arr.map((v) => `%${v}%`) };
      }
      const placeholders = arr.map(() => '?').join(', ');
      return { sql: `${sqlField} IN (${placeholders})`, bindings: arr };
    }
    case 'not_in': {
      const arr = Array.isArray(value) ? value : [value];
      // tags / preferred_products は「指定値のいずれも含まない」を AND の NOT LIKE で表現する
      if (field === 'tags' || field === 'preferred_products') {
        const sql = arr.map(() => `${sqlField} NOT LIKE ?`).join(' AND ');
        return { sql: `(${sql})`, bindings: arr.map((v) => `%${v}%`) };
      }
      const placeholders = arr.map(() => '?').join(', ');
      return { sql: `${sqlField} NOT IN (${placeholders})`, bindings: arr };
    }
    case 'contains':
      // tags / preferred_products もカンマ区切り保存のため、クォート無しの素の部分一致で照合する。
      // （旧実装は `%"値"%` と JSON 配列前提だったため、カンマ区切りデータに一致しなかった）
      return { sql: `${sqlField} LIKE ?`, bindings: [`%${value}%`] };
    case 'starts_with':
      return { sql: `${sqlField} LIKE ?`, bindings: [`${value}%`] };
    case 'within_days':
      return {
        sql: `${sqlField} >= datetime('now', ? || ' days')`,
        bindings: [`-${value}`],
      };
    case 'older_than_days':
      return {
        sql: `${sqlField} < datetime('now', ? || ' days')`,
        bindings: [`-${value}`],
      };
    case 'is_null':
      return { sql: `${sqlField} IS NULL`, bindings: [] };
    case 'is_not_null':
      return { sql: `${sqlField} IS NOT NULL`, bindings: [] };
    default:
      throw new Error(`未対応の演算子: ${op}`);
  }
}

/**
 * ネストした条件式を再帰的に SQL に変換する
 */
function rulesGroupToSql(group: SegmentGroupCondition): QueryPart {
  const parts: QueryPart[] = [];

  for (const cond of group.conditions) {
    if ('field' in cond) {
      // リーフノード
      parts.push(leafToSql(cond));
    } else {
      // グループノード（再帰）
      const nested = rulesGroupToSql(cond);
      parts.push({ sql: `(${nested.sql})`, bindings: nested.bindings });
    }
  }

  if (parts.length === 0) {
    return { sql: '1=1', bindings: [] };
  }

  const combinedSql = parts.map((p) => p.sql).join(` ${group.operator} `);
  const combinedBindings = parts.flatMap((p) => p.bindings);

  return { sql: combinedSql, bindings: combinedBindings };
}

// ============================================================
// セグメント計算
// ============================================================

/**
 * セグメント条件に合致する顧客 ID を D1 から取得する
 *
 * @param rules セグメントルール DSL
 /**
  * セグメント条件に合致する顧客IDを取得する（最大10000件に制限）
  */
 export async function querySegmentCustomerIds(
   rules: SegmentRules,
   db: D1Database,
 ): Promise<string[]> {
   const { sql: whereSql, bindings } = rulesGroupToSql(rules);

   const query = `
     SELECT c.customer_id
     FROM customers c
     WHERE ${whereSql}
     ORDER BY c.created_at DESC
     LIMIT 10000
   `;

  const result = await db
    .prepare(query)
    .bind(...bindings)
    .all<{ customer_id: string }>();

  return result.results.map((r) => r.customer_id);
}

/**
 * セグメントを再計算して segment_members を更新する
 *
 * @param segmentId セグメント ID
 * @param db D1 データベース
 * @returns 該当した顧客数
 */
export async function computeSegment(segmentId: string, db: D1Database): Promise<number> {
  const segment = await getSegmentById(db, segmentId);
  if (!segment) throw new Error(`Segment not found: ${segmentId}`);

  let rules: SegmentRules;
  try {
    rules = JSON.parse(segment.rules) as SegmentRules;
  } catch {
    throw new Error(`Invalid segment rules JSON: ${segment.rules}`);
  }

  // ルールが空の場合は全顧客を対象（最大10000件に制限: Workersメモリ対策）
  if (!rules.conditions || rules.conditions.length === 0) {
    const result = await db
      .prepare('SELECT customer_id FROM customers ORDER BY created_at DESC LIMIT 10000')
      .all<{ customer_id: string }>();
    const ids = result.results.map((r) => r.customer_id);
    await replaceSegmentMembers(db, segmentId, ids);
    return ids.length;
  }

  const customerIds = await querySegmentCustomerIds(rules, db);
  await replaceSegmentMembers(db, segmentId, customerIds);
  return customerIds.length;
}

/**
 * 顧客が特定セグメントに含まれるかをリアルタイム評価する
 *
 * @param customerId 顧客 ID
 * @param segmentId セグメント ID
 * @param db D1 データベース
 */
export async function isCustomerInSegment(
  customerId: string,
  segmentId: string,
  db: D1Database,
): Promise<boolean> {
  const row = await db
    .prepare(
      'SELECT 1 FROM segment_members WHERE segment_id = ? AND customer_id = ?',
    )
    .bind(segmentId, customerId)
    .first<{ 1: number }>();
  return row !== null;
}
