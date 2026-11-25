'use client';
/** 관계사 → 광고 계정 목록과 선택 상태 (원천자료 관리·검색광고 보고서 공용) */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './fmt';

export interface Company {
  id: number;
  name: string;
  logo: string;
  memo: string;
}

export interface Account {
  id: number;
  name: string;
  customer_id: string;
  memo: string;
  active: boolean;
  company_id: number | null;
  api: 'account' | 'admin' | null; // 네이버 API 키: 계정별 등록 / 관리자 설정 키 / 없음
  coverage: { level: string; month: string; rows: number }[];
  lastUpload: { uploaded_at: string; name: string } | null;
}

export function useDirectory() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [companyId, setCompanyIdRaw] = useState<number | null>(null);
  const [accountId, setAccountIdRaw] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');

  const reload = useCallback(async (want?: { companyId?: number | null; accountId?: number | null }) => {
    try {
      const [c, a] = await Promise.all([api<{ companies: Company[] }>('/api/ads/companies'), api<{ accounts: Account[] }>('/api/ads/accounts')]);
      setCompanies(c.companies);
      setAccounts(a.accounts);
      let acc = want?.accountId ?? null;
      let com = want?.companyId ?? null;
      if (acc == null && com == null) {
        try {
          acc = Number(localStorage.getItem('ads_account')) || null;
          com = Number(localStorage.getItem('ads_company')) || null;
        } catch {}
      }
      const accObj = a.accounts.find((x) => x.id === acc);
      if (accObj) {
        setAccountIdRaw(accObj.id);
        setCompanyIdRaw(accObj.company_id);
      } else {
        const comObj = c.companies.find((x) => x.id === com) ?? c.companies[0];
        setCompanyIdRaw(comObj?.id ?? null);
        setAccountIdRaw(a.accounts.find((x) => x.company_id === comObj?.id)?.id ?? null);
      }
      setError('');
    } catch (e: any) {
      setError(e.message);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const setCompanyId = (id: number | null) => {
    setCompanyIdRaw(id);
    setAccountIdRaw(accounts.find((a) => a.company_id === id)?.id ?? null);
  };
  const setAccountId = (id: number | null) => {
    setAccountIdRaw(id);
    const a = accounts.find((x) => x.id === id);
    if (a) setCompanyIdRaw(a.company_id);
  };
  useEffect(() => {
    try {
      if (companyId) localStorage.setItem('ads_company', String(companyId));
      if (accountId) localStorage.setItem('ads_account', String(accountId));
    } catch {}
  }, [companyId, accountId]);

  const company = companies.find((c) => c.id === companyId) ?? null;
  const account = accounts.find((a) => a.id === accountId) ?? null;
  const companyAccounts = useMemo(() => accounts.filter((a) => a.company_id === companyId), [accounts, companyId]);
  const orphans = useMemo(() => accounts.filter((a) => !a.company_id || !companies.some((c) => c.id === a.company_id)), [accounts, companies]);
  const byCid = useMemo(() => new Map(accounts.map((a) => [a.customer_id, a])), [accounts]);
  const companyOf = (a: Account | null | undefined) => companies.find((c) => c.id === a?.company_id) ?? null;

  return { companies, accounts, company, account, companyId, accountId, setCompanyId, setAccountId, companyAccounts, orphans, byCid, companyOf, reload, loaded, error };
}

export type Directory = ReturnType<typeof useDirectory>;

/** 로고 이미지를 가로 480 · 세로 120 이하 PNG 로 줄여 data URL 로 */
export async function shrinkLogo(file: File): Promise<string> {
  if (!/^image\//.test(file.type)) throw new Error('이미지 파일(PNG·JPG)을 골라 주세요.');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => bad(new Error('이미지를 읽지 못했습니다.'));
      i.src = url;
    });
    const scale = Math.min(1, 480 / img.width, 120 / img.height);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * scale));
    c.height = Math.max(1, Math.round(img.height * scale));
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * 왼쪽 패널: 관계사 → 광고 계정.
 * manage=true 이면 관계사·계정 추가, 로고 등록, 이름 변경을 함께 보여 줌
 */
export function DirectoryPanel({ dir, manage, isAdmin, prefillCid, onMsg }: { dir: Directory; manage: boolean; isAdmin: boolean; prefillCid?: string; onMsg: (ok: boolean, text: string) => void }) {
  const [newCompany, setNewCompany] = useState('');
  const [showCompanyAdd, setShowCompanyAdd] = useState(false);
  const [na, setNa] = useState({ name: '', customer_id: '' });
  const [showAccAdd, setShowAccAdd] = useState(false);
  const [keyForm, setKeyForm] = useState<{ license: string; secret: string } | null>(null);

  useEffect(() => {
    if (prefillCid) {
      setShowAccAdd(true);
      setNa((n) => ({ ...n, customer_id: prefillCid }));
    }
  }, [prefillCid]);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) onMsg(true, ok);
    } catch (e: any) {
      onMsg(false, e.message);
    }
  };

  const addCompany = () =>
    run(async () => {
      const j = await api<{ id: number }>('/api/ads/companies', 'POST', { name: newCompany });
      setNewCompany('');
      setShowCompanyAdd(false);
      await dir.reload({ companyId: j.id });
    }, '관계사를 등록했습니다.');

  const addAccount = () =>
    run(async () => {
      const j = await api<{ id: number }>('/api/ads/accounts', 'POST', { ...na, company_id: dir.companyId });
      setNa({ name: '', customer_id: '' });
      setShowAccAdd(false);
      await dir.reload({ accountId: j.id });
    }, '광고 계정을 등록했습니다.');

  const c = dir.company;
  const renameCompany = () => {
    if (!c) return;
    const name = prompt('관계사 이름', c.name);
    if (name && name !== c.name) run(async () => { await api(`/api/ads/companies/${c.id}`, 'PATCH', { name }); await dir.reload({ companyId: c.id }); });
  };
  const uploadLogo = (f: File | undefined) => {
    if (!c || !f) return;
    run(async () => {
      const logo = await shrinkLogo(f);
      await api(`/api/ads/companies/${c.id}`, 'PATCH', { logo });
      await dir.reload({ companyId: c.id, accountId: dir.accountId });
    }, '로고를 저장했습니다. 보고서 표지에 표시됩니다.');
  };
  const removeLogo = () => c && run(async () => { await api(`/api/ads/companies/${c.id}`, 'PATCH', { logo: '' }); await dir.reload({ companyId: c.id, accountId: dir.accountId }); });
  const deleteCompany = () => {
    if (!c || !confirm(`관계사 '${c.name}'를 삭제할까요?`)) return;
    run(async () => { await api(`/api/ads/companies/${c.id}`, 'DELETE'); await dir.reload({ companyId: null, accountId: null }); }, '삭제했습니다.');
  };

  const a = dir.account;
  const renameAccount = () => {
    if (!a) return;
    const name = prompt('광고 계정 이름', a.name);
    if (name && name !== a.name) run(async () => { await api(`/api/ads/accounts/${a.id}`, 'PATCH', { name }); await dir.reload({ accountId: a.id }); });
  };
  const moveAccount = (companyId: number) => a && run(async () => { await api(`/api/ads/accounts/${a.id}`, 'PATCH', { company_id: companyId }); await dir.reload({ accountId: a.id }); }, '관계사를 옮겼습니다.');
  const deleteAccount = () => {
    if (!a || !confirm(`${a.name} (${a.customer_id}) 계정과 저장된 자료를 모두 삭제할까요? 되돌릴 수 없습니다.`)) return;
    run(async () => { await api(`/api/ads/accounts/${a.id}`, 'DELETE'); await dir.reload({ companyId: dir.companyId, accountId: null }); }, '삭제했습니다.');
  };

  const saveKey = () =>
    a && keyForm &&
    run(async () => {
      await api(`/api/ads/accounts/${a.id}/api`, 'PUT', keyForm);
      setKeyForm(null);
      await dir.reload({ accountId: a.id });
    }, 'API 키를 암호화해서 저장했습니다. [연결 테스트]로 확인하세요.');
  const clearKey = () =>
    a && confirm('이 계정에 등록한 API 키를 지울까요?') &&
    run(async () => { await api(`/api/ads/accounts/${a.id}/api`, 'PUT', { clear: true }); await dir.reload({ accountId: a.id }); }, '지웠습니다.');
  const testKey = () =>
    a &&
    run(async () => {
      const j = await api<{ count: number; campaigns: string[] }>(`/api/ads/accounts/${a.id}/api`, 'POST');
      onMsg(true, `연결 성공: 캠페인 ${j.count}개 (${j.campaigns.slice(0, 5).join(', ')}${j.count > 5 ? ' …' : ''})`);
    });

  const monthsOf = (x: Account) => new Set(x.coverage.map((v) => v.month)).size;

  return (
    <div className="panel dir-panel">
      <h2>관계사 · 광고 계정</h2>
      {dir.error && <div className="msg err">{dir.error}</div>}
      {dir.loaded && dir.companies.length === 0 && <p className="hint">등록된 관계사가 없습니다. {manage ? '아래에서 먼저 관계사를 추가하세요.' : "'원천자료 관리'에서 관계사와 계정을 등록하세요."}</p>}

      <div className="dir-list">
        {dir.companies.map((co) => {
          const accs = dir.accounts.filter((x) => x.company_id === co.id);
          const open = co.id === dir.companyId;
          return (
            <div key={co.id} className={`dir-co ${open ? 'on' : ''}`}>
              <button className="dir-co-head" onClick={() => dir.setCompanyId(co.id)}>
                {co.logo ? <img src={co.logo} alt="" /> : <span className="dir-co-dot">{co.name.slice(0, 1)}</span>}
                <b>{co.name}</b>
                <span className="hint">계정 {accs.length}</span>
              </button>
              {open && (
                <div className="dir-accs">
                  {accs.length === 0 && <div className="hint" style={{ padding: '4px 8px' }}>광고 계정이 없습니다.</div>}
                  {accs.map((x) => (
                    <button key={x.id} className={`acc ${x.id === dir.accountId ? 'on' : ''}`} onClick={() => dir.setAccountId(x.id)}>
                      <b>{x.name}</b>
                      <span className="hint">계정 {x.customer_id} · {monthsOf(x)}개월</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {dir.orphans.length > 0 && (
          <div className="dir-co">
            <div className="hint" style={{ padding: '6px 2px' }}>관계사 미지정</div>
            {dir.orphans.map((x) => (
              <button key={x.id} className={`acc ${x.id === dir.accountId ? 'on' : ''}`} onClick={() => dir.setAccountId(x.id)}>
                <b>{x.name}</b>
                <span className="hint">계정 {x.customer_id}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {manage && (
        <div className="dir-manage">
          {/* 관계사 */}
          {showCompanyAdd ? (
            <div>
              <label>새 관계사 이름</label>
              <input type="text" value={newCompany} onChange={(e) => setNewCompany(e.target.value)} placeholder="예: 서경방송, 서경엔카" />
              <div className="btn-row" style={{ marginTop: 8 }}>
                <button className="primary" onClick={addCompany} disabled={!newCompany.trim()}>등록</button>
                <button onClick={() => setShowCompanyAdd(false)}>취소</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowCompanyAdd(true)}>+ 관계사 추가</button>
          )}

          {c && (
            <div className="dir-box">
              <div className="dir-box-title">관계사: <b>{c.name}</b></div>
              <div className="btn-row">
                <label className="btn-file">
                  {c.logo ? '로고 바꾸기' : '로고 올리기'}
                  <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { uploadLogo(e.target.files?.[0]); e.target.value = ''; }} />
                </label>
                {c.logo && <button onClick={removeLogo}>로고 삭제</button>}
                <button onClick={renameCompany}>이름 변경</button>
                {isAdmin && <button className="danger" onClick={deleteCompany}>삭제</button>}
              </div>

              {showAccAdd ? (
                <div style={{ marginTop: 10 }}>
                  <label>광고 계정 이름</label>
                  <input type="text" value={na.name} onChange={(e) => setNa({ ...na, name: e.target.value })} placeholder="예: 서경엔카 검색광고" />
                  <label>네이버 계정 번호 <span className="hint">(보고서 파일 첫 줄 끝 숫자)</span></label>
                  <input type="text" value={na.customer_id} onChange={(e) => setNa({ ...na, customer_id: e.target.value.replace(/\D/g, '') })} placeholder="예: 1855304" />
                  <div className="btn-row" style={{ marginTop: 8 }}>
                    <button className="primary" onClick={addAccount} disabled={!na.name.trim() || !na.customer_id}>등록</button>
                    <button onClick={() => setShowAccAdd(false)}>취소</button>
                  </div>
                </div>
              ) : (
                <button style={{ marginTop: 8 }} onClick={() => setShowAccAdd(true)}>+ 이 관계사에 광고 계정 추가</button>
              )}
            </div>
          )}

          {a && (
            <div className="dir-box">
              <div className="dir-box-title">계정: <b>{a.name}</b> <span className="hint">{a.customer_id}</span></div>
              <div className="btn-row">
                <button onClick={renameAccount}>이름 변경</button>
                <span className="hint" style={{ alignSelf: 'center' }}>소속</span>
                <select value={a.company_id ?? ''} onChange={(e) => Number(e.target.value) && moveAccount(Number(e.target.value))} style={{ width: 'auto', padding: '4px 8px' }} title="다른 관계사로 옮기기">
                  <option value="">관계사 지정</option>
                  {dir.companies.map((co) => <option key={co.id} value={co.id}>{co.name}</option>)}
                </select>
                {isAdmin && <button className="danger" onClick={deleteAccount}>삭제</button>}
              </div>
              <div className="dir-api">
                <div className="dir-box-title" style={{ margin: '10px 0 4px' }}>
                  네이버 API 키{' '}
                  {a.api === 'account' ? <span className="badge low">계정 키 등록됨</span> : a.api === 'admin' ? <span className="badge ai">관리자 설정 키 사용</span> : <span className="badge">없음</span>}
                </div>
                {keyForm ? (
                  <>
                    <label>액세스 라이선스</label>
                    <input type="password" autoComplete="off" value={keyForm.license} onChange={(e) => setKeyForm({ ...keyForm, license: e.target.value })} />
                    <label>비밀키</label>
                    <input type="password" autoComplete="off" value={keyForm.secret} onChange={(e) => setKeyForm({ ...keyForm, secret: e.target.value })} />
                    <div className="hint">계정 번호({a.customer_id})가 네이버 API의 CUSTOMER_ID로 쓰입니다. 검색광고 → 도구 → API 사용 관리에서 이 계정으로 발급한 키를 넣으세요. 암호화해서 저장하며 다시 보여 주지 않습니다.</div>
                    <div className="btn-row" style={{ marginTop: 6 }}>
                      <button className="primary" onClick={saveKey} disabled={!keyForm.license.trim() || !keyForm.secret.trim()}>저장</button>
                      <button onClick={() => setKeyForm(null)}>취소</button>
                    </div>
                  </>
                ) : (
                  <div className="btn-row">
                    <button onClick={() => setKeyForm({ license: '', secret: '' })}>{a.api === 'account' ? '키 바꾸기' : '키 등록'}</button>
                    {a.api && <button onClick={testKey}>연결 테스트</button>}
                    {a.api === 'account' && <button onClick={clearKey}>키 지우기</button>}
                  </div>
                )}
                {a.api === 'admin' && !keyForm && <div className="hint">관리자 설정의 네이버 고객 ID가 이 계정 번호와 같아 그 키를 씁니다.</div>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
