import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import NavBar from '../components/NavBar';
import AdsHome from '../components/ads/AdsHome';

export const dynamic = 'force-dynamic';

export default async function AdsPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  return (
    <>
      <NavBar user={user} active="ads" />
      <AdsHome isAdmin={user.role === 'admin'} />
    </>
  );
}
