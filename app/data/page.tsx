import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import NavBar from '../components/NavBar';
import DataHome from '../components/data/DataHome';

export const dynamic = 'force-dynamic';

export default async function DataPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  const sp = await searchParams;
  return (
    <>
      <NavBar user={user} active="data" />
      <DataHome isAdmin={user.role === 'admin'} initialTab={sp.tab} />
    </>
  );
}
