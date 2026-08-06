const GIFTING_LINE_ACCOUNT_ID = 'oryzae-gifting-line-20260714'

export type InfluencerSlackEnv = {
  GIFTING_SLACK_WEBHOOK_URL?: string
}

/**
 * ギフティング専用アカウントの新規登録だけをSlackへ通知する。
 * 個人情報は載せず、通知障害で登録自体を失敗させない。
 */
export async function notifyInfluencerRegistration(
  env: InfluencerSlackEnv,
  input: { lineAccountId: string; registrationSource: 'line' | 'manual' }
): Promise<void> {
  if (input.lineAccountId !== GIFTING_LINE_ACCOUNT_ID) return
  if (!env.GIFTING_SLACK_WEBHOOK_URL) {
    console.warn('[influencer-slack] GIFTING_SLACK_WEBHOOK_URLが未設定のため通知をスキップしました')
    return
  }

  const source = input.registrationSource === 'manual' ? '管理画面（Instagram DM）' : 'LINEプロフィール'
  const text = `🎁 ギフティングアカウントでインフルエンサーの新規登録が発生しました（登録経路: ${source}）`

  try {
    const response = await fetch(env.GIFTING_SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    if (!response.ok) console.error('[influencer-slack] Slack通知に失敗しました:', response.status)
  } catch (error) {
    console.error('[influencer-slack] Slack通知中に例外が発生しました:', error)
  }
}

