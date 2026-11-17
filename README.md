# 서경방송 키워드 분석 프로그램

마케팅팀이 **이미지 · PDF · 사이트 주소 · 텍스트**를 넣으면 AI(Claude)가 검색 키워드 후보를 만들고,
**네이버 검색광고 API의 월간 검색량 순으로 정렬**해 보여 주는 웹 프로그램입니다.
결과는 **엑셀(.xlsx)** 또는 **인쇄용 보고서(PDF 저장)**로 내려받습니다.

## 1. 주요 기능

| 구분 | 내용 |
|---|---|
| 입력 | 이미지(JPG·PNG·WEBP), PDF(3MB 이하), 사이트 주소, 텍스트 |
| 키워드 생성 | 요청 개수의 약 2.5배 후보 생성 → 검색량 순으로 상위 N개 선별 (핵심·연관·롱테일·지역·브랜드 유형) |
| 검색량 | 네이버 PC·모바일 월간 검색량, 경쟁 정도, 네이버 연관 키워드 추가 |
| 노출 순위 | 결과 키워드로 네이버 블로그·웹문서·카페를 검색해 서경방송 주소가 상위 100위 중 몇 위인지 표시 |
| 결과물 | 엑셀(요약+썸네일 / 키워드 순위 / 해시태그·영문), 보고서 인쇄·PDF, 키워드·해시태그 복사 |
| 계정 | 로그인 필수, 관리자/사용자 구분, 계정 추가·중지·삭제·비밀번호 초기화 |
| 관리자 설정 | Claude API 키, 네이버 검색광고 API(고객 ID·액세스 라이선스·비밀키), 지역 목록, 회사 설명, 일일 사용 한도 |

**DB에 저장하는 것**: 계정, 설정(API 키는 AES-256 암호화), 사용자별 일일 사용 횟수
**저장하지 않는 것**: 업로드한 이미지, 분석 결과 키워드 (엑셀로만 보관)

## 2. 준비물

1. **Node.js 20 이상**
2. **Neon Postgres** (neon.com, 무료 플랜: 프로젝트당 1GB — 이 프로그램은 수 MB도 쓰지 않습니다)
   - 회사 공용 계정(법인 Gmail 등)으로 가입 권장
3. **Claude API 키** (console.anthropic.com, 회사 결제 수단 등록)
4. **네이버 검색광고 API 키** (searchad.naver.com → 광고주 가입 → 도구 → API 사용 관리) — 검색량
5. **NAVER API HUB 키** (네이버 클라우드 플랫폼 콘솔 → NAVER API HUB → Application 등록 → 블로그·웹문서·카페 검색 선택 → 인증 정보) — 노출 순위

## 3. 설치 (처음 한 번)

```bash
npm install

# 1) 환경변수 파일 만들기
cp .env.example .env.local
#   .env.local 을 열어 DATABASE_URL, SESSION_SECRET, ENCRYPTION_KEY 입력
#   비밀값 생성: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 2) DB 테이블 만들기 + 최초 관리자 계정 생성
npm run db:init -- admin 관리자비밀번호8자이상 관리자이름

# 3) 실행
npm run dev        # 개발용 → http://localhost:3000
```

## 4. 첫 로그인 후 할 일 (관리자)

1. `관리자` 메뉴 → **Claude API** 키 입력 → 저장 → `연결 테스트`
2. **네이버 검색광고 API** 고객 ID·액세스 라이선스·비밀키 입력 → 저장 → `연결 테스트`
3. **네이버 검색 API — API HUB** Client ID·Secret, 서경방송 주소 목록(예: `iscs.co.kr, blog.naver.com/블로그아이디`) 입력 → `연결 테스트`
4. **AI 분석 기준**의 회사 설명·지역 목록을 실제 서비스에 맞게 수정
5. **사용자 계정**에서 마케팅팀원 계정 추가

## 5. 배포할 때 (나중에 결정)

- Next.js 표준 앱이라 Vercel, Netlify, Cloudflare, 사내 서버(`npm run build && npm start`) 어디든 올릴 수 있습니다.
- **Vercel 무료(Hobby) 플랜은 회사 업무용 사용이 약관상 허용되지 않으므로** Vercel을 쓰려면 Pro 플랜이 필요합니다.
- 배포 환경에도 `.env.local`과 같은 3개 환경변수를 등록하면 됩니다. API 키는 관리자 화면에서 입력하므로 환경변수에 넣지 않습니다.
- 서버 요청 크기 제한(약 4.5MB)에 맞추기 위해 이미지는 브라우저에서 자동으로 줄여 보내고, PDF는 3MB로 제한했습니다.

## 6. 보안 수칙

- `.env.local`, `ENCRYPTION_KEY`는 GitHub·메신저·엑셀로 공유하지 마세요.
- `ENCRYPTION_KEY`를 바꾸면 저장된 API 키가 해독되지 않으니 관리자 화면에서 다시 입력해야 합니다.
- 네이버 **비밀번호는 이 프로그램에 저장하지 않습니다.** API 키만 사용합니다.
- 로그인 5회 실패 시 해당 아이디는 5분간 잠깁니다.

## 7. 폴더 구조

```
app/
  page.tsx                 분석 화면
  admin/page.tsx           관리자 화면
  login/page.tsx           로그인
  components/              Analyzer(분석 UI), AdminPanel, NavBar, excel.ts(엑셀 생성)
  api/analyze              AI 키워드 생성 + 네이버 검색량 정렬
  api/admin/*              계정·설정·연결 테스트
  api/auth/*, api/me/*     로그인·로그아웃·비밀번호 변경
lib/
  claude.ts                Claude API 호출·프롬프트
  naver.ts                 네이버 검색광고 키워드도구 API
  site.ts                  사이트 본문 추출 (내부망 접근 차단)
  auth.ts, crypto.ts, settings.ts, db.ts
db/schema.sql              테이블 정의
scripts/init-db.mjs        테이블 생성·관리자 생성
```

## 8. 참고

- 검색량은 네이버 검색광고 키워드도구 기준 최근 한 달 수치이며, `10 미만`은 네이버가 정확한 값을 주지 않는 경우입니다(정렬 시 5로 환산).
- 키워드는 네이버 조회 시 띄어쓰기를 붙여 조회합니다. 네이버 연관 키워드는 검색량 10 이상만 후보에 넣습니다.
- Claude 모델은 관리자 설정에서 바꿀 수 있습니다 (기본값 `claude-haiku-5-5`).
- 노출 순위는 NAVER API HUB 검색 API(일 25,000회 한도) 기준이며, 네이버 통합검색 첫 화면의 배치와는 다를 수 있습니다. 키워드 20개 × 영역 2개면 1회 분석에 40회 호출합니다.
- 기존 네이버 개발자센터(openapi.naver.com) 검색 API는 API HUB로 이관 중이라 처음부터 API HUB 방식으로 만들었습니다. API HUB는 현재 한시적 무료이며, 가입 시 결제 카드 등록이 필요합니다.
