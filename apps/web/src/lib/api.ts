import type {
  Friend,
  Tag,
  Scenario,
  ScenarioStep,
  ApiResponse,
  PaginatedResponse,
  User,
  LineAccount,
  ConversionPoint,
  Affiliate,
  Template,
  Automation,
  AutomationLog,
  Chat,
  Reminder,
  ReminderStep,
  ScoringRule,
  IncomingWebhook,
  OutgoingWebhook,
  NotificationRule,
  Notification,
  AccountHealthLog,
  AccountMigration,
  StaffMember,
} from '@line-crm/shared'

import type { Broadcast } from '@line-crm/shared'

/** Broadcast type from API (now camelCase after worker serialization) */
export type ApiBroadcast = Broadcast

const API_URL = process.env.NEXT_PUBLIC_API_URL
if (!API_URL) {
  throw new Error(
    'NEXT_PUBLIC_API_URL is not set. Build cannot proceed without a valid API URL. ' +
    'Set it in .env.production (local) or GitHub Secrets (CI).'
  )
}

/**
 * Read the API key from localStorage (set during login).
 * Never embed secrets in the client bundle via NEXT_PUBLIC_* env vars.
 */
function getApiKey(): string {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('lh_api_key') || ''
  }
  return ''
}

export async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getApiKey()}`,
      ...options?.headers,
    },
  })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json() as Promise<T>
}
