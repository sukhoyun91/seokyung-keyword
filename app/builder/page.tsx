import { redirect } from 'next/navigation';

/** 예전 주소 → 원천자료 관리의 '결재 양식 갱신' 탭 */
export default function BuilderPage() {
  redirect('/data?tab=template');
}
