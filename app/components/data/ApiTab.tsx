'use client';
import { useMemo, useState } from 'react';
import { monthLabel } from '@/lib/ads/types';
import { api, n0 } from '../ads/fmt';
import type { Directory } from '../ads/directory';

type Tot = { rows: number; imp: number; clk: number; cost: number };
interface Result {
  month: string;
  since: string;
  until: string;
  counts: { campaigns: number; adgroups: number; keywords: number; calls: number };
  warnings: string[];
  budgets: { ad_group: string; daily_budget: number }[];
  compare: { levels: { level: string; api: Tot; db: Tot | null }[]; campaignTypes: { key: string; api: Tot; db: Tot | null }[]; adgroups: { key: string; api: Tot; db: Tot | null }[] };
  saved: boolean;
  keySource: 'account' | 'admin';
}

const LV: Record<string, string> = { account: '계정', campaign: '캠페인', adgroup: '광고그룹', keyword: '키워드' };

function lastMonths(n: number) {
  const kst = new Date(Date.now() + 9 * 3600_000);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

function Diff({ a, b }: { a: number; b: number | undefined }) {
  if (b == null) return <span className="muted">-</span>;
  const d = a - b;
  if (d === 0) return <span style={{ color: 'var(--ok, #1a7f37)' }}>일치</span>;
  const pct = b ? (d / b) * 100 : 100;
  return <span style={{ color: Math.abs(pct) < 1 ? 'var(--warn)' : 'var(--err)' }}>{d > 0 ? '+' : ''}{n0(d)} ({pct.toFixed(1)}%)</span>;
}

function CmpTable({ title, rows }: { title: string; rows: { key: string; api: Tot; db: Tot | null }[] }) {
  return (
    <div className="table-wrap" style={{ marginTop: 10 }}>
      <table>
        <thead>
          <tr><th>{title}</th><th className="num">API 노출</th><th className="num">DB 노출</th><th className="num">차이</th><th className="num">API 클릭</th><th className="num">DB 클릭</th><th className="num">API 비용</th><th className="num">DB 비용</th><th className="num">비용 차이</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td><b>{r.key || '-'}</b>{r.api.rows > 1 && <span className="hint"> ({r.api.rows}줄)</span>}</td>
              <td className="num">{n0(r.api.imp)}</td>
              <td className="num">{r.db ? n0(r.db.imp) : '-'}</td>
              <td className="num"><Diff a={r.api.imp} b={r.db?.imp} /></td>
              <td className="num">{n0(r.api.clk)}</td>
              <td className="num">{r.db ? n0(r.db.clk) : '-'}</td>
              <td className="num">{n0(r.api.cost)}</td>
              <td className="num">{r.db ? n0(r.db.cost) : '-'}</td>
              <td className="num"><Diff a={r.api.cost} b={r.db?.cost} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 네이버 API 가져오기 (계정·캠페인·광고그룹·키워드). 매체·검색어는 파일 업로드 */
export default function ApiTab({ dir, onMsg }: { dir: Directory; onMsg: (ok: boolean, t: string) => void }) {
  const sel = dir.account;
  const months = useMemo(() => lastMonths(24), []);
  const [month, setMonth] = useState(months[1]); // 기본: 지난달
  const [busy, setBusy] = useState('');
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState('');

  async function run(save: boolean) {
    if (!sel) return;
    if (save && sel.coverage.some((c) => c.month === month && ['account', 'campaign', 'adgroup', 'keyword'].includes(c.level)) &&
      !confirm(`${monthLabel(month)}의 계정·캠페인·광고그룹·키워드 자료를 API 자료로 바꿉니다. (매체·검색어는 그대로) 계속할까요?`)) return;
    setBusy(save ? '네이버에서 받아 DB에 저장하는 중… (10~30초)' : '네이버에서 받아 비교하는 중… (10~30초)');
    setErr('');
    try {
      const j = await api<Result>('/api/ads/collect', 'POST', { accountId: sel.id, month, save });
      setRes(j);
      if (save) {
        onMsg(true, `${monthLabel(month)} API 자료를 저장했습니다.`);
        await dir.reload({ accountId: sel.id });
      }
    } catch (e: any) {
      setErr(e.message);
    }
    setBusy('');
  }

  if (!sel) return <div className="panel"><div className="empty">왼쪽에서 광고 계정을 선택하세요.</div></div>;
  const cov = (l: string) => sel.coverage.find((c) => c.month === month && c.level === l);

  return (
    <div className="panel">
      <h2>네이버 API 가져오기 <span className="hint">{dir.company?.name} › {sel.name} ({sel.customer_id})</span></h2>
      <div className="api-split">
        <div><b>API로 가져오기</b> <span className="hint">계정 · 캠페인 · 광고그룹 · 키워드 (+ 하루예산)</span></div>
        <div><b>파일 업로드로</b> <span className="hint">매체(검색/콘텐츠) · 검색어 — '① 파일 업로드' 탭</span></div>
      </div>

      {!sel.api ? (
        <div className="msg err" style={{ marginTop: 10 }}>
          이 계정에 네이버 API 키가 없습니다. 왼쪽 <b>계정: {sel.name}</b> 상자에서 <b>키 등록</b>을 눌러 액세스 라이선스·비밀키를 넣으세요.
          (관리자 설정의 네이버 고객 ID가 이 계정 번호와 같으면 그 키를 자동으로 씁니다.)
        </div>
      ) : (
        <>
          <div className="filters" style={{ marginTop: 12 }}>
            <label>월</label>
            <select value={month} onChange={(e) => { setMonth(e.target.value); setRes(null); }}>
              {months.map((m) => <option key={m} value={m}>{monthLabel(m)}{m === months[0] ? ' (이번 달, 어제까지)' : ''}</option>)}
            </select>
            <button onClick={() => run(false)} disabled={!!busy}>미리 받아 DB와 비교</button>
            <button className="primary" onClick={() => run(true)} disabled={!!busy}>가져와서 DB에 저장</button>
          </div>
          <div className="hint" style={{ marginTop: 6 }}>
            지금 DB의 {monthLabel(month)}:{' '}
            {['account', 'campaign', 'adgroup', 'media', 'keyword', 'searchterm'].map((l) => `${({ account: '계정', campaign: '캠페인', adgroup: '광고그룹', media: '매체', keyword: '키워드', searchterm: '검색어' } as any)[l]} ${cov(l) ? '✓' : '-'}`).join(' · ')}
            <br />처음에는 CSV로 이미 올린 달(예: 10월)을 <b>미리 받아 비교</b>로 숫자가 맞는지 먼저 확인하세요. 네이버 기준 최근 약 2년까지 받을 수 있습니다.
          </div>
        </>
      )}
      {busy && <div className="msg">{busy}</div>}
      {err && <div className="msg err">{err}</div>}

      {res && (
        <div style={{ marginTop: 14 }}>
          <div className={`msg ${res.saved ? 'ok' : ''}`}>
            {monthLabel(res.month)} ({res.since} ~ {res.until}) · 캠페인 {res.counts.campaigns} · 광고그룹 {res.counts.adgroups} · 키워드 {n0(res.counts.keywords)}개 · API 호출 {res.counts.calls}회
            {res.saved ? ' → DB에 저장했습니다. (아래 DB 열은 저장 전 값)' : ' → 아직 저장하지 않았습니다.'}
            {res.keySource === 'admin' && <span className="hint"> · 관리자 설정 키 사용</span>}
          </div>
          {res.warnings.map((w) => <div key={w} className="msg warn">{w}</div>)}
          <CmpTable title="자료 종류" rows={res.compare.levels.map((l) => ({ key: LV[l.level], api: l.api, db: l.db }))} />
          <h3 style={{ marginTop: 16 }}>캠페인 유형별</h3>
          <CmpTable title="유형" rows={res.compare.campaignTypes} />
          <h3 style={{ marginTop: 16 }}>광고그룹별</h3>
          <CmpTable title="광고그룹" rows={res.compare.adgroups} />
          {res.budgets.length > 0 && (
            <div className="hint" style={{ marginTop: 8 }}>
              하루예산 (API): {res.budgets.map((b) => `${b.ad_group} ${n0(b.daily_budget)}원`).join(' · ')}{res.saved ? ' — 보고서 하루예산 칸에도 저장' : ''}
            </div>
          )}
          <p className="hint" style={{ marginTop: 8 }}>
            차이가 생기는 흔한 이유: 그 달에 삭제한 캠페인·광고그룹·키워드는 API 목록에 없어 빠짐(키워드는 '-' 줄로 합산됨), 비용의 부가세 포함 기준 차이, 원 단위 반올림.
          </p>
        </div>
      )}
    </div>
  );
}
