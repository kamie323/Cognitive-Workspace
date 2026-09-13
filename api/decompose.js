const MAX_INPUT_LENGTH = 10000;
const MAX_STEPS = 10;
import { TASK_TYPES, STEP_LIMITS, classifyTaskType, validateStepPolicy } from '../task-decomposition-policy.js';
const ALLOWED_LANGUAGES = new Set(['zh', 'en']);
const FORBIDDEN_MODEL_FIELDS = new Set(['id', 'userId', 'user_id', 'taskId', 'task_id', 'status', 'completedAt', 'completed_at', 'priority']);

const SYSTEM_PROMPT = `You are a Task Decomposition Assistant. Determine the minimum useful structure for the user's current task, then return a concrete, editable candidate plan. The goal is to reduce cognitive load and help execution, not to describe everything that could ever be done.

Rules:
- Understand the user's intent before making steps.
- Classify the input as exactly one taskType: deliverable, simple_daily, or transition_initiation.
- If the user says start, begin, initiate, switch, transition, get into the state, does not know how to begin, or asks for help starting X, classify as transition_initiation before considering whether X is a deliverable. For example, "write a paper" is deliverable, while "start writing a paper" is transition_initiation.
- Use deliverable for multi-stage academic, professional, project, research, or other work with a real output or external requirement.
- Use simple_daily for a single ordinary physical or daily action such as showering, sleeping, eating, brushing teeth, or drinking water.
- Extract a concise title and core goal.
- Record only deliverables, constraints, and resources explicitly present in the input.
- Do not invent deadlines, priorities, grading rules, formats, people, or other hard requirements.
- Put missing but potentially important information in uncertainties.
- Choose the minimum useful structure for the task type: deliverable = 3 to 10 steps; simple_daily = 1 to 3 steps; transition_initiation = 1 to 2 steps.
- If a simple_daily task is already one executable action, return exactly one step. Never add deliverable, research, review, feedback, confirmation, or final-version steps to make a simple task look complete.
- For transition_initiation, the first step must be a very small, concrete, immediately executable action. Do not expand the whole task lifecycle.
- Every subtask must describe one action or verifiable intermediate result. It must add operational information beyond the task title, name a concrete object, and make completion observable. Avoid vague steps such as "think about it", "prepare", "handle it", or "complete the task".
- A step is tautological and invalid when removing generic words such as start, now, begin, do, or complete leaves only the original task (for example, task "shower" -> "now start shower"). Do not reject a step merely because it contains "start" when it adds a concrete object and outcome (for example, "start recording each source's institution and year").
- Do not use placeholder objects such as "what you need", "relevant materials", "some information", "the next step", "this task", or "necessary preparation" when a concrete object can be named. If the object is unknown, use a bounded description such as "the page or file where the task requirements are saved" without inventing a tool.
- Do not introduce a teacher, supervisor, peer, reviewer, client, manager, expert, feedback cycle, software, tool, file format, quantity, or extra deliverable unless the user explicitly requests that exact interaction, tool, requirement, or deliverable. Merely mentioning a person does not authorize a new interaction: "the teacher requires a report" does not imply "meet the teacher" or "ask the teacher for feedback".
- For deliverable tasks, 3 to 10 is an allowed range, never a target. Stop when every explicit requirement has an execution path. Prefer fewer useful steps, merge adjacent steps that do not create an independent result, and never add lifecycle steps only to look complete.
- Examples: "洗澡" -> "走到浴室并打开淋浴" (good), not "现在开始洗澡" (tautological); "睡觉" -> "躺到床上" (good), not "准备睡觉" (underspecified); "开始写论文" -> "新建或打开一个论文文档" (good), not "打开需要的东西" (underspecified).
- Do not choose priority for the user.
- Dependencies may only point to another subtask key and must represent an obvious ordering.
- estimatedMinutes is only a rough estimate, not a schedule or commitment.
- Never generate database IDs, user IDs, task IDs, status, completedAt, or priority.
- Return strict JSON only, with no Markdown or explanation.

Use this JSON shape:
{
  "taskType": "deliverable|simple_daily|transition_initiation",
  "title": "string",
  "description": "the original input",
  "coreGoal": "string",
  "deliverables": [{"text":"string","source":"explicit"}],
  "constraints": [{"text":"string","source":"explicit"}],
  "requiredResources": [{"text":"string","source":"explicit"}],
  "uncertainties": ["string"],
  "subtasks": [{"key":"step-1","title":"string","description":"string","estimatedMinutes":25,"dependencies":[],"basis":"explicit|necessary_inference","confidence":"high|medium|low"}]
}`;

function jsonResponse(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function text(value, max = 1000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function validateOutput(value, originalText) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Model output must be an object.');
  if (Object.keys(value).some((key) => FORBIDDEN_MODEL_FIELDS.has(key))) throw new Error('Model output contains forbidden task fields.');
  const taskType = Object.values(TASK_TYPES).includes(value.taskType) ? value.taskType : '';
  const title = text(value.title, 120);
  const coreGoal = text(value.coreGoal, 500);
  const subtasks = Array.isArray(value.subtasks) ? value.subtasks : [];
  const [minSteps, maxSteps] = STEP_LIMITS[taskType] || [];
  if (!taskType || !title || !coreGoal || subtasks.length < minSteps || subtasks.length > maxSteps) throw new Error('Model output does not meet the decomposition schema.');
  if (taskType !== classifyTaskType(title, originalText)) throw new Error('Model output taskType is incompatible with the input intent.');

  const keys = new Set();
  const normalized = subtasks.map((step, index) => {
    if (!step || typeof step !== 'object') throw new Error('Invalid subtask.');
    if (Object.keys(step).some((key) => FORBIDDEN_MODEL_FIELDS.has(key))) throw new Error('Subtask contains forbidden task fields.');
    const key = text(step.key, 40) || `step-${index + 1}`;
    const stepTitle = text(step.title, 160);
    const policyError = validateStepPolicy(originalText, title, stepTitle, taskType);
    if (policyError) throw new Error(policyError);
    if (keys.has(key)) throw new Error('Subtask keys must be unique.');
    keys.add(key);
    const minutes = step.estimatedMinutes == null ? null : Number(step.estimatedMinutes);
    if (minutes !== null && (!Number.isInteger(minutes) || minutes < 5 || minutes > 240)) throw new Error('Invalid estimatedMinutes.');
    const dependencies = Array.isArray(step.dependencies) ? step.dependencies.filter((entry) => typeof entry === 'string').slice(0, MAX_STEPS) : [];
    return {
      key,
      title: stepTitle,
      description: text(step.description, 600),
      estimatedMinutes: minutes,
      dependencies,
      basis: step.basis === 'explicit' ? 'explicit' : 'necessary_inference',
      confidence: ['high', 'medium', 'low'].includes(step.confidence) ? step.confidence : 'medium'
    };
  });

  const keySet = new Set(normalized.map((step) => step.key));
  normalized.forEach((step) => {
    step.dependencies.forEach((dependency) => {
      if (!keySet.has(dependency) || dependency === step.key) throw new Error('Invalid subtask dependency.');
    });
  });

  const visiting = new Set();
  const visited = new Set();
  const byKey = new Map(normalized.map((step) => [step.key, step]));
  function visit(key) {
    if (visiting.has(key)) throw new Error('Subtask dependencies contain a cycle.');
    if (visited.has(key)) return;
    visiting.add(key);
    byKey.get(key).dependencies.forEach(visit);
    visiting.delete(key);
    visited.add(key);
  }
  normalized.forEach((step) => visit(step.key));

  const list = (items, max) => (Array.isArray(items) ? items : []).map((item) => ({ text: text(item?.text, max), source: 'explicit' })).filter((item) => item.text);
  return {
    taskType,
    title,
    description: text(value.description, MAX_INPUT_LENGTH) || originalText,
    coreGoal,
    deliverables: list(value.deliverables, 300),
    constraints: list(value.constraints, 300),
    requiredResources: list(value.requiredResources, 300),
    uncertainties: (Array.isArray(value.uncertainties) ? value.uncertainties : []).map((item) => text(item, 300)).filter(Boolean).slice(0, 10),
    subtasks: normalized
  };
}

async function validateSession(req) {
  const authorization = req.headers.authorization || '';
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return false;
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return false;
  const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: `Bearer ${token}` } });
  return response.ok;
}

async function callRouterOne(textInput, language) {
  const apiKey = process.env.ROUTER_ONE_API_KEY;
  const endpoint = process.env.ROUTER_ONE_API_URL || process.env.ROUTER_ONE_BASE_URL;
  if (!apiKey || !endpoint) throw new Error('Router One is not configured.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.ROUTER_ONE_MODEL || undefined,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify({ text: textInput, language }) }
        ]
      })
    });
    if (!response.ok) throw new Error(`Router One request failed (${response.status}).`);
    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content ?? payload?.output?.[0]?.content?.[0]?.text;
    if (typeof content !== 'string') throw new Error('Router One returned no structured content.');
    let parsed;
    try { parsed = JSON.parse(content); } catch { throw new Error('Router One returned invalid JSON.'); }
    return parsed;
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return jsonResponse(res, 405, { error: { code: 'METHOD_NOT_ALLOWED' } });
  try {
    if (!(await validateSession(req))) return jsonResponse(res, 401, { error: { code: 'UNAUTHORIZED' } });
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const input = text(body.text, MAX_INPUT_LENGTH);
    const language = ALLOWED_LANGUAGES.has(body.language) ? body.language : 'en';
    if (!input) return jsonResponse(res, 400, { error: { code: 'EMPTY_INPUT' } });
    const result = validateOutput(await callRouterOne(input, language), input);
    return jsonResponse(res, 200, { ...result, source: 'llm', policyVersion: 'task-decomposition-v1' });
  } catch (error) {
    const isClientError = error?.message === 'Unexpected end of JSON input';
    return jsonResponse(res, isClientError ? 400 : 502, { error: { code: isClientError ? 'INVALID_JSON' : 'DECOMPOSITION_UNAVAILABLE' } });
  }
}
