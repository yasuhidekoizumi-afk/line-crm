'use client'

import { useState, useEffect } from 'react'

const STEPS = [
  {
    title: '👋 LINE Harness へようこそ',
    description: 'この管理画面では、LINE公式アカウントの友だち管理、チャット対応、自動配信、売上分析など、すべての業務を一箇所で行えます。',
    tips: ['まずは左のメニューから使いたい機能を選びましょう', '右上のアカウント切替でLINEアカウントを選択できます'],
  },
  {
    title: '👥 友だちを管理する',
    description: '「友だち管理」では、LINE友だちの一覧・検索・タグ付けができます。タグを使うと「VIP」「購入済み」などのグループ分けが可能です。',
    tips: ['タグはフィルターや自動配信の条件に使えます', '友だち詳細から個別にメッセージを送れます'],
  },
  {
    title: '💬 チャット対応',
    description: '「個別チャット」では、お客さまからのメッセージにリアルタイムで返信できます。未読・対応中・解決済のステータス管理も可能です。',
    tips: ['定型文テンプレートでよく使う返信をワンクリック', '顧客情報パネルでタグやポイントを確認しながら対応'],
  },
  {
    title: '📨 自動配信を設定する',
    description: '「LINEシナリオ」では、友だち追加後や購入後の決まったタイミングでメッセージを自動配信できます。一度設定すれば、あとは自動で動きます。',
    tips: ['「友だち追加→1日後→クーポン」のような流れを作れます', 'シナリオは後から編集・一時停止も可能です'],
  },
  {
    title: '📊 データを見る',
    description: '「売上分析」では、Shopifyの購入データとLINEの連携状況を可視化できます。どのチャネルから売上が発生しているか一目で分かります。',
    tips: ['期間フィルターで表示範囲を自由に変更できます', 'コホート分析でLINE連携の効果を確認できます'],
  },
]

const ONBOARDING_KEY = 'lh_onboarding_completed'

export default function OnboardingTour() {
  const [visible, setVisible] = useState(false)
  const [step, setStep] = useState(0)

  useEffect(() => {
    try {
      const completed = localStorage.getItem(ONBOARDING_KEY)
      if (completed !== '1') setVisible(true)
    } catch {}
  }, [])

  const handleComplete = () => {
    try { localStorage.setItem(ONBOARDING_KEY, '1') } catch {}
    setVisible(false)
  }

  const handleSkip = () => {
    handleComplete()
  }

  if (!visible) return null

  const current = STEPS[step]
  const isLast = step === STEPS.length - 1

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        {/* プログレスバー */}
        <div className="h-1.5 bg-gray-100">
          <div className="h-full bg-green-500 transition-all duration-300"
            style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
        </div>

        <div className="px-6 py-6">
          <div className="text-center mb-6">
            <div className="text-5xl mb-4">{current.title.split(' ')[0]}</div>
            <h2 className="text-xl font-bold text-gray-900">{current.title}</h2>
          </div>

          <p className="text-sm text-gray-600 leading-relaxed mb-4">
            {current.description}
          </p>

          <div className="bg-green-50 border border-green-100 rounded-lg p-4 mb-6">
            <p className="text-xs font-semibold text-green-800 mb-2">💡 ポイント</p>
            <ul className="space-y-1.5">
              {current.tips.map((tip, i) => (
                <li key={i} className="text-xs text-green-700 flex items-start gap-1.5">
                  <span>•</span>
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* ステップインジケーター */}
          <div className="flex justify-center gap-1.5 mb-6">
            {STEPS.map((_, i) => (
              <div key={i} className={`w-2 h-2 rounded-full transition-colors ${
                i === step ? 'bg-green-500' : i < step ? 'bg-green-200' : 'bg-gray-200'
              }`} />
            ))}
          </div>

          <div className="flex items-center justify-between">
            <button onClick={handleSkip} className="text-xs text-gray-400 hover:text-gray-600">
              スキップする
            </button>
            <div className="flex gap-2">
              {step > 0 && (
                <button onClick={() => setStep(step - 1)}
                  className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">
                  戻る
                </button>
              )}
              {isLast ? (
                <button onClick={handleComplete}
                  className="px-6 py-2 text-sm font-medium text-white rounded-lg"
                  style={{ backgroundColor: '#06C755' }}>
                  始める！
                </button>
              ) : (
                <button onClick={() => setStep(step + 1)}
                  className="px-6 py-2 text-sm font-medium text-white rounded-lg"
                  style={{ backgroundColor: '#06C755' }}>
                  次へ
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
