import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import NavBar from '../components/NavBar';
import AdminPanel from '../components/AdminPanel';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (user.role !== 'admin') redirect('/');
  return (
    <>
      <NavBar user={user} active="admin" />
      <AdminPanel meId={user.id} />
    </>
  );
}
