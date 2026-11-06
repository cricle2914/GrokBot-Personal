import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

type TaskKind = 'note' | 'read_notes' | 'browse';

function App() {
  const [server, setServer] = useState(localStorage.getItem('server') || 'http://127.0.0.1:8000');
  const [token, setToken] = useState('');
  const [status, setStatus] = useState('尚未连接');
  const [kind, setKind] = useState<TaskKind>('note');
  const [value, setValue] = useState('');
  const [result, setResult] = useState('任务结果会显示在这里。');
  const [busy, setBusy] = useState(false);

  async function request(path: string, options?: RequestInit) {
    localStorage.setItem('server', server);
    const response = await fetch(`${server.replace(/\/$/, '')}${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.detail || `HTTP ${response.status}`);
    return body;
  }

  async function connect() {
    setBusy(true);
    try {
      const body = await request('/health');
      setStatus(body.status === 'online' ? '云端在线' : '连接异常');
      setResult(`工作目录：${body.workspace}`);
    } catch (error) {
      setStatus('连接失败');
      setResult(String(error));
    } finally { setBusy(false); }
  }

  async function run() {
    setBusy(true);
    try {
      const body = await request('/tasks', {
        method: 'POST',
        body: JSON.stringify({ kind, value: kind === 'read_notes' ? 'read' : value }),
      });
      setResult(body.result);
      if (kind === 'note') setValue('');
    } catch (error) { setResult(String(error)); }
    finally { setBusy(false); }
  }

  return <div className="shell">
    <aside className="rail"><div className="mark">G<span>·</span></div><div className="rail-bottom">PERSONAL<br/>AGENT / 01</div></aside>
    <main>
      <header><div><p className="eyebrow">YOUR CLOUD COMPUTER</p><h1>GrokBot <em>Personal</em></h1></div><span className="badge">{status}</span></header>
      <section className="connection"><div><p className="eyebrow">01 / CONNECTION</p><h2>连接云端工作电脑</h2></div><div className="fields"><label>服务地址<input value={server} onChange={e => setServer(e.target.value)} placeholder="https://你的服务地址" /></label><label>访问令牌<input type="password" value={token} onChange={e => setToken(e.target.value)} placeholder="仅在本次打开期间保留" /></label><button onClick={connect} disabled={busy || !server || !token}>连接检查 <span>↗</span></button></div></section>
      <section className="workspace"><div className="task-panel"><p className="eyebrow">02 / FIRST TASK</p><h2>让云端电脑做一件事</h2><div className="tabs"><button className={kind === 'note' ? 'active' : ''} onClick={() => setKind('note')}>保存笔记</button><button className={kind === 'read_notes' ? 'active' : ''} onClick={() => setKind('read_notes')}>读取笔记</button><button className={kind === 'browse' ? 'active' : ''} onClick={() => setKind('browse')}>打开网页</button></div>{kind !== 'read_notes' && <textarea value={value} onChange={e => setValue(e.target.value)} placeholder={kind === 'browse' ? 'https://example.com' : '写一条要保存在云端的笔记…'} />}<button className="run" onClick={run} disabled={busy || !token || (kind !== 'read_notes' && !value)}>{busy ? '执行中…' : '在云端执行'} <span>→</span></button></div><div className="result-panel"><p className="eyebrow">03 / RESULT</p><h2>执行结果</h2><pre>{result}</pre></div></section>
      <footer>最小验证版 · 任务在云服务器执行 · 当前版本不会操作你的 Windows 电脑</footer>
    </main>
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
