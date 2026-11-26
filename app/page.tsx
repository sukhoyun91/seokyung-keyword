import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import NavBar from './components/NavBar';

export const dynamic = 'force-dynamic';

/** 첫 화면: 캐릭터 + 메뉴 바로가기 */
const MENUS = [
  { href: '/keyword', title: '키워드 분석', desc: '이미지를 올리면 AI가 판독해 검색 키워드와 검색량·노출 순위를 정리합니다.', icon: '🔍' },
  { href: '/resize', title: '이미지 리사이징', desc: '한 장의 홍보 이미지를 인스타그램·사이니지 등 여러 크기로 재배치합니다.', icon: '🖼️' },
  { href: '/data', title: '원천자료 관리', desc: '네이버 검색광고 자료를 파일 업로드나 API로 DB에 모으고 조회·다운로드합니다.', icon: '🗂️' },
  { href: '/ads', title: '검색광고 보고서', desc: '월별 결과 보고서를 전월 대비·시각화와 함께 만들고 인쇄·HTML로 저장합니다.', icon: '📊' },
  { href: '/events', title: '지역 행사 정보', desc: '관광공사·지자체·뉴스·인스타그램에서 지역 축제와 행사를 모아 정리합니다.', icon: '🎪' },
];

export default async function Home() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  const hour = Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false }));
  const hello = hour < 11 ? '좋은 아침이에요' : hour < 17 ? '안녕하세요' : '오늘도 수고 많으셨어요';
  const menus = user.role === 'admin' ? [...MENUS, { href: '/admin', title: '관리자', desc: '사용자 계정과 API 키, 수집 설정을 관리합니다.', icon: '⚙️' }] : MENUS;
  return (
    <>
      <NavBar user={user} active="home" />
      <main className="container home">
        <section className="home-hero">
          <div className="home-mascot-wrap">
            <img className="home-mascot" src="/mascot.webp" alt="서경방송 캐릭터" width={260} height={257} />
            <div className="home-shadow" />
          </div>
          <div className="home-text">
            <div className="home-kicker">서경방송 마케팅 도구</div>
            <h1>{hello}, {user.name}님!</h1>
            <p>오늘은 어떤 일을 도와드릴까요? 아래에서 메뉴를 골라 주세요.</p>
          </div>
        </section>
        <section className="home-menus">
          {menus.map((m) => (
            <a key={m.href} href={m.href} className="home-card">
              <span className="home-ic" aria-hidden>{m.icon}</span>
              <b>{m.title}</b>
              <span>{m.desc}</span>
              <span className="home-go">열기 →</span>
            </a>
          ))}
        </section>
      </main>
    </>
  );
}
