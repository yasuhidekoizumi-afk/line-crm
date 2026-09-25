import { beforeEach, describe, expect, it, vi } from 'vitest'
const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
import { readFileSync } from 'node:fs'
import { Hono } from 'hono'
import { influencers } from '../src/routes/influencers.ts'

vi.mock('@line-crm/db', () => ({
  getLineAccountByChannelId: vi.fn(), getLineAccountById: vi.fn(),
  getAccountRole: vi.fn(async (_db, _id, role, account) => account === 'account-a' ? role : null),
  getAccessibleLineAccountIds: vi.fn(),
}))
vi.mock('../src/services/email-link.js', () => ({ verifyLineUserFromToken: vi.fn() }))
vi.mock('../src/services/influencer-slack-notify.js', () => ({ notifyInfluencerRegistration: vi.fn() }))

let sql
let app
let role
const migration = (name) => readFileSync(new URL(`../../../packages/db/migrations/${name}`, import.meta.url), 'utf8')
const request = (path, body, method = 'PATCH') => app.request(path, { method: body ? method : 'GET', ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
const row = () => sql.prepare('SELECT * FROM influencer_gifting_logs WHERE id=?').get('log-a')

beforeEach(() => {
  sql?.close()
  sql = new DatabaseSync(':memory:')
  sql.exec(`CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
    CREATE TABLE friends (id TEXT PRIMARY KEY, line_account_id TEXT, display_name TEXT);
    CREATE TABLE influencer_profiles (friend_id TEXT, instagram_handle TEXT);
    INSERT INTO line_accounts VALUES ('account-a'), ('account-b');
    INSERT INTO friends VALUES ('friend-a','account-a','テスト担当'),('friend-b','account-b','別アカウント');`)
  sql.exec(migration('063_influencer_gifting_logs.sql'))
  sql.exec(`INSERT INTO influencer_gifting_logs (id,friend_id,line_account_id,product_name,status,post_url,reach,effect_notes)
    VALUES ('log-a','friend-a','account-a','商品A','posted','https://example.com/post',123,'既存メモ');`)
  sql.exec(migration('070_influencer_campaign_shipping.sql'))
  const db = { prepare(query) {
    let args = []
    const prepared = { bind(...values) { args = values; return prepared },
      async first() { return sql.prepare(query).get(...args) ?? null },
      async all() { return { results: sql.prepare(query).all(...args) } },
      async run() { return sql.prepare(query).run(...args) } }
    return prepared
  } }
  role = 'admin'
  app = new Hono()
  app.use('*', async (c, next) => { c.env = { DB: db }; c.set('staff', { id: 'staff-a', role }); await next() })
  app.route('/', influencers)
})

describe('募集案件と送付状況', () => {
  it('移行時は発送ステータスまたは発送日のある記録だけ送付済みにする', () => {
    const legacy = new DatabaseSync(':memory:')
    legacy.exec("CREATE TABLE friends (id TEXT PRIMARY KEY); CREATE TABLE line_accounts (id TEXT PRIMARY KEY); INSERT INTO friends VALUES ('f'); INSERT INTO line_accounts VALUES ('a');")
    legacy.exec(migration('063_influencer_gifting_logs.sql'))
    legacy.exec(`INSERT INTO influencer_gifting_logs (id,friend_id,line_account_id,product_name,status,shipped_at)
      VALUES ('1','f','a','商品','shipped',NULL), ('2','f','a','商品','posted','2026-08-01'), ('3','f','a','商品','requested',NULL);`)
    legacy.exec(migration('070_influencer_campaign_shipping.sql'))
    expect(legacy.prepare('SELECT shipment_status FROM influencer_gifting_logs ORDER BY id').all().map((r) => r.shipment_status)).toEqual(['shipped','shipped','unknown'])
    legacy.close()
  })
  it('投稿済みだけでは送付済みと推測しない', () => { expect(row().shipment_status).toBe('unknown') })
  it('チェックしても投稿・効果・実際の発送日を捏造しない', async () => {
    expect((await request('/api/influencer-gifting/log-a/shipment', { shipmentStatus: 'shipped' })).status).toBe(200)
    expect(row()).toMatchObject({ shipment_status: 'shipped', shipped_at: null, status: 'posted', reach: 123, effect_notes: '既存メモ' })
    const data = await (await request('/api/influencer-gifting?lineAccountId=account-a')).json()
    expect(data.data[0].shipmentStatus).toBe('shipped')
  })
  it('チェック解除で発送日を消しても投稿記録は保持する', async () => {
    sql.exec("UPDATE influencer_gifting_logs SET shipment_status='shipped', shipped_at='2026-09-01'")
    await request('/api/influencer-gifting/log-a/shipment', { shipmentStatus: 'pending' })
    expect(row()).toMatchObject({ shipment_status: 'pending', shipped_at: null, status: 'posted', post_url: 'https://example.com/post' })
  })
  it('案件名だけの更新で他項目を消さない', async () => {
    expect((await request('/api/influencer-gifting/log-a', { campaignName: '9月募集' })).status).toBe(200)
    expect(row()).toMatchObject({ campaign_name: '9月募集', product_name: '商品A', shipment_status: 'unknown', effect_notes: '既存メモ', reach: 123 })
  })
  it('案件への参加を未送付で作成できる', async () => {
    const res = await request('/api/influencer-gifting', { lineAccountId: 'account-a', friendId: 'friend-a', productName: '商品B', campaignName: '8月募集' }, 'POST')
    expect(res.status).toBe(201)
    expect((await res.json()).data).toMatchObject({ campaignName: '8月募集', shipmentStatus: 'pending' })
  })
  it('別アカウントの参加者は登録できない', async () => {
    expect((await request('/api/influencer-gifting', { lineAccountId: 'account-a', friendId: 'friend-b', productName: '商品B' }, 'POST')).status).toBe(400)
  })
  it('他アカウントと閲覧担当者の更新を拒否する', async () => {
    role = 'operator'
    expect((await request('/api/influencer-gifting/log-a/shipment', { shipmentStatus: 'shipped' })).status).toBe(403)
    role = 'admin'
    sql.exec("UPDATE influencer_gifting_logs SET line_account_id='account-b'")
    expect((await request('/api/influencer-gifting/log-a/shipment', { shipmentStatus: 'shipped' })).status).toBe(403)
    expect(row().shipment_status).toBe('unknown')
  })
  it('不正な送付状況と存在しない履歴を拒否する', async () => {
    expect((await request('/api/influencer-gifting/log-a/shipment', { shipmentStatus: 'invalid' })).status).toBe(400)
    expect((await request('/api/influencer-gifting/missing/shipment', { shipmentStatus: 'shipped' })).status).toBe(404)
  })
  it('旧画面の発送日更新でも送付済みに揃える', async () => {
    await request('/api/influencer-gifting/log-a', { shippedAt: '2026-09-20' })
    expect(row()).toMatchObject({ shipment_status: 'shipped', shipped_at: '2026-09-20' })
  })
})
