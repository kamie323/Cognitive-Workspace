import { classifyTaskType, TASK_TYPES } from './task-decomposition-policy.js';

const SIMPLE_DAILY_PLANS = {
  zh: [
    [/洗澡/, '走到浴室并打开淋浴'],
    [/睡觉/, '躺到床上'],
    [/刷牙/, '拿起牙刷并挤上牙膏'],
    [/吃饭/, '把要吃的食物放到面前'],
    [/喝水/, '拿起水杯并喝一口水'],
    [/换衣服/, '拿出要换的衣服'],
    [/倒垃圾/, '拿起垃圾袋并走到垃圾桶旁'],
    [/收拾桌子/, '把桌面上最明显的一件物品放回原处']
  ],
  en: [
    [/shower/, 'Walk to the bathroom and turn on the shower'],
    [/sleep|go to bed/, 'Lie down in bed'],
    [/brush teeth/, 'Pick up the toothbrush and add toothpaste'],
    [/eat|have a meal/, 'Put the food you will eat in front of you'],
    [/drink water/, 'Pick up a cup and take a drink'],
    [/get dressed|change clothes/, 'Take out the clothes you will wear'],
    [/take out the trash/, 'Pick up the trash bag and walk it to the bin'],
    [/tidy the desk|clean the desk/, 'Put the most obvious item on the desk back in its place']
  ]
};

function simpleDailyPlan(title, language) {
  const match = (SIMPLE_DAILY_PLANS[language] || SIMPLE_DAILY_PLANS.en).find(([pattern]) => pattern.test(title.toLowerCase()));
  return [match?.[1] || (language === 'zh' ? `走到可以完成“${title.trim()}”的地方` : `Walk to the place where you can do “${title.trim()}”`)];
}

function transitionPlan(title, language) {
  const subject = title
    .replace(/^(开始|启动|帮我开始|我想开始|我要开始|start|begin|help me start)\s*/i, '')
    .trim() || title.trim();
  const academic = /论文|paper|essay|report|报告|作业|assignment/i.test(subject);
  if (language === 'zh') {
    if (academic) return ['打开或新建论文文档', '在文档顶部写下一句暂定的研究问题'];
    if (/复习|学习/.test(subject)) return ['打开今天要复习的课程页面或文件', '读完页面上的第一小节'];
    if (/项目/.test(subject)) return ['打开目前保存项目要求的页面或文件', '列出要求中第一个要产生的结果'];
    if (/洗澡/.test(subject)) return ['走到浴室并打开淋浴'];
    if (/睡觉/.test(subject)) return ['躺到床上'];
    return [`打开目前保存“${subject}”要求的页面或文件`];
  }
  if (academic) return ['Open or create the paper document', 'Write one tentative research question at the top of the document'];
  if (/study|review/.test(subject)) return ['Open the course page or file for today', 'Read the first short section on the page'];
  if (/project/.test(subject)) return ['Open the page or file where the project requirements are saved', 'List the first result named in the requirements'];
  if (/shower/.test(subject)) return ['Walk to the bathroom and turn on the shower'];
  if (/sleep|bed/.test(subject)) return ['Lie down in bed'];
  return [`Open the page or file where the requirements for “${subject}” are saved`];
}

const TEMPLATES = [
  {
    match: /job application|apply for|resume|cv|求职|申请实习|申请工作|简历/,
    en: ['Read the role requirements and list the required application items', 'Collect the experiences and evidence that match the role', 'Tailor the resume content to the stated requirements', 'Draft any required letter or written responses', 'Check names, dates, links, and attachments', 'Submit the completed application'],
    zh: ['读清岗位要求并列出必须提交的申请材料', '整理与岗位匹配的经历和证据', '根据岗位要求调整简历内容', '完成要求中的求职信或问题回复', '核对姓名、日期、链接和附件', '提交完整申请材料']
  },
  {
    match: /machine learning|ml model|机器学习|预测模型|分类模型|回归模型/,
    en: ['Define the prediction question and evaluation metric', 'Choose a dataset and record its source', 'Clean the data and check missing values', 'Explore patterns and create a simple baseline', 'Train and compare a small set of models', 'Interpret the results against the metric', 'Write the report with method, evidence, and limitations'],
    zh: ['明确预测问题和评估指标', '选择数据集并记录来源', '清洗数据并检查缺失值', '探索规律并建立简单基线', '训练并比较几种模型', '根据评估指标解释结果', '写出包含方法、证据和局限性的报告']
  },
  {
    match: /thesis|dissertation|academic paper|research paper|论文|学术论文|毕业论文/,
    en: ['Read the brief or rubric and list the required sections', 'Choose a focused question and define the scope', 'Search for sources and record citation details', 'Read the key sources and write notes in your own words', 'Turn the evidence into a section-by-section outline', 'Draft the argument and evidence one section at a time', 'Check the argument, evidence, and citations', 'Format the references and save a complete readable version'],
    zh: ['读清作业要求或评分标准，列出必须完成的部分', '确定聚焦的问题并写清研究范围', '检索相关文献，记录来源和引用信息', '精读关键文献，用自己的话记录论点和证据', '根据证据列出分章节提纲', '按章节逐段完成论文初稿', '核对论点、证据和引用是否一致', '整理参考文献并保存完整可读版本']
  },
  {
    match: /report|报告|essay|文章|写作/,
    en: ['Read the brief and list the required sections', 'Gather the specific sources, data, or examples named in the brief', 'Create a section-by-section outline', 'Draft the sections using the evidence already collected', 'Check the argument, evidence, and citations', 'Save a clean readable version'],
    zh: ['读清要求或评分标准，列出必须完成的部分', '收集要求中明确提到的资料、数据或案例', '按章节列出提纲并写清各节重点', '根据已有证据逐段完成初稿', '核对论点、证据和引用是否一致', '保存一份完整可读的版本']
  },
  {
    match: /presentation|present|slides|演示|汇报|幻灯片|答辩/,
    en: ['Clarify the audience and key message', 'Collect the facts and supporting examples', 'Sketch the slide sequence', 'Build the slides and add visuals', 'Practice the talk once end to end', 'Export a readable copy of the deck'],
    zh: ['明确听众和核心信息', '收集事实和支持案例', '规划幻灯片顺序', '制作幻灯片并补充视觉材料', '完整练习一遍讲解', '导出一份可阅读的幻灯片']
  },
  {
    match: /email|邮件|回复|reply|message|消息/,
    en: ['Identify the recipient and the outcome needed', 'Gather the details or files to include', 'Write a short first draft', 'Check names, links, and attachments', 'Send the message'],
    zh: ['确认收件人和需要达成的结果', '整理要放入的细节或文件', '写一版简短初稿', '检查称呼、链接和附件', '发送消息']
  },
  {
    match: /website|web app|app|软件|网站|网页|应用|coding|code|编程|程序/,
    en: ['Define the user outcome and smallest useful scope', 'List the main screens and interactions', 'Set up the project structure', 'Build the smallest working path', 'Test the important flows and fix blockers', 'Document how to run the working version'],
    zh: ['明确用户结果和最小可用范围', '列出主要页面和交互', '搭好项目结构', '先完成最小可用流程', '测试关键流程并修复阻塞问题', '记录运行这个版本的方法']
  },
  {
    match: /research|研究|调查|调研|分析|analysis|数据|dataset|data/,
    en: ['Turn the question into a focused outcome', 'Find and collect trustworthy source material', 'Organize the notes or dataset', 'Compare the evidence and identify patterns', 'Write the findings in a clear structure', 'Check the conclusion against the evidence'],
    zh: ['把问题收敛成明确结果', '寻找并收集可靠资料', '整理笔记或数据集', '比较证据并找出规律', '用清晰结构写出发现', '根据证据核对结论']
  }
];

export function planForTask(title, context = '', language = 'en') {
  const taskType = classifyTaskType(title, context);
  if (taskType === TASK_TYPES.SIMPLE_DAILY) return simpleDailyPlan(title, language);
  if (taskType === TASK_TYPES.TRANSITION) return transitionPlan(title, language);
  const text = `${title} ${context}`.toLowerCase();
  if (/香港/.test(text) && /气候|气温|温度/.test(text) && /报告/.test(text)) {
    return language === 'zh'
      ? [
          '列出报告必须覆盖的数据、温度变化、政策建议和提交时间',
          '查找香港历史气温数据并记录来源机构、年份和链接',
          '提取同一时期和单位下可比较的气温数据',
          '计算气温变化并绘制一张趋势图表',
          '根据数据写出温度变化的主要发现',
          '提出与分析结果对应的政策建议',
          '整理成完整报告并核对所有明确要求'
        ]
      : [
          'List the required data, temperature analysis, policy recommendations, and submission time',
          'Find historical Hong Kong temperature data and record each source, institution, year, and link',
          'Extract comparable temperature data for the same period and unit',
          'Calculate the temperature change and plot one trend chart',
          'Write the main temperature findings from the data',
          'Propose policy recommendations tied to the analysis',
          'Organize the complete report and check every explicit requirement'
        ];
  }
  const matched = TEMPLATES.find((template) => template.match.test(text));
  if (matched) return matched[language] || matched.en;
  if (/准备相关资料|准备材料/.test(text)) return ['写下这批资料将用于回答的任务或问题', '列出已经知道名称的资料', '为清单中的每项资料记录是否已经找到'];
  const clauses = title.split(/\s*(?:,|，|;|；|and then|然后|并且|以及)\s*/i).map((part) => part.trim()).filter((part) => part.length > 1).slice(0, 3);
  if (language === 'zh') {
    return [
      `打开目前保存“${title.trim()}”要求的页面或文件`,
      `列出要求中需要产生的具体结果`,
      ...(clauses.length > 1 ? clauses.map((part) => `完成“${part}”并保存可检查的结果`) : ['完成清单中的第一个结果并保存可检查的版本'])
    ];
  }
  return [
    `Open the page or file where the requirements for “${title.trim()}” are saved`,
    'List the concrete results named in the requirements',
    ...(clauses.length > 1 ? clauses.map((part) => `Complete “${part}” and save an observable result`) : ['Complete the first result on the list and save a checkable version'])
  ];
}
