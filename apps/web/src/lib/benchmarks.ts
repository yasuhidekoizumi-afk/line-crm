/**
 * メールマーケティング業界ベンチマーク
 * 出典: Mailchimp / Klaviyo / Campaign Monitor 公開データ (2024-2025)
 */

export interface IndustryBenchmark {
  industry: string
  open_rate: number
  click_rate: number
  bounce_rate: number
  unsubscribe_rate: number
}

export const BENCHMARKS: Record<string, IndustryBenchmark> = {
  ecommerce: {
    industry: 'EC・小売（食品）',
    open_rate: 28.5,
    click_rate: 3.2,
    bounce_rate: 0.6,
    unsubscribe_rate: 0.3,
  },
  fashion: {
    industry: 'ファッション',
    open_rate: 21.8,
    click_rate: 2.1,
    bounce_rate: 0.5,
    unsubscribe_rate: 0.3,
  },
  food_beverage: {
    industry: '食品・飲料',
    open_rate: 28.3,
    click_rate: 3.0,
    bounce_rate: 0.6,
    unsubscribe_rate: 0.3,
  },
  health_wellness: {
    industry: '健康・ウェルネス',
    open_rate: 26.8,
    click_rate: 3.4,
    bounce_rate: 0.7,
    unsubscribe_rate: 0.3,
  },
  newsletter: {
    industry: 'ニュースレター全般',
    open_rate: 27.6,
    click_rate: 2.8,
    bounce_rate: 0.5,
    unsubscribe_rate: 0.3,
  },
}

export const ORYZAE_BENCHMARK = BENCHMARKS.food_beverage

export function compareToBenchmark(
  metric: 'open' | 'click' | 'bounce' | 'unsubscribe',
  yourValue: number,
  benchmark = ORYZAE_BENCHMARK,
): { diff: number; status: 'good' | 'average' | 'bad'; label: string } {
  const benchValue = {
    open: benchmark.open_rate,
    click: benchmark.click_rate,
    bounce: benchmark.bounce_rate,
    unsubscribe: benchmark.unsubscribe_rate,
  }[metric]

  const diff = yourValue - benchValue
  const isPositiveBetter = metric === 'open' || metric === 'click'

  let status: 'good' | 'average' | 'bad' = 'average'
  if (isPositiveBetter) {
    if (diff >= 2) status = 'good'
    else if (diff <= -3) status = 'bad'
  } else {
    if (diff <= -0.2) status = 'good'
    else if (diff >= 0.5) status = 'bad'
  }

  const label =
    status === 'good' ? '👍 業界平均より良好' :
    status === 'bad' ? '⚠️ 業界平均を下回っています' :
    '➖ 業界平均と同程度'

  return { diff, status, label }
}
