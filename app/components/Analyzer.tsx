'use client';
import { useRef, useState } from 'react';
import type { AnalyzeResponse } from '@/lib/types';
import { downloadExcel } from './excel';

type Mode = 'image' | 'pdf' | 'site' | 'text';
const MODES: { id: Mode; label: string }[] = [
  { id: 'image', label: '이미지' },
  { id: 'pdf', label: 'PDF' },
  { id: 'site', label: '사이트' },
  { id: 'text', label: '텍스트' },
];
const MAX_PDF_BYTES = 3 * 1024 * 1024;

/** 이미지를 긴 변 maxSide 픽셀로 줄여 dataURL 반환 (전송량·API 비용 절감) */
function resizeImage(file: File, maxSide: number, type: 'image/jpeg' | 'image/png', quality = 0.9): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL(type, quality));
    };
    img.onerror = () => reject(new Error('이미지를 읽을 수 없습니다.'));
    img.src = URL.createObjectURL(file);
  });
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(new Error('파일을 읽을 수 없습니다.'));
    r.readAsDataURL(file);
  });
}

function rankCell(v: number | null | 'error' | undefined) {
  if (v === 'error') return <span className="badge high">오류</span>;
  if (typeof v === 'number') return <span className={`badge ${v <= 10 ? 'low' : v <= 30 ? 'mid' : ''}`}>{v}위</span>;
  if (v === null) return <span className="muted" title="상위 100위 안에 없음">밖</span>;
  return '-';
}

function compClass(c: string) {
  return c === '높음' ? 'high' : c === '중간' ? 'mid' : c === '낮음' ? 'low' : '';
}

export default function Analyzer({ maxKeywords, ready, isAdmin }: { maxKeywords: number; ready: { claude: boolean; naver: boolean; hub: boolean }; isAdmin: boolean }) {
  const [mode, setMode] = useState<Mode>('image');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [count, setCount] = useState(Math.min(20, maxKeywords));
  const [useRegion, setUseRegion] = useState(true);
  const [includeRelated, setIncludeRelated] = useState(true);
  const [extra, setExtra] = useState('');
  const [checkExposure, setCheckExposure] = useState(ready.hub);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [thumb, setThumb] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [copied, setCopied] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  function pickFile(f: File | null) {
    setError('');
    if (!f) return;
    if (mode === 'image' && !/^image\/(jpeg|png|webp|gif)$/.test(f.type)) return setError('JPG, PNG, WEBP, GIF 이미지만 올릴 수 있습니다.');
    if (mode === 'pdf' && f.type !== 'application/pdf') return setError('PDF 파일만 올릴 수 있습니다.');
    if (mode === 'pdf' && f.size > MAX_PDF_BYTES) return setError('PDF는 3MB 이하만 가능합니다. 필요한 페이지만 나누거나 페이지를 캡처해 이미지로 올려 주세요.');
    setFile(f);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(mode === 'image' ? URL.createObjectURL(f) : null);
  }

  function switchMode(m: Mode) {
    setMode(m);
    setFile(null);
    setPreview(null);
    setError('');
  }

  async function run() {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const payload: Record<string, unknown> = { mode, count, useRegion, includeRelated, extra, checkExposure };
      let thumbUrl: string | null = null;
      if (mode === 'image') {
        if (!file) throw new Error('이미지를 선택하세요.');
        const keepPng = file.type === 'image/png';
        const dataUrl = await resizeImage(file, 1568, keepPng ? 'image/png' : 'image/jpeg');
        // PNG가 너무 크면 JPEG로 재압축
        const finalUrl = dataUrl.length > 4_000_000 ? await resizeImage(file, 1568, 'image/jpeg', 0.85) : dataUrl;
        payload.mediaType = finalUrl.slice(5, finalUrl.indexOf(';'));
        payload.data = finalUrl.split(',')[1];
        payload.name = file.name;
        thumbUrl = await resizeImage(file, 400, 'image/jpeg', 0.8);
      } else if (mode === 'pdf') {
        if (!file) throw new Error('PDF를 선택하세요.');
        payload.data = await fileToBase64(file);
        payload.name = file.name;
      } else if (mode === 'site') {
        payload.url = url;
      } else {
        payload.text = text;
      }
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.status === 401) { window.location.href = '/login'; return; }
      const j = await res.json().catch(() => ({ error: `서버 오류 (${res.status})` }));
      if (!res.ok) throw new Error(j.error || '분석 실패');
      setResult(j);
      setThumb(thumbUrl);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function copy(label: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    setTimeout(() => setCopied(''), 1500);
  }

  const canRun =
    !busy && ready.claude &&
    ((mode === 'image' || mode === 'pdf') ? Boolean(file) : mode === 'site' ? /^https?:\/\/.+/.test(url.trim()) : text.trim().length > 1);
  const maxTotal = result ? Math.max(1, ...result.rows.map((r) => r.total)) : 1;

  return (
    <div className="container">
      {!ready.claude && (
        <div className="msg err no-print">Claude API 키가 설정되지 않았습니다. {isAdmin ? <a href="/admin">관리자 설정</a> : '관리자에게 문의하세요.'}</div>
      )}
      {ready.claude && !ready.naver && (
        <div className="msg warn no-print">네이버 검색광고 API가 설정되지 않아 검색량 없이 AI 키워드만 제공됩니다. {isAdmin && <a href="/admin">관리자 설정</a>}</div>
      )}

      <div className="grid2">
        {/* ── 입력 */}
        <div className="panel input-col no-print">
          <h2>분석 자료</h2>
          <div className="tabs" role="tablist">
            {MODES.map((m) => (
              <button key={m.id} className={mode === m.id ? 'on' : ''} onClick={() => switchMode(m.id)} role="tab" aria-selected={mode === m.id}>
                {m.label}
              </button>
            ))}
          </div>

          {(mode === 'image' || mode === 'pdf') && (
            <>
              <div
                className={`drop ${over ? 'over' : ''}`}
                onClick={() => fileInput.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setOver(true); }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => { e.preventDefault(); setOver(false); pickFile(e.dataTransfer.files?.[0] ?? null); }}
              >
                {file ? <strong>{file.name}</strong> : mode === 'image' ? '이미지를 끌어 놓거나 클릭해서 선택' : 'PDF를 끌어 놓거나 클릭해서 선택 (3MB 이하)'}
                <div className="hint" style={{ marginTop: 4 }}>
                  {mode === 'image' ? '홍보물·포스터·배너·화면 캡처(PNG 권장). 휴대폰에서는 사진 촬영도 가능합니다.' : '카탈로그·요금 안내서 등. 여러 페이지면 핵심 페이지만 올리는 것이 정확합니다.'}
                </div>
              </div>
              <input
                ref={fileInput}
                type="file"
                hidden
                accept={mode === 'image' ? 'image/jpeg,image/png,image/webp,image/gif' : 'application/pdf'}
                onChange={(e) => { pickFile(e.target.files?.[0] ?? null); e.target.value = ''; }}
              />
              {preview && <img className="preview" src={preview} alt="미리보기" />}
            </>
          )}

          {mode === 'site' && (
            <>
              <label>사이트 주소</label>
              <input type="url" placeholder="https://iscs.co.kr/www/" value={url} onChange={(e) => setUrl(e.target.value)} />
              <div className="hint" style={{ marginTop: 6 }}>광고 추적값(utm, NaPm)은 자동으로 제거합니다. 글자가 이미지로만 된 페이지는 화면 캡처로 분석하세요.</div>
            </>
          )}

          {mode === 'text' && (
            <>
              <label>분석할 텍스트</label>
              <textarea placeholder="홍보 문구, 상품 설명, 보도자료 등을 붙여 넣으세요." value={text} onChange={(e) => setText(e.target.value)} />
            </>
          )}

          <label>
            키워드 개수 <span className="hint">(5~{maxKeywords}개)</span>
          </label>
          <input type="number" min={5} max={maxKeywords} value={count} onChange={(e) => setCount(Math.min(maxKeywords, Math.max(5, Number(e.target.value) || 5)))} />

          <label className="check"><input type="checkbox" checked={useRegion} onChange={(e) => setUseRegion(e.target.checked)} /> 지역명 조합 키워드 포함</label>
          <label className="check"><input type="checkbox" checked={includeRelated} onChange={(e) => setIncludeRelated(e.target.checked)} disabled={!ready.naver} /> 네이버 연관 키워드도 후보에 포함</label>

          <label className="check">
            <input type="checkbox" checked={checkExposure} onChange={(e) => setCheckExposure(e.target.checked)} disabled={!ready.hub} /> 서경방송 노출 순위 조회
            {!ready.hub && <span className="hint">(관리자 설정 필요)</span>}
          </label>

          <label>추가 요청 <span className="hint">(선택)</span></label>
          <input type="text" placeholder="예: 20~30대 대상, 이사철 이벤트 중심으로" value={extra} onChange={(e) => setExtra(e.target.value)} />

          {error && <div className="msg err">{error}</div>}
          <button className="primary block" style={{ marginTop: 16 }} onClick={run} disabled={!canRun}>
            {busy ? <><span className="spinner" />분석 중… ({checkExposure ? '30~60초' : '20~40초'})</> : '키워드 분석 시작'}
          </button>
        </div>

        {/* ── 결과 */}
        <div>
          {!result && !busy && (
            <div className="panel empty no-print">
              자료를 넣고 <b>키워드 분석 시작</b>을 누르면
              <br />AI가 만든 키워드를 네이버 월간 검색량 순으로 정렬해 보여 드립니다.
            </div>
          )}
          {busy && <div className="panel empty no-print">AI가 자료를 판독하고 네이버 검색량을 조회하고 있습니다…</div>}

          {result && (
            <>
              <div className="print-only" style={{ marginBottom: 10 }}>
                <h1>검색 키워드 분석 보고서</h1>
                <div className="muted">
                  서경방송 마케팅팀 · {new Date(result.meta.analyzedAt).toLocaleString('ko-KR')} · 분석자 {result.meta.analyst}
                </div>
              </div>

              <div className="panel">
                <div className="btn-row no-print" style={{ justifyContent: 'flex-end', marginBottom: 10 }}>
                  <button className="accent" onClick={() => downloadExcel(result, thumb)}>엑셀 다운로드</button>
                  <button onClick={() => window.print()}>보고서 인쇄 / PDF 저장</button>
                </div>
                <div className={thumb ? 'summary-box' : ''}>
                  {thumb && <img src={thumb} alt="분석 이미지" />}
                  <div>
                    <h2>{result.ai.subject || '분석 결과'}</h2>
                    <p style={{ margin: '0 0 8px' }}>{result.ai.summary}</p>
                    <div className="hint">{result.meta.source}</div>
                    {result.ai.detectedText.length > 0 && (
                      <div className="hint" style={{ marginTop: 4 }}>판독 문구: {result.ai.detectedText.join(' / ')}</div>
                    )}
                  </div>
                </div>
                {result.ai.uncertain.length > 0 && <div className="msg warn">확인 필요: {result.ai.uncertain.join(' / ')}</div>}
                {result.warnings.map((w) => <div key={w} className="msg warn no-print">{w}</div>)}
              </div>

              <div className="panel">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <h2>검색량 순 키워드 {result.rows.length}개</h2>
                  <button className="no-print" onClick={() => copy('kw', result.rows.map((r) => r.keyword).join('\n'))}>
                    {copied === 'kw' ? '복사됨 ✓' : '키워드 목록 복사'}
                  </button>
                </div>
                <div className="hint" style={{ marginBottom: 8 }}>
                  네이버 검색광고 키워드도구 기준 최근 한 달 검색량 · AI 후보 {result.meta.candidates}개 중 선별
                  {result.meta.exposureAreas.length > 0 && ' · 노출 순위는 네이버 검색 결과 상위 100위 기준 (밖 = 100위 안에 없음)'}
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th className="num">순위</th>
                        <th>키워드</th>
                        <th>유형</th>
                        <th className="num">PC</th>
                        <th className="num">모바일</th>
                        <th className="num">합계</th>
                        <th style={{ width: 110 }} className="no-print"></th>
                        <th>경쟁</th>
                        {result.meta.exposureAreas.map((a) => <th key={a.key} className="num">{a.label} 노출</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((r) => (
                        <tr key={r.rank} className={r.total === 0 ? 'zero' : ''}>
                          <td className="num">{r.rank}</td>
                          <td><b>{r.keyword}</b></td>
                          <td><span className={`badge ${r.source === '네이버 연관' ? 'nv' : 'ai'}`}>{r.type}</span></td>
                          <td className="num">{r.pcLabel}</td>
                          <td className="num">{r.mobileLabel}</td>
                          <td className="num"><b>{r.hasData ? r.total.toLocaleString('ko-KR') : '-'}</b></td>
                          <td className="no-print"><div className="bar" style={{ width: `${Math.max(2, (r.total / maxTotal) * 100)}%` }} /></td>
                          <td>{r.comp !== '-' ? <span className={`badge ${compClass(r.comp)}`}>{r.comp}</span> : '-'}</td>
                          {result.meta.exposureAreas.map((a) => <td key={a.key} className="num">{rankCell(r.exposure?.[a.key])}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="panel">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <h3>SNS 해시태그</h3>
                  <button className="no-print" onClick={() => copy('tag', result.ai.hashtags.join(' '))}>{copied === 'tag' ? '복사됨 ✓' : '복사'}</button>
                </div>
                <div className="chips">{result.ai.hashtags.map((h) => <span key={h} className="chip">{h}</span>)}</div>
                {result.ai.englishKeywords.length > 0 && (
                  <>
                    <h3 style={{ marginTop: 14 }}>영문 키워드 <span className="hint">(검색량 미조회, 참고용)</span></h3>
                    <div className="chips">{result.ai.englishKeywords.map((k) => <span key={k} className="chip">{k}</span>)}</div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
