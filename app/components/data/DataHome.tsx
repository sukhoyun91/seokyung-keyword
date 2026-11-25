'use client';
import { useEffect, useState } from 'react';
import { DirectoryPanel, useDirectory } from '../ads/directory';
import UploadTab from './UploadTab';
import ViewTab from './ViewTab';
import ExportTab from './ExportTab';
import ApiTab from './ApiTab';
import BuilderHome from '../builder/BuilderHome';

const TABS = [
  { key: 'upload', label: '① 파일 업로드' },
  { key: 'api', label: '② 네이버 API 가져오기' },
  { key: 'view', label: '③ DB 조회' },
  { key: 'export', label: '④ 엑셀 다운로드' },
  { key: 'template', label: '결재 양식 갱신' },
] as const;
type Tab = (typeof TABS)[number]['key'];

export default function DataHome({ isAdmin, initialTab }: { isAdmin: boolean; initialTab?: string }) {
  const dir = useDirectory();
  const [tab, setTab] = useState<Tab>(TABS.some((t) => t.key === initialTab) ? (initialTab as Tab) : 'upload');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [prefillCid, setPrefillCid] = useState<string>();

  useEffect(() => {
    const u = new URL(window.location.href);
    u.searchParams.set('tab', tab);
    window.history.replaceState(null, '', u.toString());
  }, [tab]);

  const flash = (ok: boolean, text: string) => {
    setMsg({ ok, text });
    if (ok) setTimeout(() => setMsg(null), 5000);
  };

  return (
    <div className="container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <h1>원천자료 관리</h1>
        <span className="hint">파일 업로드 + 네이버 API 가져오기 → DB 누적 → 조회 · 엑셀 다운로드. 검색광고 보고서는 이 DB 자료로 만들어집니다.</span>
      </div>
      <div className="dtabs no-print">
        {TABS.map((t) => (
          <button key={t.key} className={t.key === tab ? 'on' : ''} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>
      {msg && <div className={`msg ${msg.ok ? 'ok' : 'err'}`} style={{ position: 'sticky', top: 68, zIndex: 5 }}>{msg.text}</div>}

      {tab === 'template' ? (
        <div style={{ marginTop: 12 }}><BuilderHome embedded /></div>
      ) : (
        <div className="ads-layout">
          <DirectoryPanel dir={dir} manage isAdmin={isAdmin} prefillCid={prefillCid} onMsg={flash} />
          <div>
            {tab === 'upload' && <UploadTab dir={dir} isAdmin={isAdmin} onMsg={flash} onUnknownCid={setPrefillCid} />}
            {tab === 'api' && <ApiTab dir={dir} onMsg={flash} />}
            {tab === 'view' && <ViewTab dir={dir} />}
            {tab === 'export' && <ExportTab dir={dir} />}
          </div>
        </div>
      )}
    </div>
  );
}
