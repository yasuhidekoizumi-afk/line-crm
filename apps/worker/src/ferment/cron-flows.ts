/**
 * FERMENT: フロー（ステップ配信）の定期処理 cron
 *
 * 10分毎に実行 (wrangler.toml の cron: every 10 minutes)
 * next_send_at <= now かつ status = 'active' の enrollment を処理する。
 *
 * 呼び出し元:
 *   - apps/worker/src/index.ts (scheduled handler)
 */

import {
  getDueEnrollments,
  updateEnrollment,
  getEmailFlowSteps,
  getCustomerById,
  generateFermentId,
} from '@line-crm/db';
import { executeFlowStep } from './send-engine.js';

interface FermentEnv {
  DB: D1Database;
  RESEND_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GEMINI_API_KEY?: string;
  SLACK_WEBHOOK_URL?: string;
  FERMENT_FROM_EMAIL_JP?: string;
  FERMENT_FROM_EMAIL_US?: string;
  FERMENT_FROM_NAME_JP?: string;
  FERMENT_FROM_NAME_US?: string;
  FERMENT_UNSUBSCRIBE_BASE_URL?: string;
  FERMENT_HMAC_SECRET?: string;
}

/**
 * 期限が来たフロー enrollment を処理する
 */
export async function processFlowDeliveries(env: FermentEnv): Promise<void> {
  const enrollments = await getDueEnrollments(env.DB, 50);

  for (const enrollment of enrollments) {
    try {
      const steps = await getEmailFlowSteps(env.DB, enrollment.flow_id);
      const currentStep = steps.find((s) => s.step_order === enrollment.current_step);

      if (!currentStep) {
        // ステップが見つからない = フロー完了
        await updateEnrollment(env.DB, enrollment.enrollment_id, {
          status: 'completed',
          completed_at: new Date().toISOString(),
        });
        continue;
      }

      // 顧客情報を取得
      const customer = await getCustomerById(env.DB, enrollment.customer_id);
      if (!customer || !customer.email || !customer.subscribed_email) {
        await updateEnrollment(env.DB, enrollment.enrollment_id, { status: 'canceled' });
        continue;
      }

      // このステップのメールを送信
      if (currentStep.template_id) {
        await executeFlowStep(
          customer,
          currentStep.template_id,
          enrollment.flow_id,
          currentStep.step_id,
          env,
        );
      }

      // 次のステップへ進める
      const nextStep = steps.find((s) => s.step_order === enrollment.current_step + 1);

      if (nextStep) {
        // 次のステップの送信時刻を計算
        const nextSendAt = new Date(
          Date.now() + nextStep.delay_hours * 60 * 60 * 1000,
        ).toISOString();
        await updateEnrollment(env.DB, enrollment.enrollment_id, {
          current_step: nextStep.step_order,
          next_send_at: nextSendAt,
        });
      } else {
        // 最後のステップ = フロー完了
        await updateEnrollment(env.DB, enrollment.enrollment_id, {
          status: 'completed',
          completed_at: new Date().toISOString(),
          next_send_at: null,
        });
      }
    } catch (err) {
      console.error(`[FERMENT] フロー配信エラー: ${enrollment.enrollment_id}`, err);
    }
  }
}
