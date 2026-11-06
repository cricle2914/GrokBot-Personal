import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Bot as BotIcon, Check, ChevronDown, CircleHelp, Menu, Plus, Send, Settings2, X } from 'lucide-react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { check } from '@tauri-apps/plugin-updater';
import './style.css';

type Bot = { id: string; name: string; role: string; description: string; model_provider: string | null; model_name: string | null; created_at: string };
type Message = { id: string; bot_id: string; sender: string; content: string; created_at: string };
type Task = { id: string; title: string; status: string; created_at: string };
type Tab = 'detail' | 'knowledge' | 'computer';
type ModelConfig = { provider: string; base_url: string; model_name: string; has_api_key: boolean };

function Avatar({ bot, large = false }: { bot?: Bot; large?: boolean }) {
  const colors = ['orange', 'teal', 'blue', 'rose'];
  const index = bot ? [...bot.name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % colors.length : 0;
  return <div className={`avatar ${colors[index]} ${large ? 'large' : ''}`} aria-hidden="true"><i /><b /><em /></div>;
}

function App() {
  const [server, setServer] = useState(localStorage.getItem('grokbot-server') || 'http://127.0.0.1:8000');
  const [connectionMode, setConnectionMode] = useState<'ssh' | 'direct'>(isTauri() ? 'ssh' : 'direct');
  const [sshHost, setSshHost] = useState(localStorage.getItem('grokbot-ssh-host') || '');
  const [sshUser, setSshUser] = useState(localStorage.getItem('grokbot-ssh-user') || '');
  const [sshPassword, setSshPassword] = useState('');
  const [loginPort, setLoginPort] = useState(Number(localStorage.getItem('grokbot-login-port') || '22'));
  const [envPath, setEnvPath] = useState('~/grokbot-phase1/deploy/.env');
  const [hostFingerprint, setHostFingerprint] = useState('');
  const [connectionStatus, setConnectionStatus] = useState('');
  const [settingsTab, setSettingsTab] = useState<'server' | 'model'>('server');
  const [modelStatus, setModelStatus] = useState('');
  const [localModelSaved, setLocalModelSaved] = useState(false);
  const [sshPort, setSshPort] = useState(Number(localStorage.getItem('grokbot-ssh-port') || '8001'));
  const [token, setToken] = useState('');
  const [modelConfig, setModelConfig] = useState<ModelConfig | null>(null);
  const [modelProvider, setModelProvider] = useState('OpenAI-compatible');
  const [modelBaseUrl, setModelBaseUrl] = useState('');
  const [modelName, setModelName] = useState('');
  const [modelKey, setModelKey] = useState('');
  const [updateStatus, setUpdateStatus] = useState('');
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
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const selected = bots.find(bot => bot.id === selectedId);
  const modelPayload = () => ({ provider: modelProvider, base_url: modelBaseUrl.trim(), model_name: modelName.trim() });
  function fillModel(config: ModelConfig) {
    setModelConfig(config); setModelProvider(config.provider); setModelBaseUrl(config.base_url); setModelName(config.model_name);
  }
  useEffect(() => {
    if (isTauri()) invoke<ModelConfig | null>('load_model').then(config => {
      if (config) { fillModel(config); setLocalModelSaved(config.has_api_key); }
    }).catch(reason => setError(String(reason)));
  }, []);
  function openSettings(section: 'server' | 'model') { setSettingsTab(section); setSettingsOpen(true); setError(''); }
  async function syncModel() { await invoke('sync_model', { port: sshPort, envPath, token }); }


  useEffect(() => {
    if (!isTauri() || !import.meta.env.PROD) return;
    check().then(async update => {
      if (!update) return;
      setUpdateStatus(`正在安装 ${update.version} 更新…`);
      await update.downloadAndInstall();
      setUpdateStatus('更新已下载，安装程序即将启动');
    }).catch(() => setUpdateStatus('自动更新检查失败；可稍后重试'));
  }, []);

  async function api<T>(path: string, options?: RequestInit): Promise<T> {
    if (connectionMode === 'ssh') {
      const result = await invoke<{ status: number; body: T & { detail?: string } }>('ssh_api', {
        request: { port: sshPort, env_path: envPath, token, path, method: options?.method || 'GET', body: options?.body ? JSON.parse(String(options.body)) : null },
      });
      if (result.status >= 400) throw new Error(result.body.detail || `HTTP ${result.status}`);
      return result.body;
    }
    const response = await fetch(`${server.replace(/\/$/, '')}${path}`, {
      ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.detail || `HTTP ${response.status}`);
    return body as T;
  }

  async function connect() {
    if (busy) return;
    setBusy(true); setError(''); setConnected(false); setBots([]); setSelectedId(null);
    try {
      if (connectionMode === 'ssh') {
        const inspection = await invoke<{fingerprint: string; trusted: boolean}>('inspect_host', { host: sshHost.trim(), port: loginPort });
        if (!inspection.trusted && hostFingerprint !== inspection.fingerprint) {
          setHostFingerprint(inspection.fingerprint);
          setConnectionStatus('首次连接，请核对下方服务器指纹');
          return;
        }
        setConnectionStatus('正在登录 SSH…');
        await invoke('connect_server', { host: sshHost.trim(), port: loginPort, username: sshUser.trim(), password: sshPassword, expectedFingerprint: inspection.fingerprint });
        setSshPassword(''); setHostFingerprint('');
        localStorage.setItem('grokbot-ssh-host', sshHost.trim());
        localStorage.setItem('grokbot-ssh-user', sshUser.trim());
        localStorage.setItem('grokbot-login-port', String(loginPort));
        localStorage.setItem('grokbot-ssh-port', String(sshPort));
        setConnectionStatus('SSH 已登录，正在检查 Bot 服务…');
      } else {
        const endpoint = new URL(server);
        if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(endpoint.hostname))) {
          throw new Error('远程直连必须使用 HTTPS；本机开发地址可用 HTTP');
        }
      }
      await api('/health');
      const list = await api<Bot[]>('/bots');
      const config = await api<ModelConfig | null>('/model-config');
      if (config && !localModelSaved) fillModel(config);
      localStorage.setItem('grokbot-server', server);
      setBots(list); setSelectedId(list[0]?.id || null); setConnected(true);
      setConnectionStatus('SSH 与 Bot 服务已就绪');
      if (localModelSaved && connectionMode === 'ssh') {
        try { await syncModel(); setModelStatus('本机模型设置已同步到云端'); }
        catch (reason) { setModelStatus(`本机配置已保存，但云端同步失败：${String(reason)}`); }
      }
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }

  async function saveModelConfig() {
    if (busy) return;
    setBusy(true); setError(''); setModelStatus('');
    try {
      if (isTauri()) {
        const config = await invoke<ModelConfig>('save_model', { config: modelPayload(), apiKey: modelKey || null });
        setModelConfig(config); setModelKey(''); setLocalModelSaved(true);
        setModelStatus('已保存到本机，API Key 由系统凭据管理器保管');
        if (connected && connectionMode === 'ssh') {
          try { await syncModel(); setModelStatus('已保存并同步到云端，所有 Bot 默认使用此配置'); }
          catch (reason) { setModelStatus(`本机已保存，云端同步失败：${String(reason)}`); }
        }
      } else {
        const config = await api<ModelConfig>('/model-config', { method: 'PUT', body: JSON.stringify({ ...modelPayload(), api_key: modelKey || null }) });
        setModelConfig(config); setModelKey(''); setModelStatus('已保存到云端');
      }
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }
  async function testModel() {
    if (busy) return;
    setBusy(true); setError(''); setModelStatus('正在测试模型响应…');
    try {
      if (isTauri()) await invoke('test_model', { config: modelPayload(), apiKey: modelKey || null });
      else await api('/model-config/test', { method: 'POST', body: JSON.stringify({ ...modelPayload(), api_key: modelKey || null }) });
      setModelStatus('测试成功：模型已返回有效回复');
    } catch (reason) { setModelStatus(''); setError(String(reason)); }
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
    if (!selectedId || !draft.trim() || busy) return;
    const botId = selectedId;
    const sentDraft = draft;
    setBusy(true); setError('');
    try {
      const turn = await api<Message[]>(`/bots/${botId}/chat`, { method: 'POST', body: JSON.stringify({ content: draft.trim() }) });
      if (selectedRef.current === botId) {
        setMessages(current => [...current, ...turn]);
        setDraft(current => current === sentDraft ? '' : current);
      }
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
      <div className="sidebar-head"><div className="brand"><span className="brand-symbol">g<span>·</span></span><span>GrokBot<br/><small>PERSONAL</small></span></div><button className="icon-button" title="设置" onClick={() => openSettings('server')}><Settings2 size={19}/></button></div>
      <div className="section-heading"><span>我的 Bots <small>{bots.length}</small></span><button className="icon-button" title="创建 Bot" onClick={() => setCreateOpen(true)} disabled={!connected}><Plus size={20}/></button></div>
      <div className="bot-list">{bots.length ? bots.map(bot => <button key={bot.id} className={`bot-row ${selectedId === bot.id ? 'selected' : ''}`} onClick={() => { setSelectedId(bot.id); setTab('detail'); }}><Avatar bot={bot}/><span><strong>{bot.name}</strong><small>{bot.role}</small></span></button>) : <div className="sidebar-empty">{connected ? '还没有 Bot。点击 + 创建第一个。' : '连接服务器后查看你的 Bots。'}</div>}</div>
      <div className="settings-shortcuts"><button onClick={() => openSettings('server')}><span>服务器连接</span><small>{connected ? '已连接' : '未连接'}</small></button><button onClick={() => openSettings('model')}><span>模型设置</span><small>{modelConfig?.model_name || '配置 API Key'}</small></button></div><div className="sidebar-secondary"><div className="section-heading muted"><span>群聊</span><small>后续阶段</small></div><div className="section-heading muted"><span>会话</span><small>后续阶段</small></div></div>
      <div className="sidebar-foot"><span className={`status-dot ${connected ? 'online' : ''}`}/><span>{updateStatus || (connected ? '云端已连接' : '尚未连接云端')}</span><button className="icon-button" onClick={() => openSettings('server')}><Menu size={18}/></button></div>
    </aside>

    <main className="chat-area">
      <div className="chat-header"><div className="chat-title">{selected ? <><Avatar bot={selected}/><span><strong>{selected.name}</strong><small>{selected.role}</small></span><ChevronDown size={15}/></> : <><BotIcon size={20}/><strong>GrokBot Personal</strong></>}</div><span className="phase-pill">PHASE 01</span></div>
      <div className="conversation">{selected ? messages.length ? messages.map(message => <div key={message.id} className={`message ${message.sender === 'user' ? 'mine' : ''}`}><div className="bubble">{message.content}</div><time>{new Date(message.created_at).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time></div>) : <div className="conversation-empty"><Avatar bot={selected} large/><h2>开始与{selected.name}对话</h2><p>使用全局模型配置开始对话。</p></div> : <div className="conversation-empty"><span className="empty-orbit"><BotIcon size={38}/></span><h2>{connected ? '创建你的第一个 Bot' : '连接你的云端电脑'}</h2><p>{connected ? '为 Bot 设置名称和职责，开始对话。' : '填写云服务器公网 IP、用户名和密码。'}</p><button className="primary-button" onClick={() => connected ? setCreateOpen(true) : setSettingsOpen(true)}>{connected ? '创建 Bot' : '打开连接设置'} <Plus size={16}/></button></div>}</div>
      {error && <div className="error-banner" role="alert">{error}<button onClick={() => setError('')}><X size={15}/></button></div>}
      <div className="composer-wrap"><div className="composer"><button className="icon-button attach" disabled title="附件后续阶段支持"><Plus size={21}/></button><textarea aria-label="消息内容" value={draft} disabled={!selected} placeholder={selected ? `给 ${selected.name} 发消息` : '选择一个 Bot 后开始'} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }}/><button className="send-button" disabled={!selected || !draft.trim() || busy} onClick={sendMessage} title="发送消息"><Send size={18}/></button></div><p>{busy ? '正在处理，请稍候…' : 'Bot 使用全局模型配置回复，成功后保存对话。'}</p></div>
    </main>

    <aside className="detail-panel"><div className="detail-top"><span>BOT 工作区</span><button className="icon-button" onClick={() => openSettings('server')} title="设置"><Settings2 size={18}/></button></div>{selected ? <><div className="profile"><Avatar bot={selected} large/><h2>{selected.name}</h2><p>{selected.role}</p></div><div className="detail-tabs"><button className={tab === 'detail' ? 'active' : ''} onClick={() => setTab('detail')}>详情</button><button className={tab === 'knowledge' ? 'active' : ''} onClick={() => setTab('knowledge')}>资料库</button><button className={tab === 'computer' ? 'active' : ''} onClick={() => setTab('computer')}>电脑</button></div>{tab === 'detail' ? <div className="detail-body"><label>职责</label><p>{selected.role}</p><label>模型</label><p>{selected.model_name || modelConfig?.model_name || '尚未配置'}{!selected.model_name && modelConfig ? '（继承全局）' : ''}</p><label>任务 <small>{tasks.length}</small></label><div className="task-input"><input value={newTask} onChange={event => setNewTask(event.target.value)} placeholder="添加待办任务" onKeyDown={event => { if (event.key === 'Enter') void createTask(); }}/><button onClick={createTask} disabled={!newTask.trim() || busy}><Plus size={16}/></button></div>{tasks.map(task => <div className="task-row" key={task.id}><span className="task-box"/><span>{task.title}<small>{task.status === 'pending' ? '待执行' : task.status}</small></span></div>)}</div> : <div className="placeholder-card">{tab === 'computer' ? <><span className="screen-icon"><BotIcon size={26}/></span><strong>云端屏幕尚未接入</strong><p>当前阶段完成服务连接；屏幕查看将在后续阶段实现。</p></> : <><CircleHelp size={27}/><strong>资料库尚未接入</strong><p>独立记忆和授权共享将在后续阶段实现。</p></>}</div>}</> : <div className="right-empty">选择一个 Bot 查看详情</div>}</aside>

    {settingsOpen && <div className="modal-backdrop" onClick={() => !busy && setSettingsOpen(false)}><div className="modal settings-modal" onClick={event => event.stopPropagation()}>
      <button className="modal-close" disabled={busy} aria-label="关闭设置" onClick={() => setSettingsOpen(false)}><X size={20}/></button>
      <p className="modal-eyebrow">GROKBOT / SETTINGS</p>
      <div className="settings-tabs"><button disabled={busy} className={settingsTab === 'server' ? 'active' : ''} onClick={() => { setSettingsTab('server'); setError(''); }}>服务器连接</button><button disabled={busy} className={settingsTab === 'model' ? 'active' : ''} onClick={() => { setSettingsTab('model'); setError(''); }}>模型设置</button></div>
      <fieldset disabled={busy}>
      {settingsTab === 'server' ? <>
        <h2>连接你的云服务器</h2><p className="modal-desc">使用服务器账户登录。连接后检查 Bot 服务状态。</p>
        {!isTauri() && <p className="settings-note">浏览器预览仅支持 API 直连；IP 和密码登录请使用 Windows 客户端。</p>}
        {connectionMode === 'ssh' ? <>
          <label>公网 IP 地址<input value={sshHost} onChange={e => { setSshHost(e.target.value); setHostFingerprint(''); }} placeholder="例如 203.0.113.10" autoComplete="off"/></label>
          <div className="field-grid"><label>SSH 端口<input type="number" min="1" max="65535" value={loginPort} onChange={e => { setLoginPort(Number(e.target.value)); setHostFingerprint(''); }}/></label><label>用户名<input value={sshUser} onChange={e => setSshUser(e.target.value)} placeholder="服务器用户名" autoComplete="username"/></label></div>
          <label>登录密码<input type="password" value={sshPassword} onChange={e => setSshPassword(e.target.value)} placeholder="输入服务器账户密码" autoComplete="off"/></label>
          {hostFingerprint && <div className="host-fingerprint"><strong>首次连接 · 核对服务器指纹</strong><code>{hostFingerprint}</code><p>核对后点击“信任并登录”，后续自动检查指纹。</p></div>}
        </> : <label>API 服务地址<input value={server} onChange={e => setServer(e.target.value)} placeholder="http://127.0.0.1:8001"/></label>}
        <details className="advanced-settings"><summary>高级设置</summary>
          <label>连接方式<select value={connectionMode} onChange={e => { setConnectionMode(e.target.value as 'ssh' | 'direct'); setConnected(false); setConnectionStatus(''); }}><option value="ssh" disabled={!isTauri()}>IP + 密码（SSH）</option><option value="direct">API 直连（开发测试）</option></select></label>
          {connectionMode === 'ssh' && <><label>Bot 服务端口<input type="number" min="1" max="65535" value={sshPort} onChange={e => setSshPort(Number(e.target.value))}/></label><label>云端服务配置文件<input value={envPath} onChange={e => setEnvPath(e.target.value)} placeholder="~/grokbot-phase1/deploy/.env"/></label></>}
          <label>服务访问令牌（SSH 可自动读取）<input type="password" value={token} onChange={e => setToken(e.target.value)} placeholder="自动读取失败时手动填写" autoComplete="off"/></label>
        </details>
        {connectionStatus && <p className="settings-status" role="status">{connectionStatus}</p>}
        <button className="primary-button wide" onClick={connect} disabled={busy || (connectionMode === 'ssh' ? !sshHost.trim() || !sshUser.trim() || !sshPassword || loginPort < 1 || loginPort > 65535 : !server || !token)}>{busy ? '正在连接…' : hostFingerprint ? '信任并登录' : connected ? '重新连接' : '连接服务器'}<Check size={17}/></button>
        <p className="modal-foot">登录密码不保存；Bot 服务通过 SSH 加密连接，无需开放公网 API 端口。</p>
      </> : <>
        <h2>全局模型设置</h2><p className="modal-desc">所有 Bot 默认使用这组配置。无需先连接服务器。</p>
        <label>服务商<select value={modelProvider} onChange={e => { setModelProvider(e.target.value); setModelStatus(''); }}><option>OpenAI-compatible</option><option>OpenAI</option><option>DeepSeek</option><option>Grok</option><option>Anthropic</option></select></label>
        <label>API 地址<input value={modelBaseUrl} onChange={e => { setModelBaseUrl(e.target.value); setModelStatus(''); }} placeholder="https://api.example.com/v1"/></label>
        <label>模型名称<input value={modelName} onChange={e => { setModelName(e.target.value); setModelStatus(''); }} placeholder="填写服务商提供的模型 ID"/></label>
        <label>API Key<input type="password" value={modelKey} onChange={e => { setModelKey(e.target.value); setModelStatus(''); }} autoComplete="off" placeholder={localModelSaved ? '已安全保存；留空保持原密钥' : '粘贴模型 API Key'}/></label>
        {!isTauri() && !connected && <p className="settings-note">浏览器预览需连接后端；Windows 客户端可独立保存与测试。</p>}
        <div className="model-actions"><button className="secondary-button" onClick={testModel} disabled={busy || !modelBaseUrl.trim() || !modelName.trim() || (!modelKey && !localModelSaved && !connected) || (!isTauri() && !connected)}>测试连接</button><button className="primary-button" onClick={saveModelConfig} disabled={busy || !modelBaseUrl.trim() || !modelName.trim() || (!modelKey && !localModelSaved && !connected) || (!isTauri() && !connected)}>保存配置<Check size={17}/></button></div>
        {modelStatus && <p className="settings-status" role="status">{modelStatus}</p>}
        <p className="modal-foot">Windows 使用系统凭据管理器保存 API Key；连接服务器后同步至云端加密存储。测试会发送一条简短请求。</p>
      </>}
      </fieldset>
      {error && <p className="modal-error" role="alert">{error}</p>}
    </div></div>}
    {createOpen && <div className="modal-backdrop" onClick={() => setCreateOpen(false)}><div className="modal" onClick={event => event.stopPropagation()}><button className="modal-close" onClick={() => setCreateOpen(false)}><X size={20}/></button><p className="modal-eyebrow">NEW BOT</p><h2>创建 Bot</h2><p className="modal-desc">先建立身份与职责。Bot 默认使用全局模型设置。</p><label>名称<input value={newBotName} maxLength={80} onChange={event => setNewBotName(event.target.value)} placeholder="例如：研究助手"/></label><label>职责<input value={newBotRole} maxLength={120} onChange={event => setNewBotRole(event.target.value)} placeholder="这个 Bot 负责什么？"/></label><button className="primary-button wide" onClick={createBot} disabled={busy || !newBotName.trim()}>创建 Bot <Plus size={17}/></button></div></div>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
