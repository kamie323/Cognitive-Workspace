export const TASK_TYPES = Object.freeze({
  DELIVERABLE: 'deliverable',
  SIMPLE_DAILY: 'simple_daily',
  TRANSITION: 'transition_initiation'
});

export const STEP_LIMITS = Object.freeze({
  deliverable: [3, 10],
  simple_daily: [1, 3],
  transition_initiation: [1, 2]
});

const GENERIC_PREFIX = /^(?:now|start|begin|initiate|switch to|transition to|do|work on|go and|现在|开始|启动|进行|去做|着手处理|完成)\s*/i;
const VAGUE_STEP = /^(?:think about|prepare|do something|handle|process|work on|deal with|consider|review|check|move forward|think it through|思考|考虑一下|做好准备|处理一下|推进|完成任务|检查一下|整理一下|准备相关资料|准备材料|开始处理|进行处理)(?:\b|$)/i;
const PLACEHOLDER_OBJECT = /(?:what you need|what's needed|what is needed|relevant (?:materials?|content|information)|some (?:materials?|information)|necessary preparation|the next step|this task|appropriate (?:content|materials?|thing)|需要的东西|相关(?:资料|内容)|一些资料|必要准备|下一步|这个任务|适当内容|准备材料|合适的东西|处理问题|整理一下)/i;
const ABSTRACT_ACTION = /(?:deliverable|research|review|feedback|confirmation|final version|交付|复盘|反馈|最终版本|整理材料)/i;
const ACTION_WORD = /(?:open|create|write|draft|note|search|find|save|download|choose|fill|compare|mark|send|check|collect|clean|read|list|propose|extract|plot|calculate|organize|standardize|define|select|build|practice|identify|prepare|export|submit|tailor|test|fix|lie down|walk to|pick up|put down|drink|squeeze|明确|确定|确认|定义|读清|读完|阅读|精读|列出|提出|写出|写下|写一版|记录|搜索|查找|寻找|保存|下载|选择|填写|比较|标记|发送|核对|检查|收集|清理|统一|提取|绘制|计算|整理成|整理|分析|研究|打开|新建|制作|规划|练习|识别|完成|调整|提交|导出|测试|修复|搭好|放到|放回|拿出|躺到|走到|拿起|放下|喝一口|挤上)/i;
const OBJECT_WORD = /(?:document|file|page|folder|data|source|sources|link|question|paragraph|report|paper|essay|outline|draft|references?|requirements?|temperature|trend|recommendations?|policy|charts?|dataset|argument|evidence|section|version|recipient|message|details?|attachments?|audience|facts?|examples?|slides?|visuals?|deck|project|structure|screens?|interactions?|flow|findings?|conclusion|scope|result|goal|period|unit|institution|year|role|resume|application|letter|responses?|bed|bathroom|toothbrush|toothpaste|cup|water|food|phone|clothes|trash|desk|文档|文件|页面|文件夹|数据|数据集|资料|来源|链接|问题|段落|报告|论文|文章|提纲|初稿|参考文献|要求|气温|趋势|建议|政策|图表|论点|证据|章节|版本|收件人|消息|细节|附件|听众|事实|案例|幻灯片|视觉材料|讲解|项目|结构|页面|交互|流程|发现|结论|范围|结果|目标|时期|单位|机构|年份|提交时间|岗位|简历|申请|申请材料|求职信|问题回复|床|浴室|牙刷|牙膏|水杯|水|食物|手机|衣服|垃圾|桌面|淋浴)/i;
const EXTERNAL_ROLE = /(?:teacher|instructor|supervisor|advisor|peer|reviewer|client|manager|expert|老师|导师|同伴|评审|客户|经理|专家)/i;
const INTERACTION = /(?:meet|talk to|ask .* about|send .* to|request feedback|have .* review|consult|contact|约谈|沟通|询问|发送给|请.*反馈|请.*审阅|联系|开会|确认方向|向.*提问)/i;
const TOOL = /(?:microsoft word|google docs|notion|excel|powerpoint|python|jupyter|r studio|github|谷歌文档|石墨|飞书)/i;

export function normalizeTaskText(value = '') {
  return String(value).toLowerCase().replace(/[“”"'‘’.,，。！？!?:：;；()（）[\]{}]/g, '').replace(/\s+/g, ' ').trim();
}

export function stripGenericPrefix(value = '') {
  return normalizeTaskText(value).replace(GENERIC_PREFIX, '').replace(/^帮我\s*/, '').trim();
}

export function isTautologicalStep(taskTitle, stepTitle) {
  const task = stripGenericPrefix(taskTitle);
  const step = stripGenericPrefix(stepTitle);
  if (!task || !step) return false;
  if (step === task) return true;
  const compactStep = step.replace(/^(?:现在|就|去)\s*/, '').trim();
  return compactStep === task || (compactStep.length <= task.length + 4 && compactStep.includes(task) && !hasConcreteAction(step, taskTitle));
}

export function isUnderspecifiedStep(stepTitle) {
  const value = normalizeTaskText(stepTitle);
  return !value || PLACEHOLDER_OBJECT.test(value) || VAGUE_STEP.test(value);
}

export function hasConcreteAction(stepTitle) {
  return ACTION_WORD.test(String(stepTitle || ''));
}

export function hasConcreteObject(stepTitle) {
  return OBJECT_WORD.test(String(stepTitle || '')) && !PLACEHOLDER_OBJECT.test(String(stepTitle || ''));
}

export function hasObservableOutcome(stepTitle) {
  const value = String(stepTitle || '');
  return /(?:写下|记录|保存|打开|新建|下载|列出|统一|标记|躺到|走到|拿起|放下|喝一口|挤上|完成|write|note|save|open|create|download|list|mark|lie down|walk to|pick up|put down|drink)/i.test(value);
}

export function hasUnsupportedParticipantAssumption(taskText, stepTitle) {
  const task = String(taskText || '');
  const step = String(stepTitle || '');
  return EXTERNAL_ROLE.test(step) && !INTERACTION.test(task);
}

export function hasUnsupportedToolAssumption(taskText, stepTitle) {
  return TOOL.test(stepTitle) && !TOOL.test(taskText);
}

export function isActionableStep(taskTitle, stepTitle, taskType = 'deliverable') {
  if (isTautologicalStep(taskTitle, stepTitle) || isUnderspecifiedStep(stepTitle)) return false;
  if (!hasConcreteAction(stepTitle)) return false;
  if (taskType !== 'simple_daily' && !hasConcreteObject(stepTitle)) return false;
  if (taskType === 'simple_daily' && ABSTRACT_ACTION.test(stepTitle)) return false;
  if (taskType === 'transition_initiation' && String(stepTitle).length > 180) return false;
  return hasObservableOutcome(stepTitle) || hasConcreteObject(stepTitle);
}

export function validateStepPolicy(taskText, taskTitle, stepTitle, taskType) {
  if (!isActionableStep(taskTitle, stepTitle, taskType)) return 'Step is not genuinely actionable.';
  if (hasUnsupportedParticipantAssumption(taskText, stepTitle)) return 'Step introduces an unsupported participant interaction.';
  if (hasUnsupportedToolAssumption(taskText, stepTitle)) return 'Step introduces an unsupported tool.';
  return '';
}

export function classifyTaskType(title, context = '') {
  const value = `${title} ${context}`.toLowerCase().trim();
  if (/(^|\s)(start|begin|initiate|switch|transition|get into|help me start|how do i start)(\s|$)|开始|启动|切换|进入状态|不知道怎么开始|帮我开始|先从哪里开始/.test(value)) return TASK_TYPES.TRANSITION;
  if (/洗澡|睡觉|吃饭|喝水|刷牙|洗脸|换衣服|出门|散步|倒垃圾|收拾桌子|shower|sleep|eat|drink water|brush teeth|wash face|get dressed|go outside|walk|take out the trash|tidy the desk|clean the desk/.test(value)) return TASK_TYPES.SIMPLE_DAILY;
  return TASK_TYPES.DELIVERABLE;
}
