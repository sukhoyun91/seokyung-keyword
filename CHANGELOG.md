# 변경 기록 (CHANGELOG)

버전 규칙: `주.부.수정`
- **주** 버전: 구조가 크게 바뀌어 DB·설정을 다시 해야 할 때
- **부** 버전: 새 기능·새 메뉴 추가
- **수정** 버전: 오류 수정, 화면·문구 조정

배포 후 확인: 화면 왼쪽 위 `서경방송 마케팅 도구 vX.Y.Z` 의 번호가 아래 최신 버전과 같으면 반영된 것입니다.
GitHub 웹 업로드 시에는 각 버전의 **변경 파일**만 올리면 됩니다.

---

## v1.4.0 — 2026-11-18
**지역 행사 정보: 네 번째 공식 출처 '전국문화축제 표준데이터' 추가**
- 공공데이터포털 전국문화축제표준데이터(지자체 등록) OpenAPI 연동 — TourAPI와 같은 일반 인증키 사용
- 전국 자료를 받아 경남·선택 지역·검색 기간으로 거름. 주최·주관기관, 축제내용, 홈페이지, 전화번호를 근거에 포함
- 데이터가 아직 올해 일정으로 갱신되지 않은 축제(작년 같은 시기)는 참고로 포함하되 공식 날짜로 쓰지 않고 '확인 필요'로 표시
- 정합성 검증 강화: 관광공사와 표준데이터 날짜가 다르면 메모, AI가 날짜 없이 정리한 행사는 공식 날짜로 보완, AI가 빠뜨린 표준데이터 축제 자동 추가
- 수집 조건에 출처 체크박스 추가, 관리자 `연결 테스트`에서 TourAPI·표준데이터를 함께 진단

변경 파일: `lib/events/sources.ts`, `lib/events/types.ts`, `lib/events/validate.ts`, `lib/events/summarize.ts`, `lib/settings.ts`, `app/api/events/route.ts`, `app/api/events/[id]/step/route.ts`, `app/api/admin/test/route.ts`, `app/events/page.tsx`, `app/components/events/EventsHome.tsx`, `app/components/events/EventReportView.tsx`, `app/globals.css`, `package.json`, `README.md`, `CHANGELOG.md`

## v1.3.2 — 2026-11-18
**지자체 웹사이트 수집이 0건으로 나오는 문제 확인·개선**
- 원인 후보: AI가 검색 결과를 보고도 '인용'을 달지 않으면 출처를 모두 버리던 구조 → 인용 여부와 상관없이 검색 결과 페이지를 프로그램이 직접 열어, 검색 기간의 월과 행사 관련 단어가 함께 나오는 부분을 '원문 발췌'로 근거에 사용
- 검색 과정 기록: AI가 쓴 검색어, 검색어별 결과 수·오류, 찾은 페이지와 확인 결과(행사 문장 있음/없음/열기 실패), AI 답변을 보고서 `수집 내역 보기`에 표시
- 관리자 화면에 `지자체 검색 테스트` 추가 (첫 번째 지역의 다음 달 행사를 웹 검색 3회로 찾아 과정 표시)
- 지자체 도메인 설정에 한 지역 여러 줄 허용 (문화재단·문화예술회관 사이트 추가용)
- AI 검색 지시 개선: 시·군별로 따로 검색, 결과가 없으면 검색어를 바꿔 재검색

변경 파일: `lib/events/sources.ts`, `lib/events/types.ts`, `app/api/events/[id]/step/route.ts`, `app/api/admin/test/route.ts`, `app/components/AdminPanel.tsx`, `app/components/events/EventReportView.tsx`, `app/globals.css`, `package.json`, `CHANGELOG.md`

## v1.3.1 — 2026-11-18
**TourAPI 축제 자료가 0건으로 나오는 문제 수정**
- 조회 방식 변경: 종료일 조건을 빼고, 검색 시작일 120일 전부터 조회해 이미 시작해 진행 중인 축제도 포함 (기간 판단은 프로그램이 직접)
- 경남 판별 강화: 주소(경상남도·경남) + 법정동 시도코드(48) + 지역코드(36). 경남 코드 조회가 안 되면 전국 조회 후 주소로 거름
- 응답 필드 이름의 대소문자 차이(eventstartdate / eventStartDate 등)에 상관없이 읽음
- 진단 정보 표시: 관리자 `연결 테스트`와 보고서 `수집 내역 보기`에 "받은 자료 → 경남 → 선택 지역 → 기간 내" 건수와 주소 예시 표시

변경 파일: `lib/events/sources.ts`, `app/api/events/[id]/step/route.ts`, `app/api/admin/test/route.ts`, `app/components/events/EventReportView.tsx`, `app/globals.css`, `package.json`, `CHANGELOG.md`

## v1.3.0 — 2026-11-18
**지역 축제·행사 정보 수집 추가**
- 메뉴 `지역 행사 정보` 추가: 검색 기간(작성일과 별개)·지역·검색어를 정해 축제·행사 정보를 모아 보고서로 저장
- 기본 검색어(축제, 행사) + 추가 검색어 입력
- 수집 출처 3가지: 한국관광공사 TourAPI(공식), 지자체 웹사이트(Claude 웹 검색, 시·군청 도메인으로 제한), 네이버 뉴스(API HUB)
- AI 정리: 모든 행사에 출처 번호(근거) 표시, 출처 간 차이·참고 기사 정리
- 정합성 검증(프로그램이 다시 확인): 없는 출처 근거 제외, 관광공사 공식 기간과 대조해 수정, 원문에 날짜가 있는지 확인, 검색 기간 밖 제외, 중복 합치기, 빠진 공식 축제 자동 추가
- 신뢰도 표시: 공식 확인 / 복수 출처 / 확인 필요
- 담당자 메모, 행사 빼기, 텍스트 복사, 인쇄/PDF
- 관리자 설정: TourAPI 인증키, 지자체 도메인 목록, 웹 검색 최대 횟수, TourAPI 연결 테스트

변경 파일
- 추가: `app/events/`, `app/api/events/`, `app/components/events/`, `lib/events/`, `db/schema-events.sql`
- 수정: `lib/settings.ts`, `app/components/AdminPanel.tsx`, `app/api/admin/test/route.ts`, `app/components/NavBar.tsx`, `app/globals.css`, `scripts/init-db.mjs`, `package.json`, `README.md`, `CHANGELOG.md`

## v1.2.0 — 2026-11-18
**검색광고 월간 보고서 추가**
- 메뉴 `검색광고 보고서` 추가: 네이버 다차원 보고서(계정·캠페인·광고그룹·매체·키워드·확장검색어) csv/xlsx 업로드 → DB 누적
- 광고주 여러 곳 관리 (계정 번호 자동 인식)
- 웹 보고서: 성과 요약, 월별 실적·차트, 캠페인 유형별, 광고그룹별, 매체별, 키워드, 키워드 누적 추이(피벗 대체), 검색어 분석
- 월별 입력값: 세금계산서, 쿠폰, 비고, 광고그룹 하루예산·지역타겟
- AI 담당자 의견 초안 생성 → 수정 → 저장, 복사
- 인쇄/PDF 저장 (A4 가로)
- 화면에 버전 번호 표시, CHANGELOG 추가

변경 파일
- 추가: `app/ads/`, `app/api/ads/`, `app/components/ads/`, `lib/ads/`, `lib/version.ts`, `db/schema-ads.sql`, `CHANGELOG.md`
- 수정: `app/components/NavBar.tsx`, `app/login/page.tsx`, `app/globals.css`, `lib/db.ts`, `scripts/init-db.mjs`, `next.config.mjs`, `package.json`, `README.md`

## v1.1.1 — 2026-11-17
- AI 응답 형식 오류(`Expected ',' or ']' after array element in JSON`) 수정: 결과를 정해진 양식(도구 호출)으로만 받도록 변경

변경 파일: `lib/claude.ts`

## v1.1.0 — 2026-11-17
- 기본 AI 모델을 Claude Haiku 5.5로 변경
- 서경방송 노출 순위 조회(선택 기능, NAVER API HUB) 추가

변경 파일: `lib/settings.ts`, `lib/exposure.ts`, `lib/types.ts`, `app/api/analyze/route.ts`, `app/api/admin/test/route.ts`, `app/components/Analyzer.tsx`, `app/components/AdminPanel.tsx`, `app/components/excel.ts`, `app/page.tsx`, `README.md`

## v1.0.0 — 2026-11-17
- 최초 버전: 이미지·PDF·사이트·텍스트 → AI 키워드 생성 → 네이버 검색량 순 정렬 → 엑셀/보고서 다운로드
- 로그인, 관리자/사용자 계정, API 키 암호화 관리
