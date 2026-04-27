/**
 * FERMENT: Next.js 管理画面用 API クライアント
 *
 * 既存の fetchApi を活用して FERMENT エンドポイントを呼び出す。
 */

import { fetchApi } from './api'

// ============================================================
// 型定義
// ============================================================

export interface EmailTemplate {
  template_id: string
  name: string
  category: string | null
  language: string
  subject_base: string | null
  preheader_base: string | null
  body_html: string | null
  body_text: string | null
  ai_system_prompt: string | null
  ai_enabled: number
  from_name: string
  from_email: string | null
  reply_to: string | null
  created_at: string
  updated_at: string
}

export interface EmailCampaign {
  campaign_id: string
  name: string
  template_id: string | null
  segment_id: string | null
  status: string
  scheduled_at: string | null
  sent_at: string | null
  total_targets: number
  total_sent: number
  total_opened: number
  total_clicked: number
  total_bounced: number
  total_revenue: number
  created_at: string
  updated_at: string
}

export interface EmailFlow {
  flow_id: string
  name: string
  description: string | null
  trigger_type: string | null
  trigger_config: string | null
  is_active: number
  steps?: EmailFlowStep[]
  created_at: string
  updated_at: string
}

export interface EmailFlowStep {
  step_id: string
  flow_id: string
  step_order: number
  delay_hours: number
  template_id: string | null
  condition: string | null
  created_at: string
}

export interface Segment {
  segment_id: string
  name: string
  description: string | null
  rules: string
  channel_scope: string
  customer_count: number
  last_computed_at: string | null
  created_at: string
  updated_at: string
}

export interface Customer {
  customer_id: string
  email: string | null
  line_user_id: string | null
  display_name: string | null
  region: string
  language: string
  ltv: number
  ltv_currency: string
  order_count: number
  last_order_at: string | null
  subscribed_email: number
  tags: string | null
  created_at: string
  updated_at: string
}

export interface EmailLog {
  log_id: string
  to_email: string
  subject: string | null
  status: string
  campaign_id: string | null
  queued_at: string
  sent_at: string | null
  opened_at: string | null
  first_clicked_at: string | null
}

export interface ApiResult<T> {
  success: boolean
  data?: T
  error?: string
  meta?: { total: number; limit: number; offset: number }
}

// ============================================================
// FERMENT API クライアント
// ============================================================

export const fermentApi = {
  // ---- テンプレート ----
  templates: {
    list: () =>
      fetchApi<ApiResult<EmailTemplate[]>>('/api/email/templates'),
    get: (id: string) =>
      fetchApi<ApiResult<EmailTemplate>>(`/api/email/templates/${id}`),
    create: (data: Partial<EmailTemplate>) =>
      fetchApi<ApiResult<EmailTemplate>>('/api/email/templates', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: Partial<EmailTemplate>) =>
      fetchApi<ApiResult<EmailTemplate>>(`/api/email/templates/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchApi<ApiResult<null>>(`/api/email/templates/${id}`, { method: 'DELETE' }),
    preview: (id: string, customerId?: string) =>
      fetchApi<ApiResult<{ subject: string; html: string; text: string }>>(`/api/email/templates/${id}/preview`, {
        method: 'POST',
        body: JSON.stringify({ customer_id: customerId }),
      }),
    aiEdit: (id: string, instruction: string) =>
      fetchApi<ApiResult<{ subject: string; body_html: string; body_text: string; diff_summary: string }>>(
        `/api/email/templates/${id}/ai-edit`,
        { method: 'POST', body: JSON.stringify({ instruction }) },
      ),
  },

  // ---- AI 画像生成（cockpit 配下）----
  cockpit: {
    generateImage: (params: {
      prompt: string
      size?: '1024x1024' | '1024x1536' | '1536x1024' | 'auto'
      quality?: 'low' | 'medium' | 'high' | 'auto'
      reference_image_urls?: string[]
    }) =>
      fetchApi<ApiResult<{ url: string; key: string; size: string; quality: string; cost_usd: number; used_reference: boolean }>>(
        '/api/ferment/cockpit/generate-image',
        { method: 'POST', body: JSON.stringify(params) },
      ),
  },

  // ---- キャンペーン ----
  campaigns: {
    list: (params?: { status?: string; limit?: number; offset?: number }) => {
      const query = new URLSearchParams()
      if (params?.status) query.set('status', params.status)
      if (params?.limit) query.set('limit', String(params.limit))
      if (params?.offset) query.set('offset', String(params.offset))
      return fetchApi<ApiResult<EmailCampaign[]>>(`/api/email/campaigns?${query}`)
    },
    get: (id: string) =>
      fetchApi<ApiResult<EmailCampaign>>(`/api/email/campaigns/${id}`),
    create: (data: { name: string; template_id?: string; segment_id?: string }) =>
      fetchApi<ApiResult<EmailCampaign>>('/api/email/campaigns', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: Partial<EmailCampaign>) =>
      fetchApi<ApiResult<EmailCampaign>>(`/api/email/campaigns/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchApi<ApiResult<null>>(`/api/email/campaigns/${id}`, { method: 'DELETE' }),
    schedule: (id: string, scheduledAt: string) =>
      fetchApi<ApiResult<null>>(`/api/email/campaigns/${id}/schedule`, {
        method: 'POST',
        body: JSON.stringify({ scheduled_at: scheduledAt }),
      }),
    send: (id: string) =>
      fetchApi<ApiResult<{ sent: number; failed: number; total_targets: number }>>(`/api/email/campaigns/${id}/send`, {
        method: 'POST',
      }),
    cancel: (id: string) =>
      fetchApi<ApiResult<null>>(`/api/email/campaigns/${id}/cancel`, { method: 'POST' }),
    stats: (id: string) =>
      fetchApi<ApiResult<{ total: number; sent: number; opened: number; clicked: number; open_rate: string; click_rate: string }>>(`/api/email/campaigns/${id}/stats`),
  },

  // ---- フロー ----
  flows: {
    list: () =>
      fetchApi<ApiResult<EmailFlow[]>>('/api/email/flows'),
    get: (id: string) =>
      fetchApi<ApiResult<EmailFlow>>(`/api/email/flows/${id}`),
    create: (data: { name: string; description?: string; trigger_type?: string; trigger_config?: object }) =>
      fetchApi<ApiResult<EmailFlow>>('/api/email/flows', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: Partial<EmailFlow>) =>
      fetchApi<ApiResult<EmailFlow>>(`/api/email/flows/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchApi<ApiResult<null>>(`/api/email/flows/${id}`, { method: 'DELETE' }),
    addStep: (flowId: string, step: { step_order: number; delay_hours?: number; template_id?: string }) =>
      fetchApi<ApiResult<EmailFlowStep[]>>(`/api/email/flows/${flowId}/steps`, {
        method: 'POST',
        body: JSON.stringify(step),
      }),
    deleteStep: (flowId: string, stepId: string) =>
      fetchApi<ApiResult<null>>(`/api/email/flows/${flowId}/steps/${stepId}`, { method: 'DELETE' }),
    enroll: (flowId: string, customerId: string) =>
      fetchApi<ApiResult<{ enrollment_id: string }>>(`/api/email/flows/${flowId}/enroll`, {
        method: 'POST',
        body: JSON.stringify({ customer_id: customerId }),
      }),
  },

  // ---- セグメント ----
  segments: {
    list: () =>
      fetchApi<ApiResult<Segment[]>>('/api/segments'),
    get: (id: string) =>
      fetchApi<ApiResult<Segment>>(`/api/segments/${id}`),
    create: (data: { name: string; description?: string; rules: object; channel_scope?: string }) =>
      fetchApi<ApiResult<Segment>>('/api/segments', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: Partial<Segment>) =>
      fetchApi<ApiResult<Segment>>(`/api/segments/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchApi<ApiResult<null>>(`/api/segments/${id}`, { method: 'DELETE' }),
    recompute: (id: string) =>
      fetchApi<ApiResult<{ customer_count: number }>>(`/api/segments/${id}/recompute`, { method: 'POST' }),
    members: (id: string, opts?: { limit?: number; offset?: number; with_email?: boolean }) => {
      const query = new URLSearchParams()
      if (opts?.limit) query.set('limit', String(opts.limit))
      if (opts?.offset) query.set('offset', String(opts.offset))
      if (opts?.with_email) query.set('with_email', 'true')
      return fetchApi<ApiResult<Customer[]>>(`/api/segments/${id}/members?${query}`)
    },
  },

  // ---- 顧客 ----
  customers: {
    list: (params?: { region?: string; subscribed_email?: boolean; limit?: number; offset?: number }) => {
      const query = new URLSearchParams()
      if (params?.region) query.set('region', params.region)
      if (params?.subscribed_email !== undefined) query.set('subscribed_email', String(params.subscribed_email))
      if (params?.limit) query.set('limit', String(params.limit))
      if (params?.offset) query.set('offset', String(params.offset))
      return fetchApi<ApiResult<Customer[]>>(`/api/customers?${query}`)
    },
    get: (id: string) =>
      fetchApi<ApiResult<Customer>>(`/api/customers/${id}`),
    update: (id: string, data: Partial<Customer>) =>
      fetchApi<ApiResult<Customer>>(`/api/customers/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    events: (id: string, limit = 50) =>
      fetchApi<ApiResult<unknown[]>>(`/api/customers/${id}/events?limit=${limit}`),
    emails: (id: string, limit = 50) =>
      fetchApi<ApiResult<EmailLog[]>>(`/api/customers/${id}/emails?limit=${limit}`),
  },

  // ---- ログ ----
  logs: {
    list: (params?: { campaign_id?: string; customer_id?: string; limit?: number; offset?: number }) => {
      const query = new URLSearchParams()
      if (params?.campaign_id) query.set('campaign_id', params.campaign_id)
      if (params?.customer_id) query.set('customer_id', params.customer_id)
      if (params?.limit) query.set('limit', String(params.limit))
      if (params?.offset) query.set('offset', String(params.offset))
      return fetchApi<ApiResult<EmailLog[]>>(`/api/email/logs?${query}`)
    },
  },
}
