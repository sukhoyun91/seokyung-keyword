'use client';
import { useMemo, useState } from 'react';
import { LEVELS, LEVEL_LABEL } from '@/lib/ads/parse';
import { monthLabel } from '@/lib/ads/types';
import { n0 } from './fmt';
import { DirectoryPanel, useDirectory } from './directory';

/** 검색광고 보고서: DB 에 저장된 자료로 월 보고서를 엽니다 (업로드는 '원천자료 관리') */
export default function AdsHome({ isAdmin }: { isAdmin: boolean }) {
  const dir = useDirectory();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const sel = dir.account;

  const months = useMemo(() => (sel ? [...new Set(sel.coverage.map((c) => c.month))].sort().reverse() : []), [sel]);
  const has = (m: string, l: string) => sel?.coverage.find((c) => c.month === m && c.level === l);
  const ready = (m: string) => has(m, 'account') || has(m, 'campaign');

  return (
    <div className="container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <h1>검색광고 월간 보고서</h1>
        <span className="hint">DB에 저장된 원천자료로 보고서를 만듭니다. 자료 올리기·수정은 <a href="/data">원천자료 관리</a>에서 합니다.</span>
      </div>
      {msg && <div className={`msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>}

      <div className="ads-layout">
        <DirectoryPanel dir={dir} manage={false} isAdmin={isAdmin} onMsg={(ok, text) => setMsg({ ok, text })} />

        <div>
          {!sel ? (
            <div className="panel"><div className="empty">왼쪽에서 관계사와 광고 계정을 선택하세요.</div></div>
          ) : (
            <div className="panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {dir.company?.logo && <img src={dir.company.logo} alt="" style={{ maxHeight: 28 }} />}
                  {dir.company?.name} › {sel.name} <span className="hint">계정 {sel.customer_id}</span>
                </h2>
                {months[0] && (
                  <a href={`/ads/report?account=${sel.id}&month=${months.find(ready) ?? months[0]}`}>
                    <button className="primary">최근 보고서 열기 ({monthLabel(months.find(ready) ?? months[0])})</button>
                  </a>
                )}
              </div>
              {months.length === 0 ? (
                <div className="empty" style={{ padding: 30 }}>
                  이 계정에 저장된 자료가 없습니다. <a href="/data">원천자료 관리</a>에서 네이버 보고서 파일을 올려 주세요.
                </div>
              ) : (
                <div className="table-wrap" style={{ marginTop: 10 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>월</th>
                        {LEVELS.map((l) => <th key={l} className="num">{LEVEL_LABEL[l]}</th>)}
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {months.map((m) => (
                        <tr key={m}>
                          <td><b>{monthLabel(m)}</b></td>
                          {LEVELS.map((l) => {
                            const c = has(m, l);
                            return <td key={l} className="num">{c ? <>✓ <span className="hint">{n0(c.rows)}</span></> : <span className="muted">-</span>}</td>;
                          })}
                          <td style={{ textAlign: 'right' }}>
                            {ready(m) ? (
                              <a href={`/ads/report?account=${sel.id}&month=${m}`}><button className="primary">보고서</button></a>
                            ) : (
                              <span className="hint" title="계정 또는 캠페인 보고서가 있어야 요약이 나옵니다">요약 자료 없음</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="hint" style={{ marginTop: 10 }}>
                보고서 화면에서 세금계산서·쿠폰·비고·하루예산을 입력하고, AI로 담당자 의견 초안을 만든 뒤 인쇄(PDF)합니다. 표지에는 관계사 이름과 로고가 들어갑니다.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
