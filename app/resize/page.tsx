import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import NavBar from '../components/NavBar';
import ResizeHome from '../components/resize/ResizeHome';

export const dynamic = 'force-dynamic';

export default async function ResizePage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  return (
    <>
      <NavBar user={user} active="resize" />
      <ResizeHome />
    </>
  );
}
