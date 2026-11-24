import { HttpError, requireAdmin, errorResponse } from '@/lib/auth';
import { getSettingsForAdmin, saveSetting, SETTING_DEFS, type SettingKey } from '@/lib/settings';

export async function GET() {
  try {
    await requireAdmin();
    return Response.json({ settings: await getSettingsForAdmin() });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * body: { values: { key: value } }
 * 비밀값은 빈 문자열이면 "변경 안 함", clear 목록에 있으면 삭제
 */
export async function PUT(req: Request) {
  try {
    const me = await requireAdmin();
    const { values = {}, clear = [] } = await req.json();
    for (const [key, raw] of Object.entries(values as Record<string, string>)) {
      if (!(key in SETTING_DEFS)) continue;
      const def = SETTING_DEFS[key as SettingKey];
      const value = String(raw ?? '').trim();
      if (def.secret && !value) continue;
      if (key === 'naver_customer_id' && value && !/^\d+$/.test(value)) {
        throw new HttpError(400, `네이버 고객 ID는 숫자입니다 (예: 1234567). '${value}'는 로그인 아이디로 보입니다. 검색광고 화면 오른쪽 위 또는 도구 → API 사용 관리에서 확인하세요.`);
      }
      await saveSetting(key as SettingKey, value, me.id);
    }
    for (const key of clear as string[]) {
      if (key in SETTING_DEFS) await saveSetting(key as SettingKey, '', me.id);
    }
    return Response.json({ ok: true, settings: await getSettingsForAdmin() });
  } catch (e) {
    return errorResponse(e);
  }
}
