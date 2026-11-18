import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import NavBar from '../../components/NavBar';
import AdReportView from '../../components/ads/AdReportView';

export const dynamic = 'force-dynamic';

export default async function AdReportPage({ searchParams }: { searchParams: Promise<{ account?: string; month?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  const sp = await searchParams;
  return (
    <>
      <NavBar user={user} active="ads" />
      <AdReportView accountId={Number(sp.account)} month={String(sp.month || '')} userName={user.name} />
    </>
  );
}
