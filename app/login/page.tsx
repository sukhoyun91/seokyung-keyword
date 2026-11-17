'use client';
import { useState } from 'react';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || '로그인 실패');
      window.location.href = '/';
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="panel login-card" onSubmit={submit}>
        <h1>서경방송 키워드 분석</h1>
        <p className="muted" style={{ marginTop: 0 }}>마케팅팀 전용 · 계정은 관리자에게 요청하세요.</p>
        <label htmlFor="u">아이디</label>
        <input id="u" type="text" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        <label htmlFor="p">비밀번호</label>
        <input id="p" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <div className="msg err">{error}</div>}
        <button className="primary block" style={{ marginTop: 16 }} disabled={busy || !username || !password}>
          {busy ? '확인 중…' : '로그인'}
        </button>
      </form>
    </div>
  );
}
