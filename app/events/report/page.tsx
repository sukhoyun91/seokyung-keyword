import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import NavBar from '../../components/NavBar';
import EventReportView from '../../components/events/EventReportView';

export const dynamic = 'force-dynamic';

export default async function EventReportPage({ searchParams }: { searchParams: Promise<{ id?: string; run?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  const sp = await searchParams;
  return (
    <>
      <NavBar user={user} active="events" />
      <EventReportView id={Number(sp.id)} autoRun={sp.run === '1'} />
    </>
  );
}
