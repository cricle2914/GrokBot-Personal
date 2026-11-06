import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Bot as BotIcon, Check, ChevronDown, CircleHelp, Menu, Plus, Send, Settings2, X } from 'lucide-react';
import './style.css';

type Bot = { id: string; name: string; role: string; description: string; model_provider: string | null; model_name: string | null; created_at: string };
type Message = { id: string; bot_id: string; sender: string; content: string; created_at: string };
type Task = { id: string; title: string; status: string; created_at: string };
type Tab = 'detail' | 'knowledge' | 'computer';

function Avatar({ bot, large = false }: { bot?: Bot; large?: boolean }) {
  const colors = ['orange', 'teal', 'blue', 'rose'];
  const index = bot ? [...bot.name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % colors.length : 0;
  return <div className={`avatar ${colors[index]} ${large ? 'large' : ''}`} aria-hidden="true"><i /><b /><em /></div>;
}

function App() {
  const [server, setServer] = useState(localStorage.getItem('grokbot-server') || 'http://127.0.0.1:8000');
  const [token, setToken] = useState('');
  const [connected, setConnected] = useState(false);
  const [bots, setBots] = useState<Bot[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [draft, setDraft] = useState('');
  const [newBotName, setNewBotName] = useState('');
  const [newBotRole, setNewBotRole] = useState('个人助手');
  const [newTask, setNewTask] = useState('');
  const [tab, setTab] = useState<Tab>('detail');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const selected = bots.find(bot => bot.id === selectedId);

  async function api<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${server.replace(/\/$/, '')}${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.detail || `HTTP ${response.status}`);
    return body as T;
  }

  async function connect() {
    setBusy(true); setError('');
    try {
      await api('/health');
      const list = await api<Bot[]>('/bots');
      localStorage.setItem('grokbot-server', server);
      setBots(list); setSelectedId(list[0]?.id || null); setConnected(true); setSettingsOpen(false);
    } catch (reason) { setError(String(reason)); setConnected(false); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    if (!connected || !selectedId) { setMessages([]); setTasks([]); return; }
    let cancelled = false;
    Promise.all([api<Message[]>(`/bots/${selectedId}/messages`), api<Task[]>(`/bots/${selectedId}/tasks`)])
      .then(([nextMessages, nextTasks]) => { if (!cancelled) { setMessages(nextMessages); setTasks(nextTasks); } })
      .catch(reason => { if (!cancelled) setError(String(reason)); });
    return () => { cancelled = true; };
  }, [selectedId, connected]);

  async function createBot() {
    if (!newBotName.trim()) return;
    setBusy(true); setError('');
    try {
      const bot = await api<Bot>('/bots', { method: 'POST', body: JSON.stringify({ name: newBotName.trim(), role: newBotRole.trim() || '个人助手' }) });
      setBots(current => [...current, bot]); setSelectedId(bot.id); setNewBotName(''); setCreateOpen(false);
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }

  async function sendMessage() {
    if (!selectedId || !draft.trim()) return;
    setBusy(true); setError('');
    try {
      const message = await api<Message>(`/bots/${selectedId}/messages`, { method: 'POST', body: JSON.stringify({ content: draft.trim() }) });
      setMessages(current => [...current, message]); setDraft('');
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }

  async function createTask() {
    if (!selectedId || !newTask.trim()) return;
    setBusy(true); setError('');
    try {
      const task = await api<Task>(`/bots/${selectedId}/tasks`, { method: 'POST', body: JSON.stringify({ title: newTask.trim() }) });
      setTasks(current => [task, ...current]); setNewTask('');
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="sidebar-head"><div className="brand"><span className="brand-symbol">g<span>·</span></span><span>GrokBot<br/><small>PERSONAL</small></span></div><button className="icon-button" title="设置" onClick={() => setSettingsOpen(true)}><Settings2 size={19}/></button></div>
      <div className="section-heading"><span>我的 Bots <small>{bots.length}</small></span><button className="icon-button" title="创建 Bot" onClick={() => setCreateOpen(true)} disabled={!connected}><Plus size={20}/></button></div>
      <div className="bot-list">{bots.length ? bots.map(bot => <button key={bot.id} className={`bot-row ${selectedId === bot.id ? 'selected' : ''}`} onClick={() => { setSelectedId(bot.id); setTab('detail'); }}><Avatar bot={bot}/><span><strong>{bot.name}</strong><small>{bot.role}</small></span></button>) : <div className="sidebar-empty">{connected ? '还没有 Bot。点击 + 创建第一个。' : '连接服务器后查看你的 Bots。'}</div>}</div>
      <div className="sidebar-secondary"><div className="section-heading muted"><span>群聊</span><small>后续阶段</small></div><div className="section-heading muted"><span>会话</span><small>后续阶段</small></div></div>
      <div className="sidebar-foot"><span className={`status-dot ${connected ? 'online' : ''}`}/><span>{connected ? '云端已连接' : '尚未连接云端'}</span><button className="icon-button" onClick={() => setSettingsOpen(true)}><Menu size={18}/></button></div>
    </aside>

    <main className="chat-area">
      <div className="chat-header"><div className="chat-title">{selected ? <><Avatar bot={selected}/><span><strong>{selected.name}</strong><small>{selected.role}</small></span><ChevronDown size={15}/></> : <><BotIcon size={20}/><strong>GrokBot Personal</strong></>}</div><span className="phase-pill">PHASE 01</span></div>
      <div className="conversation">{selected ? messages.length ? messages.map(message => <div key={message.id} className={`message ${message.sender === 'user' ? 'mine' : ''}`}><div className="bubble">{message.content}</div><time>{new Date(message.created_at).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time></div>) : <div className="conversation-empty"><Avatar bot={selected} large/><h2>开始与{selected.name}对话</h2><p>本阶段会保存消息。模型推理和自动回复将在后续阶段接入。</p></div> : <div className="conversation-empty"><span className="empty-orbit"><BotIcon size={38}/></span><h2>{connected ? '创建你的第一个 Bot' : '连接你的云端电脑'}</h2><p>{connected ? '为 Bot 设置名称和职责，开始保存会话。' : '在设置中填写服务器地址与访问令牌。'}</p><button className="primary-button" onClick={() => connected ? setCreateOpen(true) : setSettingsOpen(true)}>{connected ? '创建 Bot' : '打开连接设置'} <Plus size={16}/></button></div>}</div>
      {error && <div className="error-banner" role="alert">{error}<button onClick={() => setError('')}><X size={15}/></button></div>}
      <div className="composer-wrap"><div className="composer"><button className="icon-button attach" disabled title="附件后续阶段支持"><Plus size={21}/></button><textarea aria-label="消息内容" value={draft} disabled={!selected} placeholder={selected ? `给 ${selected.name} 发消息` : '选择一个 Bot 后开始'} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }}/><button className="send-button" disabled={!selected || !draft.trim() || busy} onClick={sendMessage} title="发送消息"><Send size={18}/></button></div><p>消息会持久保存；当前版本不会自动生成 Bot 回复。</p></div>
    </main>

    <aside className="detail-panel"><div className="detail-top"><span>BOT 工作区</span><button className="icon-button" onClick={() => setSettingsOpen(true)} title="设置"><Settings2 size={18}/></button></div>{selected ? <><div className="profile"><Avatar bot={selected} large/><h2>{selected.name}</h2><p>{selected.role}</p></div><div className="detail-tabs"><button className={tab === 'detail' ? 'active' : ''} onClick={() => setTab('detail')}>详情</button><button className={tab === 'knowledge' ? 'active' : ''} onClick={() => setTab('knowledge')}>资料库</button><button className={tab === 'computer' ? 'active' : ''} onClick={() => setTab('computer')}>电脑</button></div>{tab === 'detail' ? <div className="detail-body"><label>职责</label><p>{selected.role}</p><label>模型</label><p>{selected.model_name || '尚未配置'}</p><label>任务 <small>{tasks.length}</small></label><div className="task-input"><input value={newTask} onChange={event => setNewTask(event.target.value)} placeholder="添加待办任务" onKeyDown={event => { if (event.key === 'Enter') void createTask(); }}/><button onClick={createTask} disabled={!newTask.trim() || busy}><Plus size={16}/></button></div>{tasks.map(task => <div className="task-row" key={task.id}><span className="task-box"/><span>{task.title}<small>{task.status === 'pending' ? '待执行' : task.status}</small></span></div>)}</div> : <div className="placeholder-card">{tab === 'computer' ? <><span className="screen-icon"><BotIcon size={26}/></span><strong>云端屏幕尚未接入</strong><p>当前阶段完成服务连接；屏幕查看将在后续阶段实现。</p></> : <><CircleHelp size={27}/><strong>资料库尚未接入</strong><p>独立记忆和授权共享将在后续阶段实现。</p></>}</div>}</> : <div className="right-empty">选择一个 Bot 查看详情</div>}</aside>

    {settingsOpen && <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}><div className="modal" onClick={event => event.stopPropagation()}><button className="modal-close" onClick={() => setSettingsOpen(false)}><X size={20}/></button><p className="modal-eyebrow">CONNECTION</p><h2>连接云端电脑</h2><p className="modal-desc">服务器地址会保存在本机；访问令牌仅在本次打开期间保留。</p><label>服务地址<input value={server} onChange={event => setServer(event.target.value)} placeholder="http://127.0.0.1:8000"/></label><label>访问令牌<input type="password" value={token} onChange={event => setToken(event.target.value)} placeholder="输入服务器访问令牌"/></label><button className="primary-button wide" onClick={connect} disabled={busy || !server || !token}>{busy ? '连接中…' : connected ? '重新连接' : '连接服务器'} <Check size={17}/></button><p className="modal-foot">模型 API Key 配置将在安全存储实现后开放。</p></div></div>}
    {createOpen && <div className="modal-backdrop" onClick={() => setCreateOpen(false)}><div className="modal" onClick={event => event.stopPropagation()}><button className="modal-close" onClick={() => setCreateOpen(false)}><X size={20}/></button><p className="modal-eyebrow">NEW BOT</p><h2>创建 Bot</h2><p className="modal-desc">先建立身份与职责。模型和工具权限将在后续阶段配置。</p><label>名称<input value={newBotName} maxLength={80} onChange={event => setNewBotName(event.target.value)} placeholder="例如：研究助手"/></label><label>职责<input value={newBotRole} maxLength={120} onChange={event => setNewBotRole(event.target.value)} placeholder="这个 Bot 负责什么？"/></label><button className="primary-button wide" onClick={createBot} disabled={busy || !newBotName.trim()}>创建 Bot <Plus size={17}/></button></div></div>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
