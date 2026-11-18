import { requireUser, errorResponse } from '@/lib/auth';
import { buildReport } from '@/lib/ads/report';

export const runtime = 'nodejs';

/** GET /api/ads/report?account=1&month=2026-10 */
export async function GET(req: Request) {
  try {
    await requireUser();
    const url = new URL(req.url);
    const report = await buildReport(Number(url.searchParams.get('account')), String(url.searchParams.get('month') || ''));
    return Response.json(report);
  } catch (e) {
    return errorResponse(e);
  }
}
