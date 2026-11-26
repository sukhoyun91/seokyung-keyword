'use client';
import { useEffect, useState } from 'react';

interface UserRow {
  id: number; username: string; name: string; role: 'admin' | 'user'; active: boolean;
  created_at: string; last_login_at: string | null; today_count: number;
}
interface SettingRow { key: string; label: string; secret: boolean; value: string; masked: string; isSet: boolean }

async function api(url: string, method = 'GET', body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `오류 (${res.status})`);
  return j;
}

const GROUPS: { title: string; desc?: string; keys: string[]; test?: 'claude' | 'naver' | 'hub' | 'tour' | 'gov' | 'instagram' }[] = [
  {
    title: 'Claude API (키워드 생성)',
    desc: 'console.anthropic.com 에서 발급한 API 키. 회사 결제 계정으로 발급하세요.',
    keys: ['anthropic_api_key', 'claude_model'],
    test: 'claude',
  },
  {
    title: '네이버 검색광고 API (검색량 조회)',
    desc: '네이버 검색광고(searchad.naver.com) → 도구 → API 사용 관리에서 발급. 네이버 비밀번호는 저장하지 않습니다.',
    keys: ['naver_account_label', 'naver_customer_id', 'naver_access_license', 'naver_secret_key'],
    test: 'naver',
  },
  {
    title: '네이버 검색 API — API HUB (노출 순위 · 행사 뉴스 수집)',
    desc: '키워드 분석의 서경방송 노출 순위와 지역 행사 정보의 뉴스 수집에 함께 씁니다. 네이버 클라우드 플랫폼 콘솔 → NAVER API HUB → Application 등록(블로그·웹문서·카페 검색 선택) → 인증 정보. 주소 목록 예: iscs.co.kr, blog.naver.com/블로그아이디',
    keys: ['naver_hub_client_id', 'naver_hub_client_secret', 'exposure_targets', 'exposure_areas'],
    test: 'hub',
  },
  {
    title: '지역 행사 정보 수집',
    desc: 'TourAPI: 공공데이터포털(data.go.kr)에서 "한국관광공사_국문 관광정보 서비스_GW" 활용 신청 → 일반 인증키(Decoding). 지자체 웹사이트는 AI 웹 검색이 전국 정부·지자체 사이트(go.kr) 안에서 찾습니다. 문화재단·문화예술회관처럼 go.kr이 아닌 사이트는 "진주시:도메인" 형식으로 추가하세요 (한 지역 여러 줄 가능, 시·도 이름이나 "공통"도 가능).',
    keys: ['tour_api_key', 'event_default_sido', 'event_default_regions', 'gov_domains', 'event_web_search_max'],
    test: 'tour',
  },
  {
    title: '지자체 인스타그램 (Meta Instagram API)',
    desc: '서경방송 인스타그램 비즈니스 계정(페이스북 페이지 연결)의 토큰으로 지자체 공식 계정(비즈니스 계정)의 공개 게시물을 읽습니다. 인스타그램 비밀번호는 저장하지 않습니다. 토큰 발급 방법은 안내서를 보세요. 토큰을 넣고 저장 → 연결 테스트를 누르면 계정 ID를 찾아 저장하고 만료일을 알려 줍니다.',
    keys: ['ig_access_token', 'ig_user_id', 'ig_accounts'],
    test: 'instagram',
  },
  { title: 'AI 분석 기준', keys: ['brand_context', 'region_list'] },
  { title: '사용 한도', desc: 'AI 비용 관리용. 관리자 계정은 일일 한도가 적용되지 않습니다.', keys: ['daily_limit', 'max_keywords'] },
];

export default function AdminPanel({ meId }: { meId: number }) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [settings, setSettings] = useState<SettingRow[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testMsg, setTestMsg] = useState<Record<string, { ok: boolean; message: string } | 'busy'>>({});
  const [nu, setNu] = useState({ username: '', name: '', password: '', role: 'user' });

  async function load() {
    try {
      const [u, s] = await Promise.all([api('/api/admin/users'), api('/api/admin/settings')]);
      setUsers(u.users);
      setSettings(s.settings);
      setDraft(Object.fromEntries(s.settings.map((x: SettingRow) => [x.key, x.secret ? '' : x.value])));
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    }
  }
  useEffect(() => { load(); }, []);

  function flash(ok: boolean, text: string) {
    setMsg({ ok, text });
    setTimeout(() => setMsg(null), 4000);
  }

  async function saveGroup(keys: string[]) {
    try {
      const values = Object.fromEntries(keys.map((k) => [k, draft[k] ?? '']));
      const j = await api('/api/admin/settings', 'PUT', { values });
      setSettings(j.settings);
      setDraft((d) => ({ ...d, ...Object.fromEntries(keys.filter((k) => settings.find((s) => s.key === k)?.secret).map((k) => [k, ''])) }));
      flash(true, '저장했습니다.');
    } catch (e: any) {
      flash(false, e.message);
    }
  }

  async function clearSecret(key: string) {
    if (!confirm('저장된 값을 삭제할까요?')) return;
    const j = await api('/api/admin/settings', 'PUT', { clear: [key] });
    setSettings(j.settings);
  }

  async function test(target: 'claude' | 'naver' | 'hub' | 'tour' | 'gov' | 'instagram') {
    setTestMsg((t) => ({ ...t, [target]: 'busy' }));
    try {
      const j = await api('/api/admin/test', 'POST', { target });
      setTestMsg((t) => ({ ...t, [target]: j }));
    } catch (e: any) {
      setTestMsg((t) => ({ ...t, [target]: { ok: false, message: e.message } }));
    }
  }

  async function addUser() {
    try {
      await api('/api/admin/users', 'POST', nu);
      setNu({ username: '', name: '', password: '', role: 'user' });
      flash(true, '계정을 만들었습니다.');
      load();
    } catch (e: any) {
      flash(false, e.message);
    }
  }

  async function patchUser(id: number, body: Record<string, unknown>, okText: string) {
    try {
      await api(`/api/admin/users/${id}`, 'PATCH', body);
      flash(true, okText);
      load();
    } catch (e: any) {
      flash(false, e.message);
    }
  }

  async function resetPw(u: UserRow) {
    const pw = prompt(`${u.name}(${u.username})의 새 비밀번호 (8자 이상)`);
    if (pw) patchUser(u.id, { password: pw }, '비밀번호를 초기화했습니다. 새 비밀번호를 본인에게 직접 전달하세요.');
  }

  async function removeUser(u: UserRow) {
    if (!confirm(`${u.name}(${u.username}) 계정을 삭제할까요? 되돌릴 수 없습니다.`)) return;
    try {
      await api(`/api/admin/users/${u.id}`, 'DELETE');
      flash(true, '삭제했습니다.');
      load();
    } catch (e: any) {
      flash(false, e.message);
    }
  }

  const byKey = (k: string) => settings.find((s) => s.key === k);
  const fmt = (d: string | null) => (d ? new Date(d).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '-');

  return (
    <div className="container">
      <h1>관리자</h1>
      {msg && <div className={`msg ${msg.ok ? 'ok' : 'err'}`} style={{ position: 'sticky', top: 68, zIndex: 5 }}>{msg.text}</div>}

      {/* ── 계정 관리 */}
      <div className="panel">
        <h2>사용자 계정</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>아이디</th><th>이름</th><th>권한</th><th>상태</th><th className="num">오늘 사용</th><th>최근 로그인</th><th></th></tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={u.active ? '' : 'zero'}>
                  <td>{u.username}</td>
                  <td>{u.name}</td>
                  <td>
                    <select
                      value={u.role}
                      disabled={u.id === meId}
                      onChange={(e) => patchUser(u.id, { role: e.target.value }, '권한을 변경했습니다.')}
                      style={{ width: 'auto', padding: '4px 8px' }}
                    >
                      <option value="user">사용자</option>
                      <option value="admin">관리자</option>
                    </select>
                  </td>
                  <td>{u.active ? <span className="badge low">사용</span> : <span className="badge high">중지</span>}</td>
                  <td className="num">{u.today_count}</td>
                  <td>{fmt(u.last_login_at)}</td>
                  <td>
                    <div className="btn-row" style={{ flexWrap: 'nowrap' }}>
                      <button onClick={() => resetPw(u)}>비밀번호 초기화</button>
                      {u.id !== meId && (
                        <button onClick={() => patchUser(u.id, { active: !u.active }, u.active ? '사용 중지했습니다.' : '다시 사용하도록 했습니다.')}>
                          {u.active ? '중지' : '재사용'}
                        </button>
                      )}
                      {u.id !== meId && <button className="danger" onClick={() => removeUser(u)}>삭제</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 style={{ marginTop: 18 }}>새 계정 만들기</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, alignItems: 'end' }}>
          <div><label>아이디</label><input type="text" value={nu.username} onChange={(e) => setNu({ ...nu, username: e.target.value })} placeholder="영문·숫자" /></div>
          <div><label>이름</label><input type="text" value={nu.name} onChange={(e) => setNu({ ...nu, name: e.target.value })} placeholder="홍길동" /></div>
          <div><label>초기 비밀번호</label><input type="text" value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} placeholder="8자 이상" /></div>
          <div>
            <label>권한</label>
            <select value={nu.role} onChange={(e) => setNu({ ...nu, role: e.target.value })}>
              <option value="user">사용자</option>
              <option value="admin">관리자</option>
            </select>
          </div>
          <button className="primary" onClick={addUser} disabled={!nu.username || !nu.name || nu.password.length < 8}>추가</button>
        </div>
      </div>

      {/* ── API·설정 */}
      {GROUPS.map((g) => (
        <div className="panel" key={g.title}>
          <h2>{g.title}</h2>
          {g.desc && <div className="hint">{g.desc}</div>}
          {g.keys.map((k) => {
            const s = byKey(k);
            if (!s) return null;
            const long = k === 'brand_context' || k === 'gov_domains' || k === 'ig_accounts';
            return (
              <div key={k}>
                <label>
                  {s.label}
                  {s.secret && (s.isSet ? <span className="hint"> · 저장됨 {s.masked}</span> : <span className="hint"> · 미설정</span>)}
                </label>
                <div className={s.secret && s.isSet ? 'setting-row' : ''}>
                  {long ? (
                    <textarea value={draft[k] ?? ''} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
                  ) : (
                    <input
                      type={s.secret ? 'password' : 'text'}
                      autoComplete="off"
                      placeholder={s.secret ? (s.isSet ? '변경할 때만 입력' : '입력') : ''}
                      value={draft[k] ?? ''}
                      onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
                    />
                  )}
                  {s.secret && s.isSet && <button className="danger" onClick={() => clearSecret(k)}>삭제</button>}
                </div>
              </div>
            );
          })}
          <div className="btn-row" style={{ marginTop: 14, alignItems: 'center' }}>
            <button className="primary" onClick={() => saveGroup(g.keys)}>저장</button>
            {g.test && (
              <button onClick={() => test(g.test!)} disabled={testMsg[g.test] === 'busy'}>
                {testMsg[g.test] === 'busy' ? '확인 중…' : '연결 테스트'}
              </button>
            )}
          </div>
          {g.keys.includes('gov_domains') && (
            <div className="btn-row" style={{ marginTop: 8, alignItems: 'center' }}>
              <button onClick={() => test('gov')} disabled={testMsg.gov === 'busy'}>{testMsg.gov === 'busy' ? '검색 중… (최대 1분)' : '지자체 검색 테스트'}</button>
              <span className="hint">지역 목록 첫 번째 지역의 다음 달 행사를 웹 검색 3회로 찾아 과정을 보여 줍니다 (약 50원).</span>
            </div>
          )}
          {g.keys.includes('gov_domains') && testMsg.gov && testMsg.gov !== 'busy' && (
            <div className={`msg ${(testMsg.gov as any).ok ? 'ok' : 'err'}`}>{(testMsg.gov as any).message}</div>
          )}
          {g.test && testMsg[g.test] && testMsg[g.test] !== 'busy' && (
            <div className={`msg ${(testMsg[g.test] as any).ok ? 'ok' : 'err'}`}>{(testMsg[g.test] as any).message}</div>
          )}
        </div>
      ))}
    </div>
  );
}
