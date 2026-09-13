import { backend, getAccessToken, isCloudConfigured } from './backend.js';
import { STEP_LIMITS, classifyTaskType, validateStepPolicy } from '../task-decomposition-policy.js';
import { planForTask as fallbackPlanForTask } from '../task-decomposition-fallback.js';

const STORAGE_KEY = 'focusline.workspace.v1';
const cacheKey = (userId) => `focusline.workspace.cache.${userId}`;
const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const esc = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

const seedTask = { id: 'task-ml-report', title: 'Machine Learning Report', description: 'Coursework report and presentation based on a self-selected dataset.', status: 'in_progress', activePlan: [ ['Find dataset', 'completed'], ['Clean dataset', 'completed'], ['Explore data', 'pending'], ['Compare models', 'pending'], ['Write report', 'pending'] ].map(([title, status], order) => ({ id: `step-${order + 1}`, title, description: '', status, order, dependencies: [], completedAt: status === 'completed' ? now() : null })), currentStepId: 'step-3', context: { lastAction: 'Reviewed the seasonality notes and narrowed the model options.', whatWasDone: ['Cleaned monthly temperature data', 'Confirmed seasonality', 'Tested stationarity'], whatWasBeingConsidered: 'Whether SARIMA or a simple seasonal baseline is more appropriate.', nextIntendedAction: 'Compare two candidate models against the baseline.', relevantFiles: ['temperature-monthly.csv', 'notebook-models.ipynb'], notes: '' }, events: [], createdAt: now(), updatedAt: now() };
const defaults = { tasks: [seedTask], todos: [{ id: 'todo-1', title: 'Reply to email', completed: false }, { id: 'todo-2', title: 'Buy groceries', completed: false }], selectedTaskId: seedTask.id, view: 'home', language: 'en', panel: null };
let state = structuredClone(defaults); let session = null; let saveTimer = null; let decompositionBusy = false;
state.todos ||= []; state.view = 'home'; state.panel = null;
const saveLocalPreview = () => { if (session?.user?.id) localStorage.setItem(cacheKey(session.user.id), JSON.stringify(state)); };
const save = () => {
  saveLocalPreview();
  if (!session?.user?.id) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => { try { await backend.saveWorkspace(session.user.id, state); } catch (error) { showToast(error.message); } }, 120);
};
const task = () => state.tasks.find((item) => item.id === state.selectedTaskId) || state.tasks[0];
const log = (item, type, detail) => { item.events ||= []; item.events.unshift({ id: uid(), type, detail, at: now() }); item.updatedAt = now(); };
const orderedSteps = (item) => [...(item.activePlan || [])].sort((a, b) => Number(a.status === 'completed') - Number(b.status === 'completed') || a.order - b.order);
const nextStep = (item) => orderedSteps(item).find((step) => step.status !== 'completed');
const copy = {
  en: { todoList: 'TODO LIST', todoTitle: 'Things to handle', add: 'Add', openTasks: 'OPEN TASKS', threads: 'Threads in motion', capture: 'Capture', cognitive: 'COGNITIVE WORKSPACE', encouragement: 'You can do it!', support: 'One small thing in front of you. The rest stays held.', captureTitle: 'Put the messy version here.', captureDescription: 'We will turn it into a task you can review and shape.', capturePlaceholder: 'Paste an assignment, email, rough thought, or project requirement...', decompress: 'Decompress', voice: 'Voice input', task: 'TASK', resume: 'Resume', complete: 'Complete', ready: 'Ready to complete', detail: 'TASK DETAIL', home: 'Home', context: 'Context', myPlan: 'MY PLAN', addItem: 'Add item', completed: 'COMPLETED', progressHistory: 'kept as progress history', back: 'Back to overview', markComplete: 'Mark task complete', savedContext: 'SAVED CONTEXT', resumeWithout: 'Resume without remembering.', was: 'I was', nextAction: 'Next intended action', already: 'Already completed', closeContext: 'Close context', emptyTodo: 'Nothing waiting here.', emptyTasks: 'No open tasks. Capture what is next.', newTodo: 'New todo', newStep: 'New step', placeholderTodo: 'Todo title', placeholderStep: 'Step title', login: 'Log in', register: 'Create account', logout: 'Log out', email: 'Email', password: 'Password', authTitle: 'Your workspace, wherever you are.', authSubtitle: 'Sign in to keep your tasks synced across devices.', authSubmitLogin: 'Log in', authSubmitRegister: 'Create account', switchToRegister: 'Need an account? Create one', switchToLogin: 'Already have an account? Log in', localMode: 'Local preview mode', cloudMode: 'Cloud sync enabled', signedInAs: 'Signed in as', authError: 'Something went wrong. Please try again.' },
  zh: { todoList: '待办事项', todoTitle: '今天要处理', add: '添加', openTasks: '进行中的任务', threads: '正在进行', capture: '记录', cognitive: '认知工作空间', encouragement: '今天也要加油哦！', support: '先专注眼前的一件事，其余交给我保管。', captureTitle: '把混乱的想法放在这里。', captureDescription: '我会把它整理成你可以查看和调整的任务。', capturePlaceholder: '粘贴作业、邮件、零散想法或项目要求……', decompress: '开始拆解', voice: '语音输入', task: '任务', resume: '继续', complete: '完成', ready: '可以完成了', detail: '任务详情', home: '首页', context: '上下文', myPlan: '我的计划', addItem: '添加步骤', completed: '已完成', progressHistory: '项，作为进度记录保留', back: '返回首页', markComplete: '完成整个任务', savedContext: '已保存的上下文', resumeWithout: '回来时，不必重新回忆。', was: '上次进行到', nextAction: '接下来准备做', already: '已经完成', closeContext: '关闭上下文', emptyTodo: '这里暂时没有待办。', emptyTasks: '还没有进行中的任务，记录下一件事吧。', newTodo: '新待办', newStep: '新步骤', placeholderTodo: '待办内容', placeholderStep: '步骤名称', login: '登录', register: '注册账号', logout: '退出登录', email: '邮箱', password: '密码', authTitle: '随时随地回到你的工作空间。', authSubtitle: '登录后，任务会在不同设备间自动同步。', authSubmitLogin: '登录', authSubmitRegister: '创建账号', switchToRegister: '还没有账号？注册一个', switchToLogin: '已经有账号？直接登录', localMode: '本地预览模式', cloudMode: '云端同步已开启', signedInAs: '当前账号', authError: '出了点问题，请重试。' }
};
const t = (key) => (copy[state.language] || copy.en)[key] || copy.en[key] || key;
let authMode = 'login'; let authBusy = false; let toastTimer; let editingTodoId = null; let todoStartTimer = null;
function showToast(message) { const node = document.querySelector('#toast'); if (!node) return; node.textContent = message; node.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove('visible'), 3600); }
const brand = () => `<div class="brand"><img class="brand-logo" src="/exhalation.png" alt=""><span class="wordmark">Exhalation</span></div>`;
function authView() { return `<main class="page auth-page"><div class="auth-shell">${brand()}<span class="kicker">${t('cognitive')}</span><h1>${t('authTitle')}</h1><p>${t('authSubtitle')}</p><form class="auth-form" data-action="auth-submit"><label>${t('email')}<input name="email" type="email" autocomplete="email" required placeholder="you@example.com"></label><label>${t('password')}<input name="password" type="password" autocomplete="${authMode === 'login' ? 'current-password' : 'new-password'}" minlength="6" required></label><button class="primary-button full" type="submit" ${authBusy ? 'disabled' : ''}>${authBusy ? '...' : (authMode === 'login' ? t('authSubmitLogin') : t('authSubmitRegister'))}</button></form><button class="text-button auth-switch" data-action="auth-mode">${authMode === 'login' ? t('switchToRegister') : t('switchToLogin')}</button><small>${isCloudConfigured ? t('cloudMode') : t('localMode')}</small></div></main>`; }
function createSimpleTask(title) { const plan = planForTask(title); const item = { id: uid(), title, description: '', status: 'in_progress', activePlan: plan.map((step, order) => ({ id: uid(), title: step, description: '', status: 'pending', order, dependencies: [], completedAt: null })), currentStepId: null, context: { lastAction: '', whatWasDone: [], whatWasBeingConsidered: '', nextIntendedAction: '', relevantFiles: [], notes: '' }, events: [], createdAt: now(), updatedAt: now() }; item.currentStepId = item.activePlan[0]?.id || null; state.tasks.push(item); return item; }
function taskForTodo(todo) { return state.tasks.find((item) => item.id === todo.taskId); }
function syncTodoTask(todo, previousTitle = null) {
  let linked = taskForTodo(todo);
  if (!linked) {
    linked = state.tasks.find((item) => item.title === (previousTitle || todo.title));
    if (!linked) return null;
    todo.taskId = linked.id;
  }
  if (previousTitle !== null && linked.title === previousTitle) {
    linked.title = todo.title;
    if (linked.activePlan?.length === 1 && linked.activePlan[0].title === previousTitle) linked.activePlan[0].title = todo.title;
  }
  // Older Todo-linked tasks were created with a single placeholder step. Upgrade
  // those defaults once so they benefit from the same task-name decomposition.
  if (linked.activePlan?.length === 1 && linked.activePlan[0].title === linked.title && !linked.description) {
    const suggested = planForTask(linked.title);
    linked.activePlan = suggested.map((step, order) => ({ id: uid(), title: step, description: '', status: 'pending', order, dependencies: [], completedAt: null }));
    linked.currentStepId = linked.activePlan[0]?.id || null;
  }
  if (todo.completed) linked.status = 'completed';
  linked.updatedAt = now();
  return linked;
}
state.todos.forEach((todo) => { if (todo.taskId) syncTodoTask(todo); });
save();

function startTodo(todo) {
  let linked = taskForTodo(todo);
  if (!linked) {
    linked = createSimpleTask(todo.title);
    todo.taskId = linked.id;
  }
  linked.status = 'in_progress';
  linked.updatedAt = now();
  state.selectedTaskId = linked.id;
  save();
  render();
}

function beginTodoEdit(todoId) {
  clearTimeout(todoStartTimer);
  todoStartTimer = null;
  editingTodoId = todoId;
  render();
  setTimeout(() => {
    const input = document.querySelector(`[data-todo-input="${todoId}"]`);
    input?.focus();
    input?.select();
  }, 0);
}

function icon(name, size = 18) { const paths = { plus: '<path d="M12 5v14M5 12h14"/>', check: '<path d="m5 12 4 4L19 6"/>', back: '<path d="m15 18-6-6 6-6"/>', edit: '<path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z"/>', trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3"/>', mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8"/>', play: '<path d="m8 5 11 7-11 7V5Z"/>', spark: '<path d="m12 3-1.6 5.4L5 10l5.4 1.6L12 17l1.6-5.4L19 10l-5.4-1.6L12 3Z"/>', close: '<path d="M6 6l12 12M18 6 6 18"/>', dots: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>' }; return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`; }
const today = () => { const d = new Date(); return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`; };
function header() { return `<header class="home-header">${brand()}<div class="date">${today()}</div><div class="header-actions"><div class="language" role="group" aria-label="Language"><button class="${state.language === 'zh' ? 'selected' : ''}" data-action="language" data-language="zh">中</button><button class="${state.language === 'en' ? 'selected' : ''}" data-action="language" data-language="en">En</button></div><button class="logout-button" data-action="logout">${t('logout')}</button></div></header>`; }
function todoList() { const open = state.todos.filter((todo) => !todo.completed); return `<section class="home-column todo-column"><div class="column-heading"><div><span class="kicker">${t('todoList')}</span><h2>${t('todoTitle')}</h2></div><button class="outline-button" data-action="add-todo">${icon('plus', 16)} ${t('add')}</button></div><div class="todo-items">${open.length ? open.map((todo) => { const isEditing = editingTodoId === todo.id || !todo.title.trim(); return `<div class="todo-item"><button class="round-check" data-action="check-todo" data-todo-id="${todo.id}" aria-label="Complete ${esc(todo.title)}"></button>${isEditing ? `<input value="${esc(todo.title)}" data-todo-input="${todo.id}" aria-label="${t('placeholderTodo')}" placeholder="${t('placeholderTodo')}">` : `<button class="todo-title${todo.taskId ? ' started' : ''}" data-action="start-todo" data-todo-id="${todo.id}" title="${state.language === 'zh' ? '单击开始，双击重命名' : 'Click to start, double-click to rename'}">${esc(todo.title)}</button>`}</div>`; }).join('') : `<p class="empty-state">${t('emptyTodo')}</p>`}</div></section>`; }
function openTasks() { const open = state.tasks.filter((item) => item.status !== 'completed'); return `<section class="home-column tasks-column"><div class="column-heading"><div><span class="kicker">${t('openTasks')}</span><h2>${t('threads')}</h2></div><button class="primary-button" data-action="capture">${icon('plus', 16)} ${t('capture')}</button></div><div class="task-cards">${open.map((item) => { const next = nextStep(item); return `<article class="task-card"><div class="card-kicker">${t('task')}</div><h3>${esc(item.title)}</h3><p class="next-label">${next ? esc(next.title) : t('ready')}</p><div class="card-actions"><button class="primary-button" data-action="resume-task" data-task-id="${item.id}">${icon('play', 15)} ${t('resume')}</button><button class="secondary-button" data-action="complete-task" data-task-id="${item.id}">${t('complete')}</button></div></article>`; }).join('') || `<p class="empty-state">${t('emptyTasks')}</p>`}</div></section>`; }
function homeView() { return `<main class="page home-page">${header()}<div class="home-intro"><span class="kicker">${t('cognitive')}</span><h1>${t('encouragement')}</h1><p>${t('support')}</p><div class="capture-under-intro"><button class="primary-button" data-action="capture">${icon('plus', 16)} ${t('capture')}</button><span>${state.language === 'zh' ? '把复杂的事情交给我拆解。' : 'Give me the complicated version. I will break it down.'}</span></div></div><div class="home-grid">${todoList()}${openTasks()}</div></main>`; }
function detailView(item) { const steps = orderedSteps(item); return `<main class="page detail-page"><header class="detail-header"><button class="back-button" data-action="go-home">${icon('back', 18)} <span>${t('home')}</span></button><span class="kicker">${t('detail')}</span><button class="icon-button" data-action="open-panel" data-panel="context" title="${t('savedContext')}">${icon('dots')}</button></header><section class="detail-content"><div class="detail-title-row"><div><h1>${esc(item.title)}</h1><p>${esc(item.description || (state.language === 'zh' ? '按照适合你的方式调整这个任务。' : 'Shape this task in the way that works for you.'))}</p></div><button class="outline-button" data-action="capture">${icon('spark', 15)} ${t('capture')}</button></div><div class="detail-list-header"><span class="kicker">${t('myPlan')}</span><button class="text-button" data-action="add-step">${icon('plus', 15)} ${t('addItem')}</button></div><div class="subtodo-list">${steps.map((step) => `<div class="subtodo ${step.status === 'completed' ? 'completed' : ''}"><button class="round-check ${step.status === 'completed' ? 'checked' : ''}" data-action="toggle-step" data-step-id="${step.id}" aria-label="Toggle ${esc(step.title)}">${step.status === 'completed' ? icon('check', 14) : ''}</button><input value="${esc(step.title)}" data-step-input="${step.id}" aria-label="${t('placeholderStep')}"><button class="mini-icon" data-action="delete-step" data-step-id="${step.id}" title="Delete">${icon('trash', 15)}</button></div>`).join('')}</div><div class="completed-label"><span class="kicker">${t('completed')}</span><span>${steps.filter((step) => step.status === 'completed').length} ${t('progressHistory')}</span></div><div class="detail-footer"><button class="secondary-button" data-action="go-home">${t('back')}</button><button class="primary-button" data-action="complete-task" data-task-id="${item.id}">${t('markComplete')}</button></div></section></main>`; }
function capturePanel() { return `<div class="modal-backdrop"><section class="capture-modal"><button class="icon-button close-button" data-action="close-panel" aria-label="Close">${icon('close')}</button><span class="kicker">${t('capture')}</span><h2>${t('captureTitle')}</h2><p>${t('captureDescription')}</p><textarea id="capture-input" placeholder="${t('capturePlaceholder')}"></textarea><div class="capture-actions"><button class="text-button" data-action="voice">${icon('mic', 16)} ${t('voice')}</button><button class="primary-button" data-action="decompress">${t('decompress')} ${icon('play', 15)}</button></div></section></div>`; }
function contextPanel(item) { const context = item.context || {}; return `<aside class="side-panel"><div class="panel-top"><span class="kicker">${t('savedContext')}</span><button class="icon-button" data-action="close-panel">${icon('close')}</button></div><h2>${t('resumeWithout')}</h2><div class="context-block"><span>${t('was')}</span><p>${esc(context.lastAction || (state.language === 'zh' ? '还没有记录。' : 'No session note yet.'))}</p></div><div class="context-block"><span>${t('nextAction')}</span><p>${esc(context.nextIntendedAction || (state.language === 'zh' ? '选择下一个小行动。' : 'Choose the next small action.'))}</p></div><div class="context-block"><span>${t('already')}</span><ul>${(context.whatWasDone || []).map((entry) => `<li>${icon('check', 14)} ${esc(entry)}</li>`).join('') || `<li>${state.language === 'zh' ? '暂时没有。' : 'Nothing noted yet.'}</li>`}</ul></div><button class="primary-button full" data-action="close-panel">${t('closeContext')}</button></aside>`; }
function renderPanel(item) { if (state.panel === 'capture') return capturePanel(); if (state.panel === 'context') return contextPanel(item); return ''; }
function render() { const root = document.querySelector('#app'); if (!session) { root.innerHTML = `${authView()}<div id="toast" role="status"></div>`; return; } const item = task(); root.innerHTML = `${state.view === 'detail' ? detailView(item) : homeView()}${state.panel ? `<div class="panel-scrim"></div>${renderPanel(item)}` : ''}<div id="toast" role="status"></div>`; }
function planForTask(title, context = '') {
  return fallbackPlanForTask(title, context, state.language);
}
function decompress(text) { const clean = text.trim(); const title = clean.split(/[,.，。;；]/)[0].replace(/^(i need to|need to|老师说|please|帮我)/i, '').trim().slice(0, 70) || (state.language === 'zh' ? '未命名任务' : 'Untitled task'); const taskType = classifyTaskType(title, clean); const plan = planForTask(title, clean); return { title, description: clean, taskType, suggestedPlan: plan.map((step) => ({ id: uid(), title: step, description: '', estimatedMinutes: 25 })) }; }
async function decomposeWithLLM(text) {
  if (!isCloudConfigured) return null;
  const accessToken = await getAccessToken();
  if (!accessToken) return null;
  const response = await fetch('/api/decompose', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ text, language: state.language, source: 'capture', policyVersion: 'task-decomposition-v1' }) });
  if (!response.ok) return null;
  const result = await response.json();
  if (!result || !STEP_LIMITS[result.taskType] || typeof result.title !== 'string' || !result.title.trim() || !Array.isArray(result.subtasks)) return null;
  if (result.taskType !== classifyTaskType(result.title, text)) return null;
  const [minSteps, maxSteps] = STEP_LIMITS[result.taskType];
  if (result.subtasks.length < minSteps || result.subtasks.length > maxSteps) return null;
  const suggestedPlan = result.subtasks.map((step) => ({ key: typeof step.key === 'string' ? step.key : '', title: typeof step.title === 'string' ? step.title.trim() : '', description: typeof step.description === 'string' ? step.description.trim() : '', estimatedMinutes: Number.isInteger(step.estimatedMinutes) ? step.estimatedMinutes : null, dependencies: Array.isArray(step.dependencies) ? step.dependencies.filter((dependency) => typeof dependency === 'string') : [] }));
  if (suggestedPlan.some((step) => !step.title || validateStepPolicy(text, result.title, step.title, result.taskType))) return null;
  const keys = new Set(suggestedPlan.map((step) => step.key));
  if (keys.size !== suggestedPlan.length || keys.has('')) return null;
  if (suggestedPlan.some((step) => step.dependencies.some((dependency) => !keys.has(dependency) || dependency === step.key))) return null;
  const visiting = new Set(); const visited = new Set(); const byKey = new Map(suggestedPlan.map((step) => [step.key, step]));
  function visit(key) { if (visiting.has(key)) return false; if (visited.has(key)) return true; visiting.add(key); if (byKey.get(key).dependencies.some((dependency) => !visit(dependency))) return false; visiting.delete(key); visited.add(key); return true; }
  if (suggestedPlan.some((step) => !visit(step.key))) return null;
  return { title: result.title.trim(), description: typeof result.description === 'string' && result.description.trim() ? result.description.trim() : text.trim(), taskType: result.taskType, suggestedPlan };
}
async function decompose(text) { try { const llmPlan = await decomposeWithLLM(text); if (llmPlan) return llmPlan; } catch { /* Availability failures intentionally use the local plan. */ } return decompress(text); }
async function makeTask(text) { const info = await decompose(text); const plannedSteps = info.suggestedPlan.map((step) => ({ ...step, id: uid() })); const idByKey = new Map(plannedSteps.filter((step) => step.key).map((step) => [step.key, step.id])); const activePlan = plannedSteps.map((step, order) => ({ id: step.id, title: step.title, description: step.description || '', estimatedMinutes: step.estimatedMinutes || 25, status: 'pending', order, dependencies: (step.dependencies || []).map((key) => idByKey.get(key)).filter(Boolean), completedAt: null })); const item = { id: uid(), title: info.title, description: info.description, suggestedPlan: plannedSteps, status: 'in_progress', activePlan, currentStepId: activePlan[0]?.id || null, context: { lastAction: '', whatWasDone: [], whatWasBeingConsidered: '', nextIntendedAction: '', relevantFiles: [], notes: '' }, events: [], createdAt: now(), updatedAt: now() }; state.tasks.unshift(item); state.todos.push({ id: uid(), title: item.title, completed: false, taskId: item.id }); state.selectedTaskId = item.id; state.view = 'detail'; state.panel = null; save(); render(); }
document.addEventListener('click', async (eventTarget) => { const button = eventTarget.target.closest('[data-action]'); if (!button) return; const action = button.dataset.action; if (action === 'auth-mode') { authMode = authMode === 'login' ? 'register' : 'login'; render(); return; } if (action === 'logout') { clearTimeout(saveTimer); await backend.logout(); session = null; state = structuredClone(defaults); render(); return; } if (!session) return; const item = task(); if (action === 'language') { state.language = button.dataset.language; save(); render(); } if (action === 'capture') { state.panel = 'capture'; render(); } if (action === 'add-todo') { const id = uid(); const todo = { id, title: '', completed: false }; state.todos.push(todo); editingTodoId = id; save(); render(); setTimeout(() => document.querySelector(`[data-todo-input="${id}"]`)?.focus(), 0); } if (action === 'start-todo') { clearTimeout(todoStartTimer); const todoId = button.dataset.todoId; todoStartTimer = setTimeout(() => { const todo = state.todos.find((entry) => entry.id === todoId); if (todo?.title.trim()) startTodo(todo); todoStartTimer = null; }, 450); } if (action === 'close-panel') { state.panel = null; render(); } if (action === 'go-home') { state.view = 'home'; state.panel = null; save(); render(); } if (action === 'resume-task') { state.selectedTaskId = button.dataset.taskId; state.view = 'detail'; state.panel = null; save(); render(); } if (action === 'complete-task') { const target = state.tasks.find((entry) => entry.id === button.dataset.taskId); if (target) { target.status = 'completed'; const linkedTodo = state.todos.find((entry) => entry.taskId === target.id); if (linkedTodo) linkedTodo.completed = true; log(target, 'task_completed', 'Marked task complete'); state.selectedTaskId = state.tasks.find((entry) => entry.status !== 'completed')?.id || null; state.view = 'home'; state.panel = null; save(); render(); } } if (action === 'check-todo') { const todo = state.todos.find((entry) => entry.id === button.dataset.todoId); if (todo) { todo.completed = true; syncTodoTask(todo); save(); render(); } } if (action === 'toggle-step') { const step = item.activePlan.find((entry) => entry.id === button.dataset.stepId); if (step) { step.status = step.status === 'completed' ? 'pending' : 'completed'; step.completedAt = step.status === 'completed' ? now() : null; if (step.status === 'completed') log(item, 'step_completed', `Completed: ${step.title}`); item.activePlan = orderedSteps(item).map((entry, order) => ({ ...entry, order })); item.currentStepId = nextStep(item)?.id || null; save(); render(); } } if (action === 'delete-step') { item.activePlan = item.activePlan.filter((entry) => entry.id !== button.dataset.stepId).map((entry, order) => ({ ...entry, order })); item.currentStepId = nextStep(item)?.id || null; log(item, 'step_removed', 'Removed a step'); save(); render(); } if (action === 'add-step') { item.activePlan.push({ id: uid(), title: t('newStep'), description: '', status: 'pending', order: item.activePlan.length, dependencies: [], completedAt: null }); save(); render(); } if (action === 'open-panel') { state.panel = button.dataset.panel; render(); } if (action === 'voice') alert('Voice capture is reserved for a later version. Text capture is available now.'); if (action === 'decompress') { const input = document.querySelector('#capture-input'); if (input?.value.trim() && !decompositionBusy) { decompositionBusy = true; try { await makeTask(input.value); } finally { decompositionBusy = false; } } } });

document.addEventListener('dblclick', (eventTarget) => { const todoTitle = eventTarget.target.closest('[data-action="start-todo"]'); if (!todoTitle) return; eventTarget.preventDefault(); beginTodoEdit(todoTitle.dataset.todoId); });

document.addEventListener('submit', async (eventTarget) => { const form = eventTarget.target.closest('[data-action="auth-submit"]'); if (!form) return; eventTarget.preventDefault(); const data = new FormData(form); const email = String(data.get('email') || '').trim(); const password = String(data.get('password') || ''); authBusy = true; render(); try { const result = authMode === 'login' ? await backend.login(email, password) : await backend.register(email, password); if (result.needsEmailConfirmation) { authBusy = false; render(); showToast('Check your email to confirm your account, then log in.'); return; } session = result; const legacy = (() => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { return null; } })(); const remote = await backend.loadWorkspace(session.user.id); if ((!remote.tasks?.length && !remote.todos?.length) && hasLegacyWorkspace(legacy)) { state = legacy; state.view = 'home'; state.panel = null; await backend.saveWorkspace(session.user.id, state); } else state = remote; state.view = 'home'; state.panel = null; state.todos ||= []; state.tasks ||= []; saveLocalPreview(); authBusy = false; render(); } catch (error) { authBusy = false; render(); showToast(error.message || t('authError')); } });
document.addEventListener('change', (eventTarget) => { const input = eventTarget.target; if (input.matches('[data-todo-input]')) { const todo = state.todos.find((entry) => entry.id === input.dataset.todoInput); if (todo) { const value = input.value.trim(); if (!value) { state.todos = state.todos.filter((entry) => entry.id !== todo.id); editingTodoId = null; save(); render(); return; } const previousTitle = todo.title; todo.title = value; editingTodoId = null; syncTodoTask(todo, previousTitle); save(); render(); } } if (input.matches('[data-step-input]')) { const step = task().activePlan.find((entry) => entry.id === input.dataset.stepInput); if (step) { step.title = input.value.trim() || 'Untitled step'; task().updatedAt = now(); save(); } } });

function hasLegacyWorkspace(value) { return value && ((value.tasks || []).length || (value.todos || []).length); }
async function bootstrap() {
  try {
    const existing = await backend.getSession();
    if (existing?.user) {
      session = existing;
      const remote = await backend.loadWorkspace(session.user.id);
      const legacy = (() => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { return null; } })();
      if ((!remote.tasks?.length && !remote.todos?.length) && hasLegacyWorkspace(legacy)) {
        state = legacy; state.view = 'home'; state.panel = null; await backend.saveWorkspace(session.user.id, state);
      } else state = remote;
      state.view = 'home'; state.panel = null; state.todos ||= []; state.tasks ||= [];
      saveLocalPreview();
    }
  } catch (error) { showToast(error.message || 'Unable to restore your session.'); }
  render();
}
bootstrap();
