const SESSION_KEY = 'focusline.auth.session.v1';
const ACCOUNTS_KEY = 'focusline.auth.accounts.v1';
const WORKSPACE_PREFIX = 'focusline.workspace.user.';

import { createClient } from '@supabase/supabase-js';

const env = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {};
const supabaseUrl = env.VITE_SUPABASE_URL || globalThis.__FOCUSLINE_SUPABASE_URL || '';
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY || globalThis.__FOCUSLINE_SUPABASE_ANON_KEY || '';
const cloudEnabled = Boolean(supabaseUrl && supabaseAnonKey);

const json = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
const localId = () => crypto.randomUUID();
const localNow = () => new Date().toISOString();

async function supabaseRequest(path, options = {}, accessToken = '') {
  const headers = { apikey: supabaseAnonKey, 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const response = await fetch(`${supabaseUrl}${path}`, { ...options, headers });
  const body = await response.text();
  let parsed = null; try { parsed = body ? JSON.parse(body) : null; } catch { parsed = body; }
  if (!response.ok) throw new Error(parsed?.msg || parsed?.message || parsed?.error_description || parsed?.error || `Supabase request failed (${response.status})`);
  return parsed;
}

const isUuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
function normalizeWorkspaceIds(state) {
  const taskMap = new Map(); const stepMap = new Map(); const todoMap = new Map(); const eventMap = new Map();
  state.tasks ||= []; state.todos ||= [];
  state.tasks.forEach((item) => { if (!isUuid(item.id)) taskMap.set(item.id, localId()); });
  state.tasks.forEach((item) => { item.id = taskMap.get(item.id) || item.id; });
  state.tasks.forEach((item) => (item.activePlan || []).forEach((step) => { if (!isUuid(step.id)) stepMap.set(step.id, localId()); }));
  state.tasks.forEach((item) => (item.activePlan || []).forEach((step) => { step.id = stepMap.get(step.id) || step.id; }));
  state.todos.forEach((todo) => { if (!isUuid(todo.id)) todoMap.set(todo.id, localId()); });
  state.todos.forEach((todo) => { todo.id = todoMap.get(todo.id) || todo.id; todo.taskId = taskMap.get(todo.taskId) || todo.taskId || null; });
  state.tasks.forEach((item) => (item.events || []).forEach((event) => { if (!isUuid(event.id)) eventMap.set(event.id, localId()); event.id = eventMap.get(event.id) || event.id; }));
  state.tasks.forEach((item) => { item.currentStepId = stepMap.get(item.currentStepId) || item.currentStepId || null; });
  state.selectedTaskId = taskMap.get(state.selectedTaskId) || state.selectedTaskId || state.tasks[0]?.id || null;
  return state;
}

function localSession() { return json(SESSION_KEY, null); }
function localWorkspace(userId) { return json(`${WORKSPACE_PREFIX}${userId}`, null); }
function saveLocalWorkspace(userId, state) { write(`${WORKSPACE_PREFIX}${userId}`, state); }

function createLocalBackend() {
  const current = localSession();
  const seed = () => ({ tasks: [], todos: [], selectedTaskId: null, language: 'en' });
  return {
    mode: 'local',
    async getSession() { const session = localSession(); return session ? { user: session.user } : null; },
    async register(email, password) {
      const accounts = json(ACCOUNTS_KEY, []);
      if (accounts.some((account) => account.email === email.toLowerCase())) throw new Error('An account with this email already exists.');
      const account = { id: localId(), email: email.toLowerCase(), password, createdAt: localNow() };
      accounts.push(account); write(ACCOUNTS_KEY, accounts); saveLocalWorkspace(account.id, seed());
      const session = { user: { id: account.id, email: account.email } }; write(SESSION_KEY, session); return session;
    },
    async login(email, password) {
      const account = json(ACCOUNTS_KEY, []).find((entry) => entry.email === email.toLowerCase() && entry.password === password);
      if (!account) throw new Error('Email or password is incorrect.');
      const session = { user: { id: account.id, email: account.email } }; write(SESSION_KEY, session); return session;
    },
    async logout() { localStorage.removeItem(SESSION_KEY); },
    async loadWorkspace(userId) { return localWorkspace(userId) || seed(); },
    async saveWorkspace(userId, state) { saveLocalWorkspace(userId, state); }
  };
}

function createCloudBackend() {
  const client = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  let saveChain = Promise.resolve();
  const data = async (table, options = {}) => {
    let query = client.from(table);
    if (options.method === 'DELETE') query = query.delete();
    else if (options.method === 'PATCH') query = query.update(options.body);
    else if (options.method === 'POST') query = query.upsert(options.body, { onConflict: options.onConflict || 'id', ignoreDuplicates: false });
    else query = query.select(options.select || '*');
    if (options.query) Object.entries(options.query).forEach(([key, value]) => {
      if (key === 'user_id' && String(value).startsWith('eq.')) query = query.eq(key, String(value).slice(3));
      else if (key === 'id' && String(value).startsWith('eq.')) query = query.eq(key, String(value).slice(3));
      else if (key === 'task_id' && String(value).startsWith('eq.')) query = query.eq(key, String(value).slice(3));
    });
    if (options.order) { const [column, direction] = String(options.order).split('.'); query = query.order(column, { ascending: direction !== 'desc' }); }
    const result = await query;
    if (result.error) throw result.error;
    return result.data || [];
  };
  async function loadWorkspace(id) {
    const [tasks, steps, todos, contexts, events, profiles] = await Promise.all([
      data('tasks', { query: { user_id: `eq.${id}` }, order: 'updated_at.desc' }),
      data('task_steps', { query: { user_id: `eq.${id}` }, order: 'step_order.asc' }),
      data('todos', { query: { user_id: `eq.${id}` }, order: 'updated_at.desc' }),
      data('task_context', { query: { user_id: `eq.${id}` } }),
      data('task_events', { query: { user_id: `eq.${id}` }, order: 'created_at.desc' }),
      data('profiles', { query: { id: `eq.${id}` }, select: 'language' })
    ]);
    const contextByTask = Object.fromEntries(contexts.map((row) => [row.task_id, { lastAction: row.last_action, whatWasDone: row.what_was_done || [], whatWasBeingConsidered: row.what_was_being_considered, nextIntendedAction: row.next_intended_action, relevantFiles: row.relevant_files || [], notes: row.notes }]));
    const eventsByTask = {}; events.forEach((row) => { (eventsByTask[row.task_id] ||= []).push({ id: row.id, type: row.type, detail: row.detail, at: row.created_at }); });
    const stepsByTask = {}; steps.forEach((row) => { (stepsByTask[row.task_id] ||= []).push({ id: row.id, title: row.title, description: row.description, status: row.status, order: row.step_order, dependencies: row.dependencies || [], estimatedMinutes: row.estimated_minutes, completedAt: row.completed_at }); });
    return { tasks: tasks.map((row) => ({ id: row.id, title: row.title, description: row.description, status: row.status, activePlan: (stepsByTask[row.id] || []).sort((a, b) => a.order - b.order), currentStepId: row.current_step_id, context: contextByTask[row.id] || {}, events: eventsByTask[row.id] || [], createdAt: row.created_at, updatedAt: row.updated_at })), todos: todos.map((row) => ({ id: row.id, title: row.title, completed: row.completed, taskId: row.task_id })), selectedTaskId: tasks[0]?.id || null, language: profiles[0]?.language || 'en' };
  }
  async function saveWorkspace(id, state) {
    normalizeWorkspaceIds(state);
    const [existingTasks, existingTodos, existingSteps, existingContexts, existingEvents] = await Promise.all([
      data('tasks', { query: { user_id: `eq.${id}` }, select: 'id' }),
      data('todos', { query: { user_id: `eq.${id}` }, select: 'id' }),
      data('task_steps', { query: { user_id: `eq.${id}` }, select: 'id' }),
      data('task_context', { query: { user_id: `eq.${id}` }, select: 'task_id' }),
      data('task_events', { query: { user_id: `eq.${id}` }, select: 'id' })
    ]);
    const taskIds = new Set(state.tasks.map((item) => item.id)); const todoIds = new Set(state.todos.map((item) => item.id)); const stepIds = new Set(state.tasks.flatMap((item) => (item.activePlan || []).map((step) => step.id)));
    const contextIds = new Set(state.tasks.map((item) => item.id));
    const eventIds = new Set(state.tasks.flatMap((item) => (item.events || []).map((event) => event.id)));
    const remove = async (table, rows, ids, key = 'id') => { for (const row of rows.filter((entry) => !ids.has(entry[key]))) await data(table, { method: 'DELETE', query: { [key]: `eq.${row[key]}`, user_id: `eq.${id}` } }); };
    await remove('todos', existingTodos, todoIds); await remove('task_steps', existingSteps, stepIds); await remove('task_context', existingContexts, contextIds, 'task_id'); await remove('task_events', existingEvents, eventIds); await remove('tasks', existingTasks, taskIds);
    if (state.tasks.length) await data('tasks', { method: 'POST', body: state.tasks.map((item) => ({ id: item.id, user_id: id, title: item.title, description: item.description || '', status: item.status, current_step_id: null })) });
    const steps = state.tasks.flatMap((item) => (item.activePlan || []).map((step, index) => ({ id: step.id, task_id: item.id, user_id: id, title: step.title, description: step.description || '', status: step.status, step_order: index, dependencies: step.dependencies || [], estimated_minutes: step.estimatedMinutes || null, completed_at: step.completedAt || null })));
    const events = state.tasks.flatMap((item) => (item.events || []).map((event) => ({ id: event.id, task_id: item.id, user_id: id, type: event.type, detail: event.detail || '', created_at: event.at || localNow() })));
    if (steps.length) await data('task_steps', { method: 'POST', body: steps });
    for (const item of state.tasks) { if (item.currentStepId) await data('tasks', { method: 'PATCH', query: { id: `eq.${item.id}`, user_id: `eq.${id}` }, body: { current_step_id: item.currentStepId } }); }
    if (state.todos.length) await data('todos', { method: 'POST', body: state.todos.map((todo) => ({ id: todo.id, user_id: id, task_id: todo.taskId || null, title: todo.title, completed: todo.completed })) });
    const existingEventIds = new Set(existingEvents.map((event) => event.id));
    const newEvents = events.filter((event) => !existingEventIds.has(event.id));
    if (newEvents.length) await data('task_events', { method: 'POST', body: newEvents });
    for (const item of state.tasks) { const context = item.context || {}; await data('task_context', { method: 'POST', body: { task_id: item.id, user_id: id, last_action: context.lastAction || '', what_was_done: context.whatWasDone || [], what_was_being_considered: context.whatWasBeingConsidered || '', next_intended_action: context.nextIntendedAction || '', relevant_files: context.relevantFiles || [], notes: context.notes || '' }, onConflict: 'task_id' }); }
    if (state.language) await data('profiles', { method: 'POST', body: { id, language: state.language }, onConflict: 'id' });
  }
  const queueSave = (id, state) => {
    const snapshot = structuredClone(state);
    saveChain = saveChain.catch(() => {}).then(() => saveWorkspace(id, snapshot));
    return saveChain;
  };
  return { mode: 'cloud', async getSession() { const { data: result, error } = await client.auth.getSession(); if (error) throw error; return result.session ? { user: result.session.user } : null; }, async getAccessToken() { const { data: result, error } = await client.auth.getSession(); if (error) throw error; return result.session?.access_token || ''; }, async register(email, password) { const { data: result, error } = await client.auth.signUp({ email, password }); if (error) throw error; return { user: result.user, session: result.session, needsEmailConfirmation: !result.session }; }, async login(email, password) { const { data: result, error } = await client.auth.signInWithPassword({ email, password }); if (error) throw error; return { user: result.user, session: result.session }; }, async logout() { const { error } = await client.auth.signOut(); if (error) throw error; }, loadWorkspace, saveWorkspace: queueSave };
}

export const backend = cloudEnabled ? createCloudBackend() : createLocalBackend();
export const isCloudConfigured = cloudEnabled;
export const getAccessToken = async () => backend.getAccessToken?.() || '';
