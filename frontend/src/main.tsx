import { FormEvent, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io, Socket } from 'socket.io-client';
import { demoApi } from './demo';
import './styles.css';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api';
const DEMO = import.meta.env.VITE_STATIC_DEMO === 'true';

type User = { id: string; email: string; fullName: string; role: string };
type Assignment = { userId: string; status: string };
type Task = { id: string; title: string; description: string; deadline?: string; status: string; priority: number; targetScope: string; assignments?: Assignment[] };
type Report = { id: string; taskId: string; content: string; studentCount?: number; reportingPeriod?: string; status: string; task: { id: string; title: string } };
type AdminUser = { id: string; email: string; fullName: string; role: string; isActive: boolean };
type Contact = { id: string; fullName: string; role: string };
type Chat = { id: string; members: { user: Contact }[]; messages: Message[] };
type Message = { id: string; senderId: string; content: string; createdAt: string };
type Notification = { id: string; type: string; payload: { taskId?: string; reportId?: string; chatId?: string; status?: string }; isRead: boolean; createdAt: string };

function displayUser(user: User): User {
  return user.email === 'admin@vospitanie.local' ? { ...user, fullName: 'Елена Юрьевна' } : user;
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (DEMO) return demoApi<T>(path, options);
  const token = localStorage.getItem('vospitanie_token');
  const isFormData = options.body instanceof FormData;
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { ...(isFormData ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? 'Ошибка запроса');
  return data;
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function loadTasks() {
    const result = await api<{ tasks: Task[] }>('/tasks');
    setTasks(result.tasks);
  }

  useEffect(() => {
    void (async () => {
      if (!localStorage.getItem('vospitanie_token')) { setLoading(false); return; }
      try {
        const result = await api<{ user: User }>('/auth/me');
        setUser(displayUser(result.user));
        await loadTasks();
      } catch { localStorage.removeItem('vospitanie_token'); }
      setLoading(false);
    })();
  }, []);

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    try {
      const body = Object.fromEntries(new FormData(event.currentTarget).entries());
      const endpoint = authMode === 'login' ? 'login' : 'register';
      const result = await api<{ token: string; user: User }>(`/auth/${endpoint}`, { method: 'POST', body: JSON.stringify(body) });
      localStorage.setItem('vospitanie_token', result.token);
      setUser(displayUser(result.user));
      await loadTasks();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось выполнить вход'); }
  }

  if (loading) return <div className="loading">Загрузка платформы...</div>;
  if (!user) return <AuthScreen mode={authMode} setMode={setAuthMode} error={error} onSubmit={authenticate} />;
  return <Dashboard user={user} tasks={tasks} error={error} setError={setError} onRefresh={loadTasks} onLogout={() => { localStorage.removeItem('vospitanie_token'); setUser(null); setTasks([]); }} />;
}

function AuthScreen({ mode, setMode, error, onSubmit }: { mode: 'login' | 'register'; setMode: (value: 'login' | 'register') => void; error: string; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <main className="auth-layout">
    <section className="auth-intro"><p className="eyebrow">Воспитание.Про</p><h1>Работа советника в одном пространстве.</h1><p>Задания, отчёты, материалы и профессиональное общение без лишних таблиц и переписок.</p></section>
    <form className="panel auth-form" onSubmit={onSubmit}>
      <h2>{mode === 'login' ? 'С возвращением' : 'Создать аккаунт'}</h2>
      <p className="muted">{DEMO ? 'Публичная демоверсия: данные хранятся только в вашем браузере. Войдите как admin@vospitanie.local или advisor@vospitanie.local без пароля.' : mode === 'login' ? 'Войдите, чтобы увидеть свои задания.' : 'Заполните данные для регистрации.'}</p>
      {mode === 'register' && <label>ФИО<input name="fullName" required minLength={2} /></label>}
      <label>Email<input name="email" type="email" required /></label>
      {mode === 'register' ? <label>Пароль<input name="password" type="password" required minLength={8} /></label> : <label>Пароль <span className="demo-hint">в демо-режиме можно оставить пустым</span><input name="password" type="password" /></label>}
      {error && <p className="error">{error}</p>}
      <button type="submit">{mode === 'login' ? 'Войти' : 'Зарегистрироваться'}</button>
      <button type="button" className="link-button" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? 'Создать аккаунт' : 'У меня уже есть аккаунт'}</button>
    </form>
  </main>;
}

function Dashboard({ user, tasks, error, setError, onLogout, onRefresh }: { user: User; tasks: Task[]; error: string; setError: (value: string) => void; onLogout: () => void; onRefresh: () => Promise<void> }) {
  const [showCreate, setShowCreate] = useState(false);
  const [reportTask, setReportTask] = useState<Task | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const canManage = user.role === 'COORDINATOR' || user.role === 'ADMIN';

  async function loadReports() {
    try { setReports((await api<{ reports: Report[] }>('/reports')).reports); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось загрузить отчёты'); }
  }
  useEffect(() => { void loadReports(); }, []);

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api('/tasks', { method: 'POST', body: JSON.stringify({ title: form.get('title'), description: form.get('description'), deadline: form.get('deadline') ? new Date(String(form.get('deadline'))).toISOString() : undefined, priority: Number(form.get('priority')), targetScope: 'all' }) });
      setShowCreate(false);
      await onRefresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось создать задание'); }
  }

  async function updateStatus(taskId: string, status: string) {
    try { await api(`/tasks/${taskId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }); await onRefresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось изменить статус'); }
  }

  async function saveReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reportTask) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const form = new FormData(event.currentTarget);
    try {
      const result = await api<{ report: Report }>('/reports', { method: 'POST', body: JSON.stringify({ taskId: reportTask.id, content: form.get('content'), studentCount: form.get('studentCount') || undefined, reportingPeriod: form.get('reportingPeriod') || undefined, submit: submitter?.value === 'submit' }) });
      const files = form.getAll('files').filter((item): item is File => item instanceof File && item.size > 0);
      if (files.length && !DEMO) { const payload = new FormData(); files.forEach((file) => payload.append('files', file)); await api(`/reports/${result.report.id}/files`, { method: 'POST', body: payload }); }
      setReportTask(null);
      await Promise.all([onRefresh(), loadReports()]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось сохранить отчёт'); }
  }

  async function reviewReport(id: string, status: 'REVIEWED' | 'DRAFT') {
    try { await api(`/reports/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }); await Promise.all([onRefresh(), loadReports()]); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось проверить отчёт'); }
  }

  return <main className="app-shell">
    <header className="topbar"><div><p className="eyebrow">Воспитание.Про</p><strong>Рабочее пространство</strong></div><div className="user-menu"><span>{user.fullName}<small>{user.role}</small></span><button className="ghost" onClick={onLogout}>Выйти</button></div></header>
    <section className="dashboard-head"><div><p className="kicker">Личный кабинет</p><h1>Здравствуйте, {user.fullName}</h1><p className="muted">Здесь собраны актуальные задания и рабочие материалы.</p></div>{canManage && <button onClick={() => setShowCreate(true)}>+ Новое задание</button>}</section>
    {error && <div className="error-banner">{error}<button className="ghost" onClick={() => setError('')}>Закрыть</button></div>}
    <section className="stats"><div><span>Всего заданий</span><strong>{tasks.length}</strong></div><div><span>Отчётов</span><strong>{reports.length}</strong></div><div><span>Новых</span><strong>{tasks.filter((task) => task.status === 'NEW').length}</strong></div></section>
    <Notifications onError={setError} />
    <section className="section-heading"><h2>Задания</h2><button className="ghost" onClick={() => void onRefresh()}>Обновить</button></section>
    <div className="task-list">{tasks.length === 0 ? <div className="empty panel"><strong>Заданий пока нет</strong><span>Новые задания появятся здесь.</span></div> : tasks.map((task) => <TaskCard key={task.id} task={task} canManage={canManage} onStatus={updateStatus} onReport={setReportTask} />)}</div>
    <section className="section-heading reports-heading"><h2>{canManage ? 'Отчёты советников' : 'Мои отчёты'}</h2></section>
    <div className="report-list">{reports.map((report) => <article className="report-row" key={report.id}><div><span className="status">{report.status}</span><h3>{report.task.title}</h3>{report.studentCount !== undefined && <strong className="report-metric">Обучающихся: {report.studentCount.toLocaleString('ru-RU')}</strong>}<p>{report.content}</p></div>{canManage && report.status === 'SUBMITTED' && <div className="review-actions"><button className="small-button" onClick={() => void reviewReport(report.id, 'REVIEWED')}>Принять</button><button className="danger-button" onClick={() => void reviewReport(report.id, 'DRAFT')}>Вернуть</button></div>}</article>)}</div>
    <ChatPanel user={user} onError={setError} />
    {user.role === 'ADMIN' && <AdminPanel onError={setError} />}
    {showCreate && <Modal onClose={() => setShowCreate(false)}><form className="modal-form" onSubmit={createTask}><h2>Новое задание</h2><label>Название<input name="title" required minLength={2} /></label><label>Описание<textarea name="description" required rows={5} /></label><label>Дедлайн<input name="deadline" type="datetime-local" /></label><label>Приоритет<select name="priority" defaultValue="0"><option value="0">Обычный</option><option value="1">Высокий</option><option value="2">Срочный</option></select></label><button type="submit">Создать задание</button></form></Modal>}
    {reportTask && <Modal onClose={() => setReportTask(null)}><form className="modal-form" onSubmit={saveReport}><h2>Форма отчёта</h2><p className="muted">{reportTask.title}</p><div className="report-fields"><label>Количество обучающихся<input name="studentCount" type="number" min="0" max="100000" required placeholder="Например, 438" /></label><label>Отчётный период<input name="reportingPeriod" placeholder="Например, на 1 сентября 2026 года" /></label></div><label>Пояснение и источник данных<textarea name="content" required minLength={2} rows={6} placeholder="Укажите источник данных, дату и дополнительные сведения" defaultValue={reports.find((report) => report.taskId === reportTask.id)?.content ?? ''} /></label><label>Вложения<input name="files" type="file" multiple accept=".pdf,.docx,.xlsx,.jpg,.jpeg,.png" /></label><small className="muted">До 5 файлов, каждый не более 10 МБ.</small><div className="modal-actions"><button type="submit" name="intent" value="draft" className="secondary-button">Сохранить черновик</button><button type="submit" name="intent" value="submit">Отправить</button></div></form></Modal>}
  </main>;
}

function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return <div className="modal-backdrop"><div className="panel modal"><button type="button" className="close" onClick={onClose}>×</button>{children}</div></div>;
}

function TaskCard({ task, canManage, onStatus, onReport }: { task: Task; canManage: boolean; onStatus: (id: string, status: string) => Promise<void>; onReport: (task: Task) => void }) {
  const labels: Record<string, string> = { NEW: 'Новое', IN_PROGRESS: 'В работе', REVIEW: 'На проверке', ACCEPTED: 'Принято', REJECTED: 'Отклонено' };
  const status = task.assignments?.[0]?.status ?? task.status;
  return <article className="task-card">
    <div className="task-top"><span className={`status status-${status.toLowerCase()}`}>{labels[status] ?? status}</span>{task.deadline && <time>до {new Date(task.deadline).toLocaleDateString('ru-RU')}</time>}</div>
    <h3>{task.title}</h3><p>{task.description}</p>
    <div className="task-bottom"><small>{task.priority > 0 ? 'Приоритетное' : 'Стандартное'} · {task.targetScope === 'all' ? 'Для всех' : task.targetScope}</small>
      {!canManage && status !== 'ACCEPTED' && <div className="inline-actions">
        {status === 'NEW' && <button className="small-button" onClick={() => void onStatus(task.id, 'IN_PROGRESS')}>Взять в работу</button>}
        <button className="small-button" onClick={() => onReport(task)}>{status === 'REVIEW' ? 'Исправить отчёт' : status === 'REJECTED' ? 'Доработать отчёт' : 'Заполнить отчёт'}</button>
      </div>}
    </div>
  </article>;
}

function Notifications({ onError }: { onError: (value: string) => void }) {
  const [items, setItems] = useState<Notification[]>([]);
  async function refresh() {
    try { setItems((await api<{ notifications: Notification[] }>('/notifications')).notifications); }
    catch (reason) { onError(reason instanceof Error ? reason.message : 'Не удалось загрузить уведомления'); }
  }
  useEffect(() => { void refresh(); }, []);
  async function markRead(id: string) {
    try { await api(`/notifications/${id}/read`, { method: 'PATCH' }); await refresh(); }
    catch (reason) { onError(reason instanceof Error ? reason.message : 'Не удалось прочитать уведомление'); }
  }
  const text = (item: Notification) => item.type === 'TASK_ASSIGNED' ? 'Вам назначено задание' : item.type === 'REPORT_REVIEWED' ? (item.payload.status === 'REVIEWED' ? 'Отчёт принят' : 'Отчёт возвращён на доработку') : 'Новое сообщение';
  return <section className="notifications"><div className="section-heading"><h2>Уведомления {items.some((item) => !item.isRead) && '•'}</h2><button className="ghost" onClick={() => void refresh()}>Обновить</button></div><div className="notification-list">{items.filter((item) => !item.isRead).map((item) => <div className="notification-row" key={item.id}><span>{text(item)}</span><button className="ghost" onClick={() => void markRead(item.id)}>Прочитано</button></div>)}</div></section>;
}

function AdminPanel({ onError }: { onError: (value: string) => void }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  async function loadUsers() {
    try { setUsers((await api<{ users: AdminUser[] }>('/admin/users')).users); }
    catch (reason) { onError(reason instanceof Error ? reason.message : 'Не удалось загрузить пользователей'); }
  }
  useEffect(() => { void loadUsers(); }, []);
  async function updateUser(id: string, changes: Partial<Pick<AdminUser, 'role' | 'isActive'>>) {
    try { await api(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(changes) }); await loadUsers(); }
    catch (reason) { onError(reason instanceof Error ? reason.message : 'Не удалось обновить пользователя'); }
  }
  return <section className="admin-section"><div className="section-heading"><h2>Управление пользователями</h2><button className="ghost" onClick={() => void loadUsers()}>Обновить</button></div><div className="users-table">{users.map((item) => <div className="user-row" key={item.id}><div><strong>{item.fullName}</strong><small>{item.email}</small></div><select aria-label={`Роль ${item.fullName}`} value={item.role} onChange={(event) => void updateUser(item.id, { role: event.target.value })}><option value="USER">Советник</option><option value="MODERATOR">Модератор</option><option value="COORDINATOR">Координатор</option><option value="ADMIN">Администратор</option></select><button className={item.isActive ? 'danger-button' : 'small-button'} onClick={() => void updateUser(item.id, { isActive: !item.isActive })}>{item.isActive ? 'Заблокировать' : 'Разблокировать'}</button></div>)}</div></section>;
}

function ChatPanel({ user, onError }: { user: User; onError: (value: string) => void }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [socket, setSocket] = useState<Socket | null>(null);

  async function refreshChats() {
    try { setChats((await api<{ chats: Chat[] }>('/chats')).chats); }
    catch (reason) { onError(reason instanceof Error ? reason.message : 'Не удалось загрузить чаты'); }
  }
  async function refreshMessages(id: string) {
    try { setMessages((await api<{ messages: Message[] }>(`/chats/${id}/messages`)).messages); }
    catch (reason) { onError(reason instanceof Error ? reason.message : 'Не удалось загрузить сообщения'); }
  }
  useEffect(() => {
    const connection = DEMO ? null : io(API_URL.replace(/\/api$/, ''), { auth: { token: localStorage.getItem('vospitanie_token') } });
    if (connection) {
      setSocket(connection);
      connection.on('connect_error', () => onError('Realtime-чат недоступен, используйте обновление'));
      connection.on('chat:message', (message: Message) => setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message]));
    }
    void refreshChats();
    void api<{ users: Contact[] }>('/auth/directory').then((result) => setContacts(result.users)).catch(() => onError('Не удалось загрузить контакты'));
    return () => { connection?.disconnect(); };
  }, []);

  async function startChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const userId = new FormData(event.currentTarget).get('userId');
    if (!userId) return;
    try {
      const { chat } = await api<{ chat: Chat }>('/chats', { method: 'POST', body: JSON.stringify({ userId }) });
      setSelected(chat.id);
      socket?.emit('chat:join', chat.id);
      await Promise.all([refreshChats(), refreshMessages(chat.id)]);
    } catch (reason) { onError(reason instanceof Error ? reason.message : 'Не удалось открыть чат'); }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = event.currentTarget;
    const content = new FormData(form).get('content');
    try {
      if (socket?.connected) {
        await new Promise<void>((resolve, reject) => socket.emit('chat:message', { chatId: selected, content }, (result: { ok: boolean; error?: string }) => result.ok ? resolve() : reject(new Error(result.error))));
      } else {
        await api(`/chats/${selected}/messages`, { method: 'POST', body: JSON.stringify({ content }) });
      }
      form.reset();
      await Promise.all([refreshMessages(selected), refreshChats()]);
    } catch (reason) { onError(reason instanceof Error ? reason.message : 'Не удалось отправить сообщение'); }
  }

  return <section className="chat-section"><div className="section-heading"><h2>Сообщения</h2><button className="ghost" onClick={() => { void refreshChats(); if (selected) void refreshMessages(selected); }}>Обновить</button></div><div className="chat-layout"><aside className="chat-sidebar"><form onSubmit={startChat}><select name="userId" defaultValue="" aria-label="Собеседник"><option value="" disabled>Выберите собеседника</option>{contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.fullName}</option>)}</select><button type="submit">Новый чат</button></form>{chats.map((chat) => <button type="button" className={`chat-link ${selected === chat.id ? 'active' : ''}`} key={chat.id} onClick={() => { setSelected(chat.id); socket?.emit('chat:join', chat.id); void refreshMessages(chat.id); }}>{chat.members.find((member) => member.user.id !== user.id)?.user.fullName ?? 'Диалог'}</button>)}</aside><div className="chat-body">{selected ? <><div className="message-list">{messages.map((message) => <p key={message.id} className={`message ${message.senderId === user.id ? 'mine' : ''}`}>{message.content}</p>)}</div><form className="message-form" onSubmit={sendMessage}><input name="content" required maxLength={4000} placeholder="Напишите сообщение" /><button type="submit">Отправить</button></form></> : <p className="muted">Выберите диалог или начните новый.</p>}</div></div></section>;
}

createRoot(document.getElementById('root')!).render(<App />);
