import { requireAdmin, errorResponse } from '@/lib/auth';
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
