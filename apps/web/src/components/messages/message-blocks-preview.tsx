'use client'

/**
 * 複数メッセージブロックのスマホ風プレビュー。
 * LINEトーク画面風の縦並び表示で、各ブロックを実際の見え方に近い形で確認できる。
 * - text: 緑の吹き出し
 * - image: 角丸サムネ（リンク付きの場合はバッジ表示）
 * - flex: 既存の FlexPreviewComponent をそのまま使用
 */

import FlexPreviewComponent from '@/components/flex-preview'
import type { Block } from './message-blocks-editor'

interface Props {
  blocks: Block[]
}

export default function MessageBlocksPreview({ blocks }: Props) {
  const valid = blocks.filter((b) => {
    if (b.type === 'text') return b.text.trim().length > 0
    if (b.type === 'image') return b.originalContentUrl.trim().length > 0
    return b.contents.trim().length > 0
  })

  return (
    <div className="rounded-2xl border border-gray-200 bg-[#8CABD8] p-3 shadow-inner">
      {/* スマホヘッダー風 */}
      <div className="text-center text-[10px] text-white/80 font-medium mb-2 tracking-wider">
        LINEトーク プレビュー
      </div>

      {/* メッセージ吹き出しエリア */}
      <div className="space-y-2 max-h-[600px] overflow-y-auto">
        {valid.length === 0 ? (
          <div className="text-center text-xs text-white/70 py-8">
            メッセージを入力するとここにプレビューが表示されます
          </div>
        ) : (
          valid.map((b, i) => (
            <div key={b.id} className="flex">
              {/* 自分側風（右寄せ・緑）。配信は実際には公式アカウント発信なので左寄せ白がより正確だが、
                  視認性優先でテキスト/画像はLINE標準の「相手の吹き出し（白・左寄せ）」スタイル */}
              <div className="max-w-[85%]">
                {b.type === 'text' && (
                  <div className="bg-white text-gray-800 text-sm px-3 py-2 rounded-2xl rounded-tl-sm whitespace-pre-wrap break-words shadow-sm">
                    {b.text}
                  </div>
                )}
                {b.type === 'image' && (
                  <div className="relative">
                    {/* 直接<img>を使う：プレビュー画像URLが入っていればそちらを優先 */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={b.previewImageUrl || b.originalContentUrl}
                      alt={`block ${i + 1}`}
                      className="rounded-2xl rounded-tl-sm max-h-[280px] object-cover shadow-sm"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.opacity = '0.3'
                      }}
                    />
                    {b.linkUrl?.trim() && (
                      <div className="absolute bottom-2 left-2 right-2 bg-black/60 text-white text-[10px] px-2 py-1 rounded">
                        🔗 タップで遷移：{b.linkUrl.length > 36 ? b.linkUrl.slice(0, 36) + '…' : b.linkUrl}
                      </div>
                    )}
                  </div>
                )}
                {b.type === 'flex' && (
                  <div className="rounded-xl overflow-hidden shadow-sm bg-white">
                    <FlexPreviewComponent content={b.contents} maxWidth={280} />
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
