-- 검색광고 월간 보고서용 테이블 (프로그램이 처음 사용할 때 자동으로 생성합니다)

-- 광고주(네이버 검색광고 계정)
CREATE TABLE IF NOT EXISTS ad_accounts (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  customer_id VARCHAR(30)  NOT NULL UNIQUE,
  memo        TEXT         NOT NULL DEFAULT '',
  active      BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 네이버 다차원 보고서 원천 데이터 (텍스트로 정리해 행 단위 저장)
-- level: account | campaign | adgroup | media | keyword | searchterm
CREATE TABLE IF NOT EXISTS ad_stats (
  id            BIGSERIAL PRIMARY KEY,
  account_id    INTEGER      NOT NULL REFERENCES ad_accounts(id) ON DELETE CASCADE,
  month         DATE         NOT NULL,
  level         VARCHAR(12)  NOT NULL,
  campaign_type VARCHAR(50)  NOT NULL DEFAULT '',
  campaign      VARCHAR(200) NOT NULL DEFAULT '',
  ad_group      VARCHAR(200) NOT NULL DEFAULT '',
  dim           VARCHAR(300) NOT NULL DEFAULT '',
  search_type   VARCHAR(50)  NOT NULL DEFAULT '',
  impressions   BIGINT       NOT NULL DEFAULT 0,
  clicks        BIGINT       NOT NULL DEFAULT 0,
  cost          BIGINT       NOT NULL DEFAULT 0,
  avg_rank      NUMERIC(8,2)
);
CREATE INDEX IF NOT EXISTS ad_stats_lookup ON ad_stats (account_id, level, month);

-- 업로드 기록
CREATE TABLE IF NOT EXISTS ad_uploads (
  id          SERIAL PRIMARY KEY,
  account_id  INTEGER      NOT NULL REFERENCES ad_accounts(id) ON DELETE CASCADE,
  level       VARCHAR(12)  NOT NULL,
  months      TEXT         NOT NULL,
  file_name   VARCHAR(300) NOT NULL DEFAULT '',
  row_count   INTEGER      NOT NULL DEFAULT 0,
  uploaded_by INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 원천 파일에 없는 월별 수기 입력값 + 담당자 의견
CREATE TABLE IF NOT EXISTS ad_monthly_notes (
  account_id     INTEGER     NOT NULL REFERENCES ad_accounts(id) ON DELETE CASCADE,
  month          DATE        NOT NULL,
  tax_invoice    BIGINT,
  coupon         BIGINT,
  note           TEXT        NOT NULL DEFAULT '',
  opinion        TEXT        NOT NULL DEFAULT '',
  opinion_by     INTEGER     REFERENCES users(id) ON DELETE SET NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account_id, month)
);

-- 광고그룹별 운영 설정 (하루예산·지역타겟)
CREATE TABLE IF NOT EXISTS ad_group_settings (
  account_id    INTEGER      NOT NULL REFERENCES ad_accounts(id) ON DELETE CASCADE,
  month         DATE         NOT NULL,
  ad_group      VARCHAR(200) NOT NULL,
  daily_budget  BIGINT,
  region_target VARCHAR(200) NOT NULL DEFAULT '',
  PRIMARY KEY (account_id, month, ad_group)
);

-- 관계사 (서경방송·서경엔카 등). 광고 계정은 관계사 아래에 둡니다
CREATE TABLE IF NOT EXISTS ad_companies (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL UNIQUE,
  logo        TEXT         NOT NULL DEFAULT '',
  memo        TEXT         NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
ALTER TABLE ad_accounts ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES ad_companies(id) ON DELETE SET NULL;
-- 예전에 등록한 광고주는 같은 이름의 관계사로 옮김 (한 번만 실행되는 효과)
INSERT INTO ad_companies (name) SELECT DISTINCT name FROM ad_accounts WHERE company_id IS NULL ON CONFLICT (name) DO NOTHING;
UPDATE ad_accounts a SET company_id = c.id FROM ad_companies c WHERE a.company_id IS NULL AND c.name = a.name;

-- 네이버 검색광고 API 키 (계정별, 암호화 저장). 비어 있으면 관리자 설정 키를 고객 ID가 같을 때 사용
ALTER TABLE ad_accounts ADD COLUMN IF NOT EXISTS api_license TEXT NOT NULL DEFAULT '';
ALTER TABLE ad_accounts ADD COLUMN IF NOT EXISTS api_secret TEXT NOT NULL DEFAULT '';
