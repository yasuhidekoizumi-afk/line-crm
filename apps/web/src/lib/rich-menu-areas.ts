/**
 * リッチメニュー編集画面の「エリアを壊さない」ための純関数群。
 *
 * 背景（2026-11-23 の事故）:
 *   画像だけ差し替えたのに、アップロード処理が縦横比からレイアウトを選び直し、
 *   全エリアをひな形（https://example.com）で作り直していた。結果、公開中の
 *   メニューの全ボタンが example.com を開く状態になった。
 *
 * そのため「画像を差し替えてもエリア／アクションは残す」判定と、
 * 「未設定（空 or example.com）のまま保存しようとしたら気づける」判定を
 * ここに集約する。React / Next に依存させないので node --test で検証できる。
 */

export interface RichMenuBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface RichMenuImageSize {
  width: number
  height: number
}

/** エリアのアクション（型は緩く受ける：呼び出し側の union 型をそのまま渡せる） */
export interface RichMenuActionLike {
  type: string
  uri?: string
  text?: string
  data?: string
  richMenuAliasId?: string
}

export interface RichMenuAreaLike<T extends RichMenuActionLike = RichMenuActionLike> {
  bounds: RichMenuBounds
  action: T
}

/** エリア作成時に埋められる仮のURL（これが残ったまま公開されると事故になる） */
export const PLACEHOLDER_HOSTS = ['example.com', 'example.org', 'example.net']

function safeHostname(uri: string): string | null {
  const trimmed = uri.trim()
  if (!trimmed) return null
  try {
    return new URL(trimmed).hostname.toLowerCase()
  } catch {
    return null
  }
}

/** example.com などの「仮置きURL」かどうか。 */
export function isPlaceholderUri(uri: string | undefined): boolean {
  if (!uri) return false
  const host = safeHostname(uri)
  if (!host) return false
  return PLACEHOLDER_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
}

/** リンク先が未入力、または仮置きURLのままかどうか。 */
export function isUnsetUri(uri: string | undefined): boolean {
  return !uri || !uri.trim() || isPlaceholderUri(uri)
}

/** アクションが「ちゃんと設定されている」かどうか。 */
export function isConfiguredAction(action: RichMenuActionLike): boolean {
  switch (action.type) {
    case 'uri':
      return !isUnsetUri(action.uri)
    case 'message':
      return !!action.text && action.text.trim().length > 0
    case 'postback':
    case 'datetimepicker':
      return !!action.data && action.data.trim().length > 0
    case 'richmenuswitch':
      return !!action.richMenuAliasId && action.richMenuAliasId.trim().length > 0
    default:
      return true
  }
}

/** 保存前に確認したいエリア（リンク先が example.com などの仮置きのまま）の index。 */
export function findPlaceholderUriIndexes(areas: RichMenuAreaLike[]): number[] {
  const out: number[] = []
  areas.forEach((area, i) => {
    if (area.action.type === 'uri' && isPlaceholderUri(area.action.uri)) out.push(i)
  })
  return out
}

/** 画面上で「未設定」として注意表示するエリアの index（空欄も含む）。 */
export function findUnsetAreaIndexes(areas: RichMenuAreaLike[]): number[] {
  const out: number[] = []
  areas.forEach((area, i) => {
    if (!isConfiguredAction(area.action)) out.push(i)
  })
  return out
}

/** 画像サイズが同じかどうか。 */
export function isSameSize(a: RichMenuImageSize, b: RichMenuImageSize): boolean {
  return a.width === b.width && a.height === b.height
}

/** 縦横比がほぼ同じかどうか（既定 1% 許容）。 */
export function isSameAspectRatio(
  a: RichMenuImageSize,
  b: RichMenuImageSize,
  tolerance = 0.01,
): boolean {
  if (!a.width || !a.height || !b.width || !b.height) return false
  const ra = a.width / a.height
  const rb = b.width / b.height
  return Math.abs(ra - rb) / ra <= tolerance
}

/** 1つの矩形が画像内に収まっているか。 */
export function boundsFitInSize(bounds: RichMenuBounds, size: RichMenuImageSize): boolean {
  if (bounds.x < 0 || bounds.y < 0) return false
  if (bounds.width <= 0 || bounds.height <= 0) return false
  return bounds.x + bounds.width <= size.width && bounds.y + bounds.height <= size.height
}

/** すべてのエリアが画像内に収まっているか（＝そのまま使い回せるか）。 */
export function allBoundsFit(areas: RichMenuAreaLike[], size: RichMenuImageSize): boolean {
  return areas.length > 0 && areas.every((a) => boundsFitInSize(a.bounds, size))
}

/** 座標だけを新しい画像サイズへ比例変換する（アクションはそのまま）。 */
export function scaleAreaBounds<T extends RichMenuActionLike>(
  areas: RichMenuAreaLike<T>[],
  from: RichMenuImageSize,
  to: RichMenuImageSize,
): RichMenuAreaLike<T>[] {
  if (!from.width || !from.height) return areas
  const sx = to.width / from.width
  const sy = to.height / from.height
  return areas.map((area) => {
    const x = Math.round(area.bounds.x * sx)
    const y = Math.round(area.bounds.y * sy)
    const width = Math.round(area.bounds.width * sx)
    const height = Math.round(area.bounds.height * sy)
    // 端数で画像からはみ出さないようにクランプする
    return {
      action: area.action,
      bounds: {
        x,
        y,
        width: Math.max(1, Math.min(width, to.width - x)),
        height: Math.max(1, Math.min(height, to.height - y)),
      },
    }
  })
}

/**
 * 作り直したエリアに、以前のアクションを順番（index）どおり引き継ぐ。
 * 以前よりエリアが少なければ、はみ出した分のアクションは捨てる。
 */
export function carryOverActions<T extends RichMenuActionLike>(
  next: RichMenuAreaLike<T>[],
  previous: RichMenuAreaLike<T>[],
): RichMenuAreaLike<T>[] {
  return next.map((area, i) =>
    previous[i] ? { bounds: area.bounds, action: previous[i].action } : area,
  )
}

/**
 * 画像を差し替えたときにエリアをどう扱うかの判定。
 * 事故の再発防止の中心ロジックなので、UI から切り離して単体テスト対象にしている。
 *
 * - initial       : 初回アップロード。レイアウトを提案してエリアを作る
 * - keep          : 同じサイズ。エリアもアクションもそのまま
 * - scale         : 縦横比が同じでサイズだけ違う。座標だけ比例変換（アクション保持）
 * - keep-as-is    : サイズは違うが既存の範囲が収まる。そのまま
 * - rebuild       : 収まらない。ユーザーに確認したうえで作り直す（アクションは順番で引き継ぎ）
 */
export type ImageSwapPlan =
  | { kind: 'initial' }
  | { kind: 'keep' }
  | { kind: 'scale' }
  | { kind: 'keep-as-is' }
  | { kind: 'rebuild' }

export function planImageSwap(
  prevSize: RichMenuImageSize | null,
  nextSize: RichMenuImageSize,
  areas: RichMenuAreaLike[],
): ImageSwapPlan {
  if (!prevSize || areas.length === 0) return { kind: 'initial' }
  if (isSameSize(prevSize, nextSize)) return { kind: 'keep' }
  if (isSameAspectRatio(prevSize, nextSize)) return { kind: 'scale' }
  if (allBoundsFit(areas, nextSize)) return { kind: 'keep-as-is' }
  return { kind: 'rebuild' }
}

