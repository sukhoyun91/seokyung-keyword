'use client';
import { useState } from 'react';
import type { SessionUser } from '@/lib/auth';

export default function NavBar({ user, active }: { user: SessionUser; active: 'home' | 'admin' | 'ads' }) {
  const [pwOpen, setPwOpen] = useState(false);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  return (
    <>
      <nav className="nav no-print">
        <div className="nav-inner">
          <span className="logo">서경방송<small>마케팅 도구</small></span>
          <a href="/" className={active === 'home' ? 'active' : ''}>키워드 분석</a>
          <a href="/ads" className={active === 'ads' ? 'active' : ''}>검색광고 보고서</a>
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
