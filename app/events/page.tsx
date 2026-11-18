import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import NavBar from '../components/NavBar';
import EventsHome from '../components/events/EventsHome';

export const dynamic = 'force-dynamic';

export default async function EventsPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  const s = await getSettings();
  return (
    <>
      <NavBar user={user} active="events" />
      <EventsHome
        regions={s.region_list.split(',').map((x) => x.trim()).filter(Boolean)}
        ready={{
          tour: Boolean(s.tour_api_key),
          news: Boolean(s.naver_hub_client_id && s.naver_hub_client_secret),
          gov: Boolean(s.anthropic_api_key && s.gov_domains.trim()),
          ai: Boolean(s.anthropic_api_key),
        }}
        isAdmin={user.role === 'admin'}
        meId={user.id}
      />
    </>
  );
}
