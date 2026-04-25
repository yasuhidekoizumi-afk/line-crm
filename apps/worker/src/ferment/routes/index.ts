/**
 * FERMENT: ルートエクスポートインデックス
 *
 * apps/worker/src/index.ts からここを import してルートを登録する。
 */

import { Hono } from 'hono';
import { emailTemplateRoutes } from './templates.js';
import { emailCampaignRoutes } from './campaigns.js';
import { emailFlowRoutes } from './flows.js';
import { emailLogRoutes } from './logs.js';
import { suppressionRoutes } from './suppressions.js';
import { segmentRoutes } from './segments.js';
import { customerRoutes } from './customers.js';
import { webhookRoutes } from './webhooks.js';
import { publicEmailRoutes } from './unsubscribe.js';
import { backfillRoutes } from '../backfill.js';
import { formAdminRoutes, formPublicRoutes } from './forms.js';
import {
  cartWebhookRoutes,
  reviewRoutes,
  reviewAdminRoutes,
  smsRoutes,
  recommendRoutes,
  insightRoutes,
} from './phase2.js';
import {
  aiRoutes,
  attributionRoutes,
  analyticsRoutes,
  smsCampaignRoutes,
} from './phase4.js';
import { phase5Routes } from './phase5.js';
import { cockpitRoutes } from './cockpit.js';
import type { FermentEnv } from '../types.js';

// /api/email/* 配下のルートをまとめる
const emailApiRouter = new Hono<FermentEnv>();
emailApiRouter.route('/', emailTemplateRoutes);
emailApiRouter.route('/', emailCampaignRoutes);
emailApiRouter.route('/', emailFlowRoutes);
emailApiRouter.route('/', emailLogRoutes);
emailApiRouter.route('/', suppressionRoutes);

// エクスポート
export {
  emailApiRouter,
  segmentRoutes,
  customerRoutes,
  webhookRoutes,
  publicEmailRoutes,
  backfillRoutes,
  formAdminRoutes,
  formPublicRoutes,
  cartWebhookRoutes,
  reviewRoutes,
  reviewAdminRoutes,
  smsRoutes,
  recommendRoutes,
  insightRoutes,
  aiRoutes,
  attributionRoutes,
  analyticsRoutes,
  smsCampaignRoutes,
  phase5Routes,
  cockpitRoutes,
};
