import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  classifyTaskType,
  hasUnsupportedParticipantAssumption,
  hasUnsupportedToolAssumption,
  isActionableStep,
  isTautologicalStep,
  isUnderspecifiedStep,
  STEP_LIMITS
} from '../task-decomposition-policy.js';
import { planForTask } from '../task-decomposition-fallback.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cases = JSON.parse(await readFile(resolve(root, 'tests/task-decomposition-eval.json'), 'utf8'));
if (cases.some((sample) => !sample.expectedCharacteristics?.length || !sample.failureTypes?.length)) throw new Error('Every evaluation sample must define expected characteristics and failure types.');
const totals = { type: 0, count: 0, actionable: 0, tautological: 0, underspecified: 0, assumptions: 0, overDecomposed: 0 };

for (const sample of cases) {
  const language = /[\u3400-\u9fff]/.test(sample.input) ? 'zh' : 'en';
  const taskType = classifyTaskType(sample.input, sample.input);
  const steps = planForTask(sample.input, sample.input, language);
  const [expectedMin, expectedMax] = sample.acceptableStepCount;
  const typePass = taskType === sample.expectedTaskType;
  const countPass = steps.length >= expectedMin && steps.length <= expectedMax;
  const stepResults = steps.map((step) => ({
    step,
    actionable: isActionableStep(sample.input, step, taskType),
    tautological: isTautologicalStep(sample.input, step),
    underspecified: isUnderspecifiedStep(step),
    unsupported: hasUnsupportedParticipantAssumption(sample.input, step) || hasUnsupportedToolAssumption(sample.input, step)
  }));
  const actionPass = stepResults.every((step) => step.actionable);
  const assumptionPass = stepResults.every((step) => !step.unsupported);
  const overDecomposed = steps.length > STEP_LIMITS[taskType][1] || (taskType === 'simple_daily' && steps.length > 1);
  const pass = typePass && countPass && actionPass && assumptionPass && !overDecomposed;

  totals.type += Number(typePass);
  totals.count += Number(countPass);
  totals.actionable += stepResults.filter((step) => step.actionable).length;
  totals.tautological += stepResults.filter((step) => step.tautological).length;
  totals.underspecified += stepResults.filter((step) => step.underspecified).length;
  totals.assumptions += stepResults.filter((step) => step.unsupported).length;
  totals.overDecomposed += Number(overDecomposed);

  console.log(`${pass ? 'PASS' : 'FAIL'} | ${sample.input} | ${taskType} | ${steps.length} step(s)`);
  if (!pass) {
    console.log(`  checks: type=${typePass} count=${countPass} actionable=${actionPass} assumptions=${assumptionPass} overDecomposed=${overDecomposed}`);
    for (const result of stepResults.filter((step) => !step.actionable || step.unsupported)) console.log(`  - ${result.step}`);
  }
}

const totalSteps = cases.reduce((sum, sample) => sum + planForTask(sample.input, sample.input, /[\u3400-\u9fff]/.test(sample.input) ? 'zh' : 'en').length, 0);
console.log('\nSummary');
console.log(`Cases: ${cases.length}`);
console.log(`Task Type Accuracy: ${totals.type}/${cases.length} (${Math.round(totals.type / cases.length * 100)}%)`);
console.log(`Step Count Compliance: ${totals.count}/${cases.length} (${Math.round(totals.count / cases.length * 100)}%)`);
console.log(`Actionability: ${totals.actionable}/${totalSteps} (${Math.round(totals.actionable / totalSteps * 100)}%)`);
console.log(`Tautology Rate: ${totals.tautological}/${totalSteps} (${Math.round(totals.tautological / totalSteps * 100)}%)`);
console.log(`Underspecification Rate: ${totals.underspecified}/${totalSteps} (${Math.round(totals.underspecified / totalSteps * 100)}%)`);
console.log(`Unsupported Assumption Rate: ${totals.assumptions}/${totalSteps} (${Math.round(totals.assumptions / totalSteps * 100)}%)`);
console.log(`Over-decomposition Warnings: ${totals.overDecomposed}/${cases.length}`);

if (totals.type !== cases.length || totals.count !== cases.length || totals.actionable !== totalSteps || totals.tautological || totals.underspecified || totals.assumptions || totals.overDecomposed) process.exitCode = 1;
