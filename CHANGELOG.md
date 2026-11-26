# 변경 기록 (CHANGELOG)

버전 규칙: `주.부.수정`
- **주** 버전: 구조가 크게 바뀌어 DB·설정을 다시 해야 할 때
- **부** 버전: 새 기능·새 메뉴 추가
- **수정** 버전: 오류 수정, 화면·문구 조정

배포 후 확인: 화면 왼쪽 위 `서경방송 마케팅 도구 vX.Y.Z` 의 번호가 아래 최신 버전과 같으면 반영된 것입니다.
GitHub 웹 업로드 시에는 각 버전의 **변경 파일**만 올리면 됩니다.

---

## v1.11.3 — 2026-11-26 · 캠페인 유형 분리 표시 수정

**오류 수정**
- 보고서 "4. 캠페인 유형별 운영 현황"에서 같은 캠페인이 달마다 "파워링크"와 "1. 서경방송"(캠페인 이름), "브랜드검색"과 "브랜드검색_서경방송"으로 나뉘어 표시되던 문제
  - 원인: 일부 달의 캠페인 보고서 파일에 "캠페인유형" 열이 없어 유형이 빈 채 저장됨 → 보고서가 빈 유형 대신 캠페인 이름을 씀
  - 기존 자료 자동 보정: 프로그램이 처음 DB에 연결될 때 같은 광고주·같은 캠페인의 다른 달 유형으로 빈 유형을 채움
  - 앞으로 올리는 자료: 캠페인 자료를 올리거나 API로 받을 때마다 같은 방식으로 빈 유형을 채움 (예전 달도 함께)
  - 보고서: 그래도 비어 있으면 캠페인 이름으로 추정(브랜드→브랜드검색, 플레이스, 쇼핑, 파워컨텐츠)

**변경 파일**
- `package.json`
- `CHANGELOG.md`
- `lib/ads/report.ts`
- `lib/ads/save.ts`
- `lib/ads/schema-sql.ts`
- `db/schema-ads.sql`

---

## v1.11.2 — 2026-11-26 · 효율 판정 기준 수정

**오류 수정**
- "광고그룹별 광고비 대비 클릭 기여도"에서 광고비 0원 그룹(브랜드검색 등 정액 상품)이 클릭 비중을 크게 차지해, 다른 그룹이 모두 "효율 낮음"으로 잘못 판정되던 문제
  - 광고비가 있는 그룹끼리만 비중을 계산해 비교
  - 광고비 0원 그룹은 "효율 낮음"으로 표시하지 않고 그래프 아래에 클릭 수와 함께 따로 안내
- 그래프 아래에 판정 기준 표시: 클릭당 비용이 평균(광고비 있는 그룹)보다 10% 이상 싸면 효율 우수, 10% 이상 비싸면 효율 낮음, 그 사이 보통
- "기타 n개 그룹"은 판정하지 않음

**변경 파일**
- `package.json`
- `CHANGELOG.md`
- `app/components/ads/ExecDashboard.tsx`
- `app/globals.css`

---

## v1.11.1 — 2026-11-26 · 인스타그램 연결 오류 안내 개선

**오류 수정**
- 계정 ID 칸에 이메일 등 숫자가 아닌 값을 넣으면 Meta 오류가 "@jinjucity 계정을 찾을 수 없음"으로 잘못 안내되던 문제
  - 연결 테스트: 숫자 ID가 아니면 비우고 연결된 계정 ID를 자동으로 다시 찾아 저장
  - 수집 단계: 숫자 ID가 아니면 원인과 해결 방법을 바로 안내
  - 서경방송 계정 ID 오류와 지자체 계정 오류를 구분해서 안내
- 단기 토큰(1~2시간)이면 연결 테스트에 경고 표시 + 연장 방법 안내, 만료까지 하루 미만이면 시간 단위로 표시
- 안내서에 계정 ID는 숫자(17841…)라는 설명 추가

**변경 파일**
- `package.json`
- `CHANGELOG.md`
- `docs/인스타그램-연결-안내.md`
- `lib/events/instagram.ts`
- `lib/settings.ts`
- `app/api/admin/test/route.ts`
- `app/api/events/[id]/step/route.ts`

---

## v1.11.0 — 2026-11-26 · 지역 행사 정보: 지자체 인스타그램 수집

**새 기능**
- 지역 행사 정보 수집 출처에 **지자체 인스타그램 (공식 계정 게시물)** 추가
  - Meta 공식 Instagram API(Business Discovery)로 서경방송 비즈니스 계정 토큰을 써서 지자체 공식 계정(예: @jinjucity)의 공개 게시물을 읽음 (스크래핑 없음)
  - 기간 시작 60일 전 ~ 기간 끝 게시물 중 행사 관련 글만 근거로 채택, AI 정리에 "지자체 공식 인스타그램"으로 전달
  - 지자체 공식 계정 게시물은 공식 출처로 취급 (날짜 확인 시 "공식 확인")
- 관리자 → **지자체 인스타그램 (Meta Instagram API)** 설정
  - 접근 토큰(암호화 저장), 서경방송 인스타그램 계정 ID, 수집할 계정 목록(`진주:jinjucity` 형식)
  - 연결 테스트: 토큰 확인 + 만료일 표시, 계정 ID 자동 찾기·저장, 첫 계정 게시물 읽기 시험
- 토큰 만료·권한 부족·계정 아님·호출 한도 오류를 각각 안내
- 연결 방법 안내서: `docs/인스타그램-연결-안내.md`

**변경 파일**
- `package.json`
- `CHANGELOG.md`
- `docs/인스타그램-연결-안내.md` (새 파일)
- `lib/events/instagram.ts` (새 파일)
- `lib/events/types.ts`
- `lib/events/summarize.ts`
- `lib/events/validate.ts`
- `lib/settings.ts`
- `app/api/events/route.ts`
- `app/api/events/[id]/step/route.ts`
- `app/api/admin/test/route.ts`
- `app/events/page.tsx`
- `app/components/events/EventsHome.tsx`
- `app/components/events/EventReportView.tsx`
- `app/components/AdminPanel.tsx`
- `app/globals.css`

---

## v1.10.2 — 2026-11-25 · 효율 그래프 교체

**변경**
- 한눈에 보기의 "광고그룹 효율 매트릭스"(점그래프)를 **"광고그룹별 광고비 대비 클릭 기여도"** 막대로 교체
  - 그룹마다 광고비 비중(주황)과 클릭 비중(파랑)을 나란히 표시, 오른쪽에 클릭당 비용과 효율 우수/보통/낮음 표시
  - 클릭률 차이가 커도(0.05%~50%) 그래프가 뭉치지 않음, 플레이스 포함 전체 그룹 표시
  - 광고비 상위 10개 그룹 + 나머지는 "기타 n개 그룹"으로 합침

**변경 파일**
- `package.json`
- `CHANGELOG.md`
- `app/components/ads/ExecDashboard.tsx`
- `app/globals.css`

---

## v1.10.1 — 2026-11-25 · AI 의견 빈 답 수정 + 보고서 HTML 다운로드

**새 기능**
- 검색광고 보고서 상단에 **[HTML 다운로드]** 버튼 추가
  - 지금 화면 그대로(시각화·표·담당자 의견 포함) 파일 하나짜리 HTML로 저장. 인터넷·로그인 없이 브라우저에서 열림
  - 편집 버튼·입력칸은 빠지고, 의견은 본문으로 들어감 (메일 첨부·공유용)

**오류 수정**
- 담당자 의견 [AI 초안 만들기]가 돌아가기만 하고 내용이 비어 있던 문제
  - 모델이 생각(thinking) 단계에서 답을 다 써 버려 본문이 비는 경우를 막음: 생각 단계 끔, 출력 한도 2000→4000
  - 빈 답이면 "초안을 만들었습니다" 대신 원인(모델·종료 사유)을 오류로 표시
  - 키 오류·모델 이름 오류·혼잡(429/529)·시간 초과를 구분해서 안내, 버튼 아래에도 오류 표시

**변경 파일**
- `package.json`
- `CHANGELOG.md`
- `app/components/ads/AdReportView.tsx`
- `app/api/ads/opinion/route.ts`

---

## v1.10.0 — 2026-11-25 · 검색광고 보고서: 전월 대비 비교 + 임원용 시각화

**새 기능**
- 보고서 맨 앞에 **★ 한눈에 보는 ○월 성과** (임원용 시각화) 추가
  - 핵심 메시지 한 줄 (광고비 대비 클릭·클릭당 비용 증감 → 효율 개선/유지/하락 자동 판정)
  - 핵심 지표 5개 타일: 당월 값, 전월 값, 증감, 개선·악화·보합 표시, 최근 13개월 추이선
  - 캠페인 유형별 전월 vs 당월 막대 (노출·클릭·광고비)
  - 광고비 구성비 (전월/당월 100% 막대)
  - 광고그룹 클릭 증감 막대 (변화 큰 순 상위 8개)
  - 광고그룹 효율 매트릭스 (클릭률 × 클릭당 비용, 원 크기 = 광고비, 플레이스 제외)
  - 마우스를 올리면 수치 툴팁, 인쇄 시 한 페이지로 분리
- **보고서 전체를 전월 대비로 작성**
  - 1. 요약: "전월 대비 주요 변화" 요약 상자 추가 (전체·캠페인 유형·광고그룹 증감 상위·신규/미운영 그룹·키워드)
  - 5. 광고그룹: 노출·클릭·광고비 전월/당월/증감, 클릭률·순위 전월/당월, 신규·미운영 표시
  - 6. 매체: 전월 노출·클릭·광고비와 증감 추가
  - 7. 키워드: 전월 광고비·광고비 증감 추가
  - 9. 검색어: 클릭 증감 추가
  - 전월 자료가 DB에 없으면 상단에 안내 (원천자료 관리에서 올리기/API 가져오기)
- AI 담당자 의견: 모든 성과 문장을 전월과 비교해 쓰도록 지시, 감소 키워드·신규/미운영 그룹 정보 추가

**오류 수정**
- 캠페인명이 빈 광고그룹(카쉐어링·사고대차 등)이 '플레이스'로 잘못 표시되던 문제
- 클릭률 증감이 0.1%p 미만일 때 "0.00%p"로 보이던 문제 (소수 셋째 자리까지 표시)

**변경 파일**
- `package.json`
- `CHANGELOG.md`
- `app/globals.css`
- `app/components/ads/ExecDashboard.tsx` (새 파일)
- `app/components/ads/AdReportView.tsx`
- `app/components/ads/fmt.tsx`
- `app/api/ads/opinion/route.ts`
- `lib/ads/report.ts`

---

## v1.9.2 — 2026-11-25
- 네이버 API 가져오기 오류 수정: "모든 ID는 동일한 타입이어야 합니다" (/stats 400) — 캠페인·광고그룹·키워드 ID를 종류별로 나눠 요청

변경 파일: `lib/ads/naverAds.ts`, `lib/ads/collect.ts`, `package.json`, `CHANGELOG.md`

## v1.9.1 — 2026-11-25
- 네이버 API 인증 실패 안내 개선: 네이버 응답 원문(키는 가림)을 함께 보여 주고, 원인(비밀키 불일치 / 계정 권한 없음)별로 안내
- API 키 저장 시 액세스 라이선스·비밀키가 서로 바뀌어 들어가면 자동으로 바로잡음, 공백 제거, 모양이 이상하면 경고

변경 파일: `lib/ads/naverAds.ts`, `app/api/ads/accounts/[id]/api/route.ts`, `app/components/ads/directory.tsx`, `package.json`, `CHANGELOG.md`

## v1.9.0 — 2026-11-25
**원천자료 관리: 파일 업로드 + 네이버 API 하이브리드**
- 새 탭 '② 네이버 API 가져오기': 관리 API(/ncc/campaigns·adgroups·keywords) + 통계 API(/stats)로 계정·캠페인·광고그룹·키워드 월 자료 수집 → DB 누적
  - '미리 받아 DB와 비교': 저장 전, 같은 달 DB 자료(CSV)와 종류별·캠페인 유형별·광고그룹별로 나란히 비교
  - '가져와서 DB에 저장': 그 달의 4종만 교체 (매체·검색어 파일 자료는 그대로), 하루예산도 함께 저장 (지역타겟은 유지)
  - 키워드 보고서의 '-' 줄(등록 키워드 밖 성과) = 광고그룹 합계 − 키워드 합계로 계산해 CSV와 같은 모양
  - 캠페인 평균노출순위도 채워짐 (CSV 방식에서는 비어 있던 값)
- 매체(검색/콘텐츠)·검색어는 지금처럼 '① 파일 업로드'로 (네이버 API로는 정확히 받을 수 없음)
- 광고 계정별 네이버 API 키 등록·연결 테스트 (왼쪽 계정 상자, 암호화 저장). 키가 없으면 관리자 설정 키를 고객 ID가 같을 때 사용
- 매월 자동 수집: 매월 2일 10:00(KST) 지난달 자료를 API 키가 있는 모든 계정에 저장 (Vercel 환경변수 CRON_SECRET 을 넣어야 동작)
- 시험: 서명 검증까지 하는 가짜 네이버 API(10월 CSV 자료)로 수집 → 10월 CSV와 계정·캠페인·광고그룹·키워드 모두 일치 확인

변경 파일: `lib/ads/naverAds.ts`(새 파일), `lib/ads/collect.ts`(새 파일), `lib/ads/collectSave.ts`(새 파일), `lib/ads/save.ts`(새 파일), `lib/ads/schema-sql.ts`, `db/schema-ads.sql`, `app/api/ads/collect/route.ts`(새 파일), `app/api/ads/accounts/[id]/api/route.ts`(새 파일), `app/api/cron/ads-collect/route.ts`(새 파일), `app/api/ads/accounts/route.ts`, `app/api/ads/upload/route.ts`, `app/components/data/ApiTab.tsx`(새 파일), `app/components/data/DataHome.tsx`, `app/components/ads/directory.tsx`, `app/globals.css`, `middleware.ts`, `vercel.json`, `package.json`, `README.md`, `CHANGELOG.md`

## v1.8.2 — 2026-11-25
- 상단 서경방송 로고를 흰색 로고(투명 배경)로 교체 — 파란 막대 위에 흰 상자 없이 표시
- 이미지 리사이징: 개체 자르기 추가
  - 보드에서 개체 선택 → 오른쪽 '✂ 자르기' → 노란 테두리·모서리를 끌어 남길 부분 지정(안쪽을 끌면 이동) → '자르기 적용' (Enter 적용, Esc 취소)
  - 되돌리기(Ctrl+Z)로 원래대로. 잘린 원래 개체는 '빠진 개체 넣기'로 다시 넣어 다른 부분을 또 자를 수 있음 (예: 카드 3장이 한 줄로 묶인 경우 1장씩 나누기)

변경 파일: `public/seokyung-logo-white.png`(새 파일), `app/components/NavBar.tsx`, `app/components/resize/BoardEditor.tsx`, `app/globals.css`, `package.json`, `CHANGELOG.md`

## v1.8.1 — 2026-11-25
**이미지 리사이징**
- 그라데이션 배경 대응: 배경을 한 가지 색이 아니라 '위치별 배경색 지도'로 추정해, 그라데이션·빛 번짐 배경에서도 개체가 뭉치지 않고 나뉨
- 보드 배경 선택: '원본 배경 늘리기'(그라데이션을 보드 크기로 늘려 채움, 그라데이션이면 기본) / '단색'
- 개체 지우기: 왼쪽 개체 목록의 ✕ → 모든 보드에서 빠지고 AI 변환·자동 배치에서도 제외 (보드 위 개체 삭제는 기존대로 Delete 키·삭제 버튼)
- 영역 지정해서 개체 만들기: 원본 위에 사각형을 그으면 그 부분이 개체가 됨 (그래도 뭉치는 부분을 직접 자를 때). 보고 있는 보드에 바로 들어감

변경 파일: `lib/resize/segment.ts`, `app/components/resize/ResizeHome.tsx`, `app/components/resize/BoardEditor.tsx`, `app/globals.css`, `package.json`, `CHANGELOG.md`

## v1.8.0 — 2026-11-24
**새 메뉴: 이미지 리사이징**
- 왼쪽: 원본 이미지 올리기 → 배경색 자동 인식, 개체(제목·카드·장식 등) 자동 찾기, 찾기 감도 조정
- 오른쪽: 사이즈 여러 개 선택 (인스타그램·페이스북/카카오/블로그·유튜브·사이니지·웹 배너 20종 + 직접 입력) → 사이즈마다 조정 보드
- AI 변환: Claude가 개체를 의미 단위로 묶고(제목, 카드 각각, 안내문, 장식) 사이즈별 줄 배치를 정함 → 프로그램이 크기·간격 계산
  - 세로 화면은 카드 2+1 등으로 재배치, 가로 화면은 줄을 옆으로 합침, 장식은 빈 모서리로
  - 'AI 없이 자동 배치'도 가능 (원본 줄 순서대로)
- 조정 보드: 끌어서 이동, 모서리로 크기(비율 유지), 숫자로 위치·크기 입력, 가운데 맞춤 안내선, 맨 앞/맨 뒤, 복제, 삭제, 되돌리기(Ctrl+Z), 방향키 이동, 글자 추가(크기·색·굵게), 배경색, 빠진 개체 다시 넣기
- 원본 대비 많이 확대된 개체(⚠)·보드 밖으로 나간 개체(↗) 표시
- 내려받기: 사이즈별 PNG/JPG, 전체 ZIP. 이미지는 브라우저 안에서만 처리하고 서버·DB에 저장하지 않음 (AI 변환 때 축소본만 Claude에 전송)

변경 파일: `app/resize/page.tsx`(새 파일), `app/components/resize/`(새 폴더: `ResizeHome.tsx`, `BoardEditor.tsx`), `app/api/resize/layout/route.ts`(새 파일), `lib/resize/`(새 폴더: `presets.ts`, `segment.ts`, `layout.ts`, `ai.ts`), `app/components/NavBar.tsx`, `app/globals.css`, `package.json`, `README.md`, `CHANGELOG.md`

## v1.7.0 — 2026-11-24
**화면**
- 상단에 서경방송 로고 추가
- 상단 메뉴 막대 고정: 아래 내용만 스크롤 (인쇄할 때는 고정 해제)

**관계사 (서경방송·관계사 공용)**
- 관계사 → 광고 계정 구조로 변경. 관계사 추가·이름 변경·로고 등록, 관계사 아래 광고 계정 추가·소속 변경
- 로그인은 공용이고 자료만 관계사·계정별로 구분 (관계사·계정 삭제는 관리자만)
- 검색광고 보고서 표지에 관계사 이름과 로고 표시
- 기존 광고주는 같은 이름의 관계사 아래로 자동으로 옮겨짐 (DB 자동 변경, 따로 할 일 없음)

**원천자료 관리 (메뉴 이름 변경: 원천자료 엑셀작성 → 원천자료 관리)**
- ① 업로드: 네이버 CSV·엑셀을 DB에 저장. 이번 달 6종 + 이전 자료('월별' CSV, 누적 보고서 엑셀)
- ② DB 조회: 계정·캠페인·광고그룹·매체·키워드·검색어별, 기간·검색어·정렬, 합계 표시
- ③ 엑셀 다운로드: DB → 원천자료 형식 엑셀 (월별요약 + 종류별 시트, 필터·틀 고정). 선택한 계정 또는 관계사 전체 계정
- 결재 양식 갱신: 지난 버전의 '지난달 엑셀 + CSV → 이번 달 양식 엑셀' 기능을 탭으로 유지 (예전 주소 /builder 는 이 탭으로 이동)

**검색광고 보고서**
- 업로드 기능을 원천자료 관리로 옮기고, DB에 저장된 자료로만 보고서를 만듦
- 관계사·계정 선택 → 월 목록 → 보고서

변경 파일: `app/components/NavBar.tsx`, `app/globals.css`, `public/seokyung-logo.jpg`(새 파일), `app/data/page.tsx`(새 파일), `app/components/data/`(새 폴더: `DataHome.tsx`, `UploadTab.tsx`, `ViewTab.tsx`, `ExportTab.tsx`), `app/components/ads/directory.tsx`(새 파일), `app/components/ads/AdsHome.tsx`, `app/components/ads/AdReportView.tsx`, `app/components/builder/BuilderHome.tsx`, `app/builder/page.tsx`, `app/components/events/EventReportView.tsx`, `app/components/AdminPanel.tsx`, `app/api/ads/companies/`(새 폴더), `app/api/ads/data/route.ts`(새 파일), `app/api/ads/accounts/route.ts`, `app/api/ads/accounts/[id]/route.ts`, `lib/ads/columns.ts`(새 파일), `lib/ads/report.ts`, `lib/ads/types.ts`, `lib/ads/schema-sql.ts`, `db/schema-ads.sql`, `package.json`, `README.md`, `CHANGELOG.md`

## v1.6.1 — 2026-11-24
- 네이버 검색광고 연결 실패 안내 개선: 인증 실패(401·403) 때 원인을 한국어로 안내하고, 오류 문구에 나오던 키 원문은 앞뒤 4자리만 표시
- 관리자 설정: 네이버 고객 ID에 숫자가 아닌 값(로그인 아이디 등)을 넣으면 저장 전에 알려 줌

변경 파일: `lib/naver.ts`, `lib/settings.ts`, `app/api/admin/settings/route.ts`, `package.json`, `CHANGELOG.md`

## v1.6.0 — 2026-11-18
**새 메뉴: 원천자료 엑셀작성 (키워드 분석과 검색광고 보고서 사이)**
- 지난달 보고서 엑셀 + 이번 달 네이버 CSV 6종 → 이번 달 보고서 엑셀 내려받기 (결재 첨부용)
- 보고서·1)~8) 시트 자동 갱신: 표지 전월/당월, 월 행 입력·삽입, 증감 행, 당월 강조 서식 이동, 5) 시트 교체·이름 변경, 6)·8) 이어 붙이기(필터 적용), 피벗 원본 확장·열 때 새로 고침
- 차트·피벗·슬라이서·메모·서식 보존 (xlsx 안의 XML을 직접 편집)
- 차트 데이터 범위를 월 표 끝까지 맞춤 (기존 파일에서 클릭수·평균클릭비용 계열이 2026년 08월에서 멈춰 있던 것 포함)
- 새해 1월: 1)·2) 시트에 12개월 행 자동 추가
- 입력란: 세금계산서, 비고, 그룹별 하루예산·지역타겟(지난달 값 채움), 8) 특이사항
- 검사: 6개 파일 누락·기간 불일치·계정 불일치·엑셀 월과 CSV 월 차이, 계정 총비용과 캠페인 합계 비교, 새 광고그룹 경고
- "검색광고 보고서에도 저장" 버튼: 이번 달 CSV와 입력값을 웹 보고서 DB에 바로 저장

**검색광고 보고서: 보고서 엑셀 전체 업로드**
- 누적 엑셀을 올리면 캠페인·광고그룹·매체·키워드·검색어와 세금계산서·쿠폰·비고·그룹 설정을 과거 달까지 한 번에 저장
- 10월 엑셀로 확인: 2024.05~2026.10 (30개월), 10월 합계가 CSV와 일치

변경 파일: `lib/xlsx/`(새 폴더: `refs.ts`, `sheet.ts`, `workbook.ts`, `naverCsv.ts`, `monthly.ts`, `importWorkbook.ts`), `app/builder/page.tsx`(새 파일), `app/components/builder/BuilderHome.tsx`(새 파일), `app/components/NavBar.tsx`, `app/components/ads/AdsHome.tsx`, `app/api/ads/notes/route.ts`, `app/globals.css`, `package.json`(jszip 추가), `README.md`, `CHANGELOG.md`

## v1.5.0 — 2026-11-18
**지역 행사 정보: 전국으로 확대 (시·도 → 시·군·구 선택)**
- 수집 조건에서 시·도(17곳)를 먼저 고르고, 그 안의 시·군·구를 선택 (2026년 행정구역 기준, 인천 제물포구·영종구·검단구 반영)
- 관리자 설정: 기본 시·도, 기본 선택 지역 (화면의 '기본 지역' 버튼)
- TourAPI: 선택 시·도의 법정동 코드로 조회 (강원·전북은 특별자치도 새 코드·옛 코드 모두), 없으면 전국 조회 후 주소로 거름
- 지역 판별 정확도: 주소를 띄어쓰기 단위로 비교 (달서구↔서구, 강동구↔동구 혼동 방지), 경기 광주시↔광주광역시, 경남 고성↔강원 고성 구분, 옛 주소 표기(전라북도, 인천 중구 등) 인식
- 뉴스: 자치구는 "부산 중구 축제"처럼 시·도 이름을 붙여 검색하고, 기사에 시·도와 구 이름이 함께 있어야 채택
- 지자체 웹 검색: 기본으로 전국 정부·지자체 사이트(go.kr) 전체를 검색. 문화재단 등은 '추가 검색 사이트'에 "지역:도메인"으로 추가
- 뉴스 검색 조합(지역×검색어) 160개 제한 안내
- 기존 보고서(서부경남)는 그대로 열림

변경 파일: `lib/events/regions.ts`(새 파일), `lib/events/sources.ts`, `lib/events/types.ts`, `lib/events/summarize.ts`, `lib/settings.ts`, `app/api/events/route.ts`, `app/api/events/[id]/step/route.ts`, `app/api/admin/test/route.ts`, `app/events/page.tsx`, `app/components/events/EventsHome.tsx`, `app/components/events/EventReportView.tsx`, `app/components/AdminPanel.tsx`, `package.json`, `README.md`, `CHANGELOG.md`

## v1.4.2 — 2026-11-18
- 문화축제 표준데이터 0건 문제 수정: 이 API는 응답을 `response`로 감싸지 않고 `header`/`body`를 바로 보내는데, `response` 안에서만 찾아 빈 결과로 판단하던 문제. 두 형식 모두 읽도록 변경 (TourAPI도 동일하게 보강)

변경 파일: `lib/events/sources.ts`, `package.json`, `CHANGELOG.md`

## v1.4.1 — 2026-11-18
**지자체 페이지 '접속하지 못했습니다' · 표준데이터 0건 대응**
- 서버 실행 지역을 서울(icn1)로 지정 (`vercel.json`) — 국내 공공기관 사이트의 해외 접속 차단 대응
- 페이지 접속 시 일반 브라우저와 같은 헤더 사용 — 공공기관 보안 장비의 프로그램 접속 차단 대응
- 보안 인증서 오류가 나는 공공기관 사이트는 http로 한 번 더 시도
- 접속 실패 시 원인 코드 표시 (예: ECONNRESET, 응답 시간 초과, HTTP 403 접속 차단, 인증서 오류)
- 문화축제 표준데이터: 0건이면 100건 단위로 다시 조회, 결과 코드·응답 앞부분을 진단에 표시

변경 파일: `vercel.json`(새 파일), `lib/site.ts`, `lib/events/sources.ts`, `package.json`, `CHANGELOG.md`

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
