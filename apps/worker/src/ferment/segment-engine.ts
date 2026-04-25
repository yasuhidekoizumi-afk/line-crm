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
      const placeholders = arr.map(() => '?').join(', ');
      return { sql: `${sqlField} IN (${placeholders})`, bindings: arr };
    }
    case 'not_in': {
      const arr = Array.isArray(value) ? value : [value];
      const placeholders = arr.map(() => '?').join(', ');
      return { sql: `${sqlField} NOT IN (${placeholders})`, bindings: arr };
    }
    case 'contains':
      // JSON 配列フィールド（tags, preferred_products）は LIKE で対応
      if (field === 'tags' || field === 'preferred_products') {
        return { sql: `${sqlField} LIKE ?`, bindings: [`%"${value}"%`] };
      }
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
 * @param db D1 データベース
 * @returns 該当する customer_id の配列
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

  // ルールが空の場合は全顧客を対象
  if (!rules.conditions || rules.conditions.length === 0) {
    const result = await db
      .prepare('SELECT customer_id FROM customers ORDER BY created_at DESC')
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
