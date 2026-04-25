/**
 * FERMENT 軽量テンプレートエンジン
 *
 * Handlebars/Mustache 互換のサブセットを Cloudflare Workers 上で動かすための自前実装。
 * 外部依存ゼロ、Node.js API ゼロ。
 *
 * サポート構文:
 *   - {{var}}                                 単純置換
 *   - {{var.nested}}                          ネストアクセス
 *   - {{#if cond}}...{{/if}}                  条件分岐
 *   - {{#if cond}}...{{#else}}...{{/if}}      else 節
 *   - {{#unless cond}}...{{/unless}}          否定
 *   - {{#each items}}...{{this}}...{{/each}}  繰り返し
 *
 * cond 構文:
 *   - bool 変数        : has_purchased
 *   - 文字列比較        : region == "JP"
 *   - 数値比較          : ltv >= 5000, order_count > 0
 *   - サポート演算子    : == != >= <= > <
 */

type Context = Record<string, unknown>;

const RE_EACH = /\{\{#each\s+([\w_.]+)\s*\}\}([\s\S]*?)\{\{\/each\}\}/g;
const RE_IF_ELSE = /\{\{#if\s+([^}]+?)\s*\}\}([\s\S]*?)\{\{#else\}\}([\s\S]*?)\{\{\/if\}\}/g;
const RE_IF = /\{\{#if\s+([^}]+?)\s*\}\}([\s\S]*?)\{\{\/if\}\}/g;
const RE_UNLESS = /\{\{#unless\s+([^}]+?)\s*\}\}([\s\S]*?)\{\{\/unless\}\}/g;
const RE_VAR = /\{\{\s*([\w_.][\w_.]*)\s*\}\}/g;

function getValue(path: string, ctx: Context): unknown {
  return path.split('.').reduce<unknown>((obj, key) => {
    if (obj == null) return undefined;
    return (obj as Record<string, unknown>)[key];
  }, ctx);
}

function evalCondition(cond: string, ctx: Context): boolean {
  const trimmed = cond.trim();

  // 比較演算子（順序重要：>= は > より先にチェック）
  const ops: Array<{ op: string; fn: (a: unknown, b: unknown) => boolean }> = [
    { op: '==', fn: (a, b) => String(a) === String(b) },
    { op: '!=', fn: (a, b) => String(a) !== String(b) },
    { op: '>=', fn: (a, b) => Number(a) >= Number(b) },
    { op: '<=', fn: (a, b) => Number(a) <= Number(b) },
    { op: '>', fn: (a, b) => Number(a) > Number(b) },
    { op: '<', fn: (a, b) => Number(a) < Number(b) },
  ];

  for (const { op, fn } of ops) {
    const idx = trimmed.indexOf(` ${op} `);
    if (idx > 0) {
      const lhs = trimmed.slice(0, idx).trim();
      const rhs = trimmed.slice(idx + op.length + 2).trim();
      const lhsVal = getValue(lhs, ctx);
      // rhs が "..." or '...' なら文字列リテラル、それ以外は数値 or 変数参照
      let rhsVal: unknown;
      if (/^["'].*["']$/.test(rhs)) {
        rhsVal = rhs.slice(1, -1);
      } else if (/^-?\d+(\.\d+)?$/.test(rhs)) {
        rhsVal = Number(rhs);
      } else {
        rhsVal = getValue(rhs, ctx);
      }
      return fn(lhsVal, rhsVal);
    }
  }

  // 比較なし → 単純な truthy 判定
  const val = getValue(trimmed, ctx);
  return Boolean(val) && !(Array.isArray(val) && val.length === 0);
}

function renderEach(template: string, ctx: Context): string {
  return template.replace(RE_EACH, (_match, key, body) => {
    const arr = getValue(key, ctx);
    if (!Array.isArray(arr)) return '';
    return arr
      .map((item) => {
        // ループ内では this でアイテムにアクセス可能
        const innerCtx = { ...ctx, this: item };
        // ネストした構文を再帰的に処理
        return render(body, innerCtx);
      })
      .join('');
  });
}

function renderIfElse(template: string, ctx: Context): string {
  return template.replace(RE_IF_ELSE, (_match, cond, ifBody, elseBody) => {
    return evalCondition(cond, ctx) ? render(ifBody, ctx) : render(elseBody, ctx);
  });
}

function renderIf(template: string, ctx: Context): string {
  return template.replace(RE_IF, (_match, cond, body) => {
    return evalCondition(cond, ctx) ? render(body, ctx) : '';
  });
}

function renderUnless(template: string, ctx: Context): string {
  return template.replace(RE_UNLESS, (_match, cond, body) => {
    return !evalCondition(cond, ctx) ? render(body, ctx) : '';
  });
}

function renderVars(template: string, ctx: Context): string {
  return template.replace(RE_VAR, (_match, key) => {
    const val = getValue(key, ctx);
    return val == null ? '' : String(val);
  });
}

/** メインエントリ：制御構文 → 変数置換の順で適用 */
function render(template: string, ctx: Context): string {
  let out = template;
  // each（最も内側のものから処理されるように、繰り返し適用）
  let prev: string;
  do {
    prev = out;
    out = renderEach(out, ctx);
  } while (out !== prev);

  // if/else 先（else を含むパターンを優先）
  out = renderIfElse(out, ctx);
  do {
    prev = out;
    out = renderIf(out, ctx);
  } while (out !== prev);

  do {
    prev = out;
    out = renderUnless(out, ctx);
  } while (out !== prev);

  // 単純変数
  out = renderVars(out, ctx);

  return out;
}

/**
 * テンプレートをコンテキストでレンダリングする
 * 失敗時は元のテンプレートを返す（フォールバック）
 */
export function renderTemplate(template: string, context: Context): string {
  try {
    return render(template, context);
  } catch (err) {
    console.error('renderTemplate error:', err);
    return template;
  }
}
