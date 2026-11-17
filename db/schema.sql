-- 서경방송 키워드 프로그램 DB 스키마
-- 분석 결과(키워드·검색량)는 저장하지 않습니다. 계정·설정·일일 사용량만 저장합니다.

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(50)  NOT NULL UNIQUE,
  name          VARCHAR(100) NOT NULL,
  password_hash TEXT         NOT NULL,
  role          VARCHAR(10)  NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  active        BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

-- 관리자 설정 (API 키 등 비밀값은 AES-256-GCM 으로 암호화되어 저장)
CREATE TABLE IF NOT EXISTS settings (
  key        VARCHAR(60) PRIMARY KEY,
  value      TEXT        NOT NULL,
  encrypted  BOOLEAN     NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by INTEGER     REFERENCES users(id) ON DELETE SET NULL
);

-- 사용자별 일일 분석 횟수 (AI 비용 관리용, 분석 내용은 저장하지 않음)
CREATE TABLE IF NOT EXISTS usage_daily (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day     DATE    NOT NULL,
  count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
