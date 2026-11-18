// db/schema-events.sql 과 같은 내용 (배포 환경에서 파일 읽기 없이 쓰기 위해 코드에 포함)
export const EVENTS_SCHEMA_SQL = `-- 지역 축제·행사 정보 수집 보고서 (프로그램이 처음 사용할 때 자동으로 생성합니다)
CREATE TABLE IF NOT EXISTS event_reports (
  id           SERIAL PRIMARY KEY,
  title        VARCHAR(200) NOT NULL,
  period_start DATE         NOT NULL,
  period_end   DATE         NOT NULL,
  regions      TEXT         NOT NULL DEFAULT '',
  keywords     TEXT         NOT NULL DEFAULT '',
  options      JSONB        NOT NULL DEFAULT '{}'::jsonb,
  status       VARCHAR(20)  NOT NULL DEFAULT 'collecting',
  steps        JSONB        NOT NULL DEFAULT '{}'::jsonb,
  sources      JSONB        NOT NULL DEFAULT '[]'::jsonb,
  result       JSONB,
  memo         TEXT         NOT NULL DEFAULT '',
  created_by   INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS event_reports_created ON event_reports (created_at DESC);
`;
