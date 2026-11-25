'use client';
import { useState } from 'react';
import type { SessionUser } from '@/lib/auth';
import { APP_VERSION, BUILD_ID } from '@/lib/version';

export default function NavBar({ user, active }: { user: SessionUser; active: 'home' | 'admin' | 'resize' | 'data' | 'ads' | 'events' }) {
  const [pwOpen, setPwOpen] = useState(false);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  return (
    <>
      <nav className="nav no-print">
        <div className="nav-inner">
          <a href="/" className="logo" title="서경방송 마케팅 도구">
            <img className="logo-img" src="/seokyung-logo-white.png" alt="서경방송" />
            <small>마케팅 도구</small>
            <small className="ver" title={BUILD_ID ? `배포 ${BUILD_ID}` : ''}>v{APP_VERSION}</small>
          </a>
          <a href="/" className={active === 'home' ? 'active' : ''}>키워드 분석</a>
          <a href="/resize" className={active === 'resize' ? 'active' : ''}>이미지 리사이징</a>
          <a href="/data" className={active === 'data' ? 'active' : ''}>원천자료 관리</a>
          <a href="/ads" className={active === 'ads' ? 'active' : ''}>검색광고 보고서</a>
          <a href="/events" className={active === 'events' ? 'active' : ''}>지역 행사 정보</a>
          {user.role === 'admin' && <a href="/admin" className={active === 'admin' ? 'active' : ''}>관리자</a>}
          <span className="spacer" />
          <span className="who">{user.name}{user.role === 'admin' ? ' (관리자)' : ''}</span>
          <button onClick={() => setPwOpen((v) => !v)}>비밀번호</button>
          <button onClick={logout}>로그아웃</button>
        </div>
      </nav>
      {pwOpen && <PasswordBox onClose={() => setPwOpen(false)} />}
    </>
  );
}

function PasswordBox({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    const res = await fetch('/api/me/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current, next }),
    });
    const j = await res.json();
    setMsg(res.ok ? { ok: true, text: '비밀번호를 변경했습니다.' } : { ok: false, text: j.error });
    if (res.ok) { setCurrent(''); setNext(''); }
  }

  return (
    <div className="container no-print" style={{ paddingBottom: 0 }}>
      <div className="panel" style={{ maxWidth: 420, marginLeft: 'auto' }}>
        <h3>비밀번호 변경</h3>
        <label>현재 비밀번호</label>
        <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        <label>새 비밀번호 <span className="hint">(8자 이상)</span></label>
        <input type="password" value={next} onChange={(e) => setNext(e.target.value)} />
        {msg && <div className={`msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>}
        <div className="btn-row" style={{ marginTop: 12 }}>
          <button className="primary" onClick={save} disabled={!current || next.length < 8}>변경</button>
          <button onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}
