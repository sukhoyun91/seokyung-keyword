import { query } from '@/lib/db';
import { ensureAdsSchema } from '@/lib/ads/schema';
import { credsForAccount } from '@/lib/ads/naverAds';
import { collectMonth } from '@/lib/ads/collect';
import { saveCollected } from '@/lib/ads/collectSave';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * 매월 자동 수집 (Vercel Cron, vercel.json): 지난달 자료를 API 키가 있는 모든 계정에 대해 저장
 * Vercel 환경변수 CRON_SECRET 이 있어야 동작 (없으면 거부)
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return new Response('unauthorized', { status: 401 });
  await ensureAdsSchema();
  const kst = new Date(Date.now() + 9 * 3600_000);
  const prev = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() - 1, 1));
  const month = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`;
  const accounts = await query<{ id: number; name: string }>('SELECT id, name FROM ad_accounts WHERE active ORDER BY id');
  const result: { account: string; ok: boolean; note: string }[] = [];
  for (const a of accounts) {
    const creds = await credsForAccount(a.id);
    if (!creds) continue;
    try {
      const r = await collectMonth(creds, month);
      await saveCollected(a.id, r, null);
      result.push({ account: a.name, ok: true, note: `${r.rows.keyword.length} keywords` });
    } catch (e: any) {
      result.push({ account: a.name, ok: false, note: String(e?.message ?? e).slice(0, 200) });
    }
  }
  return Response.json({ month, result });
}
