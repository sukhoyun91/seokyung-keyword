import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import NavBar from './components/NavBar';
import Analyzer from './components/Analyzer';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  const s = await getSettings();
  return (
    <>
      <NavBar user={user} active="home" />
      <Analyzer
        maxKeywords={Math.max(5, Number(s.max_keywords) || 50)}
        ready={{ claude: Boolean(s.anthropic_api_key), naver: Boolean(s.naver_customer_id && s.naver_access_license && s.naver_secret_key), hub: Boolean(s.naver_hub_client_id && s.naver_hub_client_secret) }}
        isAdmin={user.role === 'admin'}
      />
    </>
  );
}
