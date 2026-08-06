const GIFTING_LINE_ACCOUNT_ID = 'oryzae-gifting-line-20260714'

export type InfluencerSlackEnv = {
  GIFTING_SLACK_WEBHOOK_URL?: string
}

export type InfluencerRegistrationNotification = {
  lineAccountId: string
  event: 'follow_without_profile' | 'follow_with_profile' | 'profile_completed'
  lineDisplayName: string | null
  instagramHandle: string | null
}

/**
 * ギフティング専用アカウントの友だち追加・プロフィール登録をSlackへ通知する。
 * 発送先や連絡先は載せず、通知障害で登録自体を失敗させない。
 */
export async function notifyInfluencerRegistration(
  env: InfluencerSlackEnv,
  input: InfluencerRegistrationNotification
): Promise<void> {
  if (input.lineAccountId !== GIFTING_LINE_ACCOUNT_ID) return
  if (!env.GIFTING_SLACK_WEBHOOK_URL) {
    console.warn('[influencer-slack] GIFTING_SLACK_WEBHOOK_URLが未設定のため通知をスキップしました')
    return
  }

  const hasProfile = input.event !== 'follow_without_profile'
  const title = hasProfile ? '①友達登録＋プロフィール登録されました' : '②友達登録されました（プロフィール登録なし）'
  const lineName = input.lineDisplayName?.trim() || '未取得'
  const instagram = input.instagramHandle?.trim()
    ? `@${input.instagramHandle.trim().replace(/^@/, '')}`
    : '未登録'
  const text = [`🎁 ${title}`, `LINE名：${lineName}`, `IGアカウント名：${instagram}`].join('\n')

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
