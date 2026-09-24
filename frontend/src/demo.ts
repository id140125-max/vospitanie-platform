// Автономная демонстрация GitHub Pages: данные остаются только в браузере.
const KEY = 'vospitanie_public_demo_v1';

type User = { id: string; email: string; fullName: string; role: string; isActive: boolean };
type Task = { id: string; title: string; description: string; status: string; priority: number; targetScope: string; deadline?: string; assignments: { userId: string; status: string }[] };
type Report = { id: string; taskId: string; userId: string; content: string; studentCount?: number; reportingPeriod?: string; status: string; task: { id: string; title: string } };
type Chat = { id: string; members: { user: User }[]; messages: Message[] };
type Message = { id: string; chatId: string; senderId: string; content: string; createdAt: string };
type State = { users: User[]; tasks: Task[]; reports: Report[]; chats: Chat[]; messages: Message[] };

function initialState(): State {
  return {
    users: [
      { id: 'demo-admin', email: 'admin@vospitanie.local', fullName: 'Елена Юрьевна', role: 'ADMIN', isActive: true },
      { id: 'demo-advisor', email: 'advisor@vospitanie.local', fullName: 'Тестовый советник', role: 'USER', isActive: true },
    ],
    tasks: [{ id: 'demo-children-count', title: 'Сбор данных о количестве детей в школе', description: 'Укажите фактическое количество обучающихся в образовательной организации на отчётную дату. В пояснении укажите источник данных и особенности подсчёта.', status: 'NEW', priority: 1, targetScope: 'all', assignments: [] }],
    reports: [], chats: [], messages: [],
  };
}

function load(): State {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '') as State; }
  catch { const state = initialState(); save(state); return state; }
}

function save(state: State) { localStorage.setItem(KEY, JSON.stringify(state)); }
function id() { return crypto.randomUUID(); }
function body(options: RequestInit) { return JSON.parse(String(options.body ?? '{}')) as Record<string, unknown>; }
function currentUser(state: State): User {
  const user = state.users.find((item) => item.id === localStorage.getItem('vospitanie_token') && item.isActive);
  if (!user) throw new Error('Войдите в демо-аккаунт');
  return user;
}
function otherMembers(state: State, chat: Chat) {
  chat.members = chat.members.map((member) => ({ user: state.users.find((user) => user.id === member.user.id) ?? member.user }));
  return chat;
}

export async function demoApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  const state = load();
  const method = options.method ?? 'GET';
  const payload = options.body instanceof FormData ? {} : body(options);
  const user = path === '/auth/login' || path === '/auth/register' ? null : currentUser(state);
  let result: unknown;

  if (path === '/auth/login' || path === '/auth/register') {
    const email = String(payload.email ?? '').toLowerCase();
    let account = state.users.find((item) => item.email === email);
    if (path === '/auth/register') {
      if (account) throw new Error('Этот email уже зарегистрирован');
      account = { id: id(), email, fullName: String(payload.fullName ?? 'Советник'), role: 'USER', isActive: true };
      state.users.push(account);
    }
    if (!account?.isActive) throw new Error('Пользователь не найден');
    result = { token: account.id, user: account };
  } else if (path === '/auth/me') result = { user };
  else if (path === '/auth/directory') result = { users: state.users.filter((item) => item.id !== user!.id && item.isActive) };
  else if (path === '/tasks' && method === 'GET') {
    result = { tasks: state.tasks.map((task) => ({ ...task, assignments: user!.role === 'USER' ? task.assignments.filter((assignment) => assignment.userId === user!.id) : task.assignments })) };
  } else if (path === '/tasks' && method === 'POST') {
    if (!['ADMIN', 'COORDINATOR'].includes(user!.role)) throw new Error('Недостаточно прав');
    const task = { id: id(), title: String(payload.title), description: String(payload.description), status: 'NEW', priority: Number(payload.priority ?? 0), targetScope: 'all', deadline: payload.deadline ? String(payload.deadline) : undefined, assignments: [] };
    state.tasks.unshift(task); result = { task };
  } else if (/^\/tasks\/[^/]+\/status$/.test(path)) {
    const task = state.tasks.find((item) => item.id === path.split('/')[2]);
    if (!task) throw new Error('Задание не найдено');
    const assignment = task.assignments.find((item) => item.userId === user!.id);
    if (assignment) assignment.status = String(payload.status);
    else task.assignments.push({ userId: user!.id, status: String(payload.status) });
    result = { task };
  } else if (path === '/reports' && method === 'GET') {
    result = { reports: state.reports.filter((report) => user!.role !== 'USER' || report.userId === user!.id) };
  } else if (path === '/reports' && method === 'POST') {
    const taskId = String(payload.taskId);
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error('Задание не найдено');
    let report = state.reports.find((item) => item.taskId === taskId && item.userId === user!.id);
    const values = { content: String(payload.content), studentCount: payload.studentCount === undefined ? undefined : Number(payload.studentCount), reportingPeriod: payload.reportingPeriod ? String(payload.reportingPeriod) : undefined, status: payload.submit ? 'SUBMITTED' : 'DRAFT' };
    if (report) Object.assign(report, values);
    else { report = { id: id(), taskId, userId: user!.id, task: { id: task.id, title: task.title }, ...values }; state.reports.unshift(report); }
    const assignment = task.assignments.find((item) => item.userId === user!.id);
    if (assignment) assignment.status = payload.submit ? 'REVIEW' : 'IN_PROGRESS';
    else task.assignments.push({ userId: user!.id, status: payload.submit ? 'REVIEW' : 'IN_PROGRESS' });
    result = { report };
  } else if (/^\/reports\/[^/]+\/status$/.test(path)) {
    if (!['ADMIN', 'COORDINATOR'].includes(user!.role)) throw new Error('Недостаточно прав');
    const report = state.reports.find((item) => item.id === path.split('/')[2]);
    if (!report) throw new Error('Отчёт не найден');
    report.status = String(payload.status);
    const assignment = state.tasks.find((item) => item.id === report.taskId)?.assignments.find((item) => item.userId === report.userId);
    if (assignment) assignment.status = report.status === 'REVIEWED' ? 'ACCEPTED' : 'REJECTED';
    result = { report };
  } else if (/^\/reports\/[^/]+\/files$/.test(path)) {
    result = { count: 0 };
  } else if (path === '/notifications') result = { notifications: [] };
  else if (path === '/admin/users' && user!.role === 'ADMIN') result = { users: state.users };
  else if (/^\/admin\/users\/[^/]+$/.test(path) && user!.role === 'ADMIN') {
    const account = state.users.find((item) => item.id === path.split('/')[3]);
    if (!account) throw new Error('Пользователь не найден');
    if (account.id === user!.id && (payload.isActive === false || (payload.role && payload.role !== 'ADMIN'))) throw new Error('Нельзя заблокировать себя');
    Object.assign(account, payload); result = { user: account };
  } else if (path === '/chats' && method === 'GET') result = { chats: state.chats.filter((chat) => chat.members.some((member) => member.user.id === user!.id)).map((chat) => otherMembers(state, chat)) };
  else if (path === '/chats' && method === 'POST') {
    const partner = state.users.find((item) => item.id === payload.userId && item.isActive);
    if (!partner || partner.id === user!.id) throw new Error('Выберите собеседника');
    let chat = state.chats.find((item) => item.members.some((member) => member.user.id === partner.id) && item.members.some((member) => member.user.id === user!.id));
    if (!chat) { chat = { id: id(), members: [{ user: user! }, { user: partner }], messages: [] }; state.chats.push(chat); }
    result = { chat };
  } else if (/^\/chats\/[^/]+\/messages$/.test(path)) {
    const chatId = path.split('/')[2];
    if (!state.chats.some((chat) => chat.id === chatId && chat.members.some((member) => member.user.id === user!.id))) throw new Error('Чат не найден');
    if (method === 'GET') result = { messages: state.messages.filter((message) => message.chatId === chatId) };
    else { const message = { id: id(), chatId, senderId: user!.id, content: String(payload.content ?? ''), createdAt: new Date().toISOString() }; state.messages.push(message); result = { message }; }
  } else throw new Error('Эта функция недоступна в демоверсии');

  save(state);
  return result as T;
}
