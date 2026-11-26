import { query } from './db';
import { encrypt, decrypt, mask } from './crypto';

/**
 * 관리자 화면에서 관리하는 설정 항목.
 * secret: true 인 항목은 암호화 저장되고 화면에는 마스킹되어 표시됩니다.
 */
export const SETTING_DEFS = {
  anthropic_api_key: { label: 'Claude API 키', secret: true, default: '' },
  claude_model: { label: 'Claude 모델', secret: false, default: 'claude-haiku-5-5' },
  naver_account_label: { label: '네이버 검색광고 계정(아이디 표시용)', secret: false, default: '' },
  naver_customer_id: { label: '네이버 고객 ID (CUSTOMER_ID · 숫자, 로그인 아이디 아님)', secret: false, default: '' },
  naver_access_license: { label: '네이버 액세스 라이선스', secret: true, default: '' },
  naver_secret_key: { label: '네이버 비밀키', secret: true, default: '' },
  naver_hub_client_id: { label: 'API HUB Client ID', secret: false, default: '' },
  naver_hub_client_secret: { label: 'API HUB Client Secret', secret: true, default: '' },
  exposure_targets: {
    label: '서경방송 주소 목록(쉼표 구분: 도메인 또는 블로그·카페 주소)',
    secret: false,
    default: 'iscs.co.kr',
  },
  exposure_areas: { label: '노출 순위 확인 영역(blog, webkr, cafearticle 중 쉼표 구분)', secret: false, default: 'blog,webkr' },
  tour_api_key: { label: '공공데이터포털 일반 인증키 (TourAPI·문화축제 표준데이터 공용)', secret: true, default: '' },
  event_default_sido: { label: '지역 행사 정보 기본 시·도', secret: false, default: '경상남도' },
  event_default_regions: {
    label: '기본 선택 지역 (쉼표 구분, 화면의 "기본 지역" 버튼)',
    secret: false,
    default: '진주시,사천시,통영시,거제시,고성군,남해군,하동군,산청군,함양군,거창군,합천군,의령군',
  },
  gov_domains: {
    label: '추가 검색 사이트 (지역:도메인, 줄마다 하나 · 기본으로 전국 go.kr 전체를 검색)',
    secret: false,
    default:
      '진주:jinju.go.kr\n사천:sacheon.go.kr\n통영:tongyeong.go.kr\n거제:geoje.go.kr\n고성:goseong.go.kr\n남해:namhae.go.kr\n하동:hadong.go.kr\n산청:sancheong.go.kr\n함양:hygn.go.kr\n거창:geochang.go.kr\n합천:hc.go.kr\n의령:uiryeong.go.kr\n경남:gyeongnam.go.kr',
  },
  ig_access_token: { label: '인스타그램 접근 토큰 (Meta · 서경방송 페이스북 페이지 관리자 계정으로 발급)', secret: true, default: '' },
  ig_user_id: { label: '서경방송 인스타그램 비즈니스 계정 ID (숫자 · 비워 두면 연결 테스트가 찾아서 저장)', secret: false, default: '' },
  ig_accounts: { label: '수집할 지자체 인스타그램 (지역:아이디, 줄마다 하나)', secret: false, default: '진주:jinjucity' },
  event_web_search_max: { label: '보고서 1건당 AI 웹 검색 최대 횟수 (1회 약 15원)', secret: false, default: '8' },
  region_list: { label: '지역 키워드 목록(쉼표 구분)', secret: false, default: '진주,사천,통영,거제,고성,남해,하동,산청,함양,거창,합천,의령' },
  brand_context: {
    label: 'AI에 전달할 회사·서비스 설명',
    secret: false,
    default:
      '서경방송은 경남 서부 지역(진주 등)의 케이블방송·통신 사업자로, 케이블TV, 초고속 인터넷, 인터넷전화, 알뜰폰, 결합상품, 지역 채널(지역 뉴스·프로그램)을 제공합니다.',
  },
  daily_limit: { label: '사용자 1인당 하루 분석 횟수 한도', secret: false, default: '50' },
  max_keywords: { label: '한 번에 요청할 수 있는 최대 키워드 수', secret: false, default: '50' },
} as const;

export type SettingKey = keyof typeof SETTING_DEFS;

export async function getSettings(): Promise<Record<SettingKey, string>> {
  const rows = await query<{ key: string; value: string; encrypted: boolean }>(
    'SELECT key, value, encrypted FROM settings',
  );
  const out = {} as Record<SettingKey, string>;
  for (const k of Object.keys(SETTING_DEFS) as SettingKey[]) out[k] = SETTING_DEFS[k].default;
  for (const r of rows) {
    if (!(r.key in SETTING_DEFS)) continue;
    try {
      out[r.key as SettingKey] = r.encrypted ? decrypt(r.value) : r.value;
    } catch {
      out[r.key as SettingKey] = ''; // ENCRYPTION_KEY 변경 등으로 복호화 실패
    }
  }
  return out;
}

/** 관리자 화면용: 비밀값은 마스킹 */
export async function getSettingsForAdmin() {
  const s = await getSettings();
  return (Object.keys(SETTING_DEFS) as SettingKey[]).map((key) => {
    const def = SETTING_DEFS[key];
    return {
      key,
      label: def.label,
      secret: def.secret,
      value: def.secret ? '' : s[key],
      masked: def.secret ? mask(s[key]) : '',
      isSet: Boolean(s[key]),
    };
  });
}

export async function saveSetting(key: SettingKey, value: string, userId: number) {
  const def = SETTING_DEFS[key];
  const stored = def.secret && value ? encrypt(value) : value;
  await query(
    `INSERT INTO settings (key, value, encrypted, updated_at, updated_by)
     VALUES ($1, $2, $3, NOW(), $4)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, encrypted = EXCLUDED.encrypted,
       updated_at = NOW(), updated_by = EXCLUDED.updated_by`,
    [key, stored, def.secret && Boolean(value), userId],
  );
}
