import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import NavBar from '../components/NavBar';
import BuilderHome from '../components/builder/BuilderHome';

export const dynamic = 'force-dynamic';

export default async function BuilderPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  return (
    <>
      <NavBar user={user} active="builder" />
      <BuilderHome />
    </>
  );
}
