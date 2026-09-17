// Editorial classification based on the supplied 2024 unified-exam syllabus and textbook contents.
export const chapters = [
  ["s1", "signals", "信号与系统基础", "基本信号 · 信号运算 · 系统性质"],
  ["s2", "signals", "LTI系统时域分析", "卷积 · 初始状态 · 响应分解"],
  ["s3", "signals", "连续时间频域分析", "傅里叶级数与变换 · 连续频率响应"],
  ["s4", "signals", "离散时间频域分析", "DTFS · DTFT · 离散频率响应"],
  ["s5", "signals", "采样、调制与通信", "采样重建 · 多速率 · 调制解调"],
  ["s6", "signals", "拉普拉斯变换与连续系统", "收敛域 · 系统函数 · 连续实现"],
  ["s7", "signals", "Z变换与离散系统", "收敛域 · 系统函数 · 离散实现"],
  ["d1", "digital", "数制、编码与运算", "进制 · BCD与格雷码 · 补码运算"],
  ["d2", "digital", "逻辑代数与函数化简", "标准形式 · 逻辑规则 · 卡诺图"],
  ["d3", "digital", "TTL与CMOS门电路", "器件原理 · 电平 · 接口与扇出"],
  [
    "d4",
    "digital",
    "组合逻辑与常用模块",
    "分析设计 · 编码译码 · MUX · 竞争冒险",
  ],
  ["d6", "digital", "锁存器与触发器", "状态与激励 · 时钟结构 · 动态特性"],
  ["d7", "digital", "同步时序分析与设计", "状态转移 · 同步时序 · 自启动"],
  [
    "d10",
    "digital",
    "寄存器、计数器与序列",
    "移位与计数 · 模数扩展 · 序列发生",
  ],
  ["d11", "digital", "异步时序分析与设计", "异步计数 · 逐级触发 · 波形"],
  ["d12", "digital", "状态机与控制器", "状态编码 · ASM · 硬布线与微程序"],
  ["d9", "digital", "存储器与可编程逻辑", "RAM与ROM · 字位扩展 · PLD"],
  ["d8", "digital", "脉冲产生与波形变换", "施密特 · 单稳态 · 振荡器 · 555"],
].map(([id, subject, title, summary], i, all) => ({
  id,
  subject,
  title,
  summary,
  number: String(
    all.slice(0, i + 1).filter((c) => c[1] === subject).length,
  ).padStart(2, "0"),
  symbol: subject === "signals" ? "∿" : "▦",
}));

const topicGroups = {
  s1: {
    impulse: "冲激与阶跃信号",
    signal: "周期、奇偶与能量功率",
    time: "自变量变换与信号运算",
    properties: "线性、时不变、因果、稳定与记忆性",
  },
  s2: {
    ctconv: "卷积积分",
    dtconv: "卷积和",
    impulse: "冲激响应与阶跃响应",
    ctinitial: "连续系统初始状态与响应分解",
    dtinitial: "离散系统初始状态与响应分解",
    identification: "由输入输出辨识系统",
    equation: "微分、差分与积分方程",
  },
  s3: {
    eigen: "连续系统特征函数",
    series: "连续傅里叶级数与周期频谱",
    transform: "连续傅里叶变换及性质",
    symmetry: "频谱实虚、奇偶与幅相",
    parseval: "Parseval与能量功率",
    response: "连续频率响应与系统输出",
    filter: "理想滤波与无失真传输",
  },
  s4: {
    eigen: "离散系统特征函数",
    series: "DTFS与周期序列",
    transform: "DTFT及性质",
    symmetry: "DTFT实虚、奇偶与周期性",
    parseval: "离散Parseval与能量功率",
    response: "离散频率响应与系统输出",
    filter: "数字滤波器的频响特性",
  },
  s5: {
    sampling: "采样定理与采样率",
    alias: "频谱复制、混叠与带通采样",
    reconstruct: "重构、保持与补偿",
    multirate: "抽取与内插",
    simulation: "连续系统的离散实现",
    modulation: "幅度调制、解调与频分复用",
    pam: "脉冲幅度调制与时分复用",
  },
  s6: {
    transform: "拉普拉斯变换对与性质",
    roc: "拉氏收敛域与零极点",
    inverse: "拉普拉斯反变换",
    unilateral: "单边拉氏变换与初始条件",
    function: "连续系统函数与参数辨识",
    stability: "连续系统因果性与稳定性",
    realization: "微分方程与积分器框图",
    limits: "连续初值与终值定理",
    inverseSystem: "连续逆系统",
  },
  s7: {
    transform: "Z变换对与性质",
    roc: "Z域收敛域与零极点",
    inverse: "Z反变换",
    unilateral: "单边Z变换与初始条件",
    function: "离散系统函数与参数辨识",
    stability: "离散系统因果性与稳定性",
    realization: "差分方程与延时器框图",
    limits: "离散初值与终值定理",
    inverseSystem: "离散逆系统与回波消除",
  },
  d1: {
    radix: "进制转换与二进制算术",
    complement: "原码、反码与补码",
    code: "BCD、余3码与格雷码",
  },
  d2: {
    laws: "逻辑定律、异或与对偶",
    standard: "最小项、最大项与标准形式",
    kmap: "卡诺图与公式化简",
    dontcare: "无关项与约束",
    complete: "逻辑完备集与自定义运算",
  },
  d3: {
    ttl: "TTL工作原理与输入输出特性",
    cmos: "CMOS与传输门",
    output: "OC、三态与高阻态",
    interface: "电平转换、拉灌电流与扇出",
  },
  d4: {
    design: "组合逻辑分析与设计",
    encoder: "编码器与优先编码",
    decoder: "译码器与显示驱动",
    mux: "数据选择器与级联",
    arithmetic: "加法器与数值比较",
    hazard: "竞争冒险判别与消除",
  },
  d6: {
    latch: "锁存器与SR约束",
    excitation: "RS/JK/D/T特性与激励方程",
    clock: "电平、边沿与主从结构",
    convert: "触发器功能转换",
    timing: "建立保持时间与动态特性",
  },
  d7: {
    state: "驱动、状态、输出方程与状态图",
    waveform: "同步时序波形",
    design: "同步时序电路设计",
    startup: "无效状态与自启动",
  },
  d10: {
    shift: "寄存器与移位状态循环",
    counter: "计数器设计与模数",
    preset: "计数器反馈置数、清零与级联",
    sequence: "序列发生与检测",
  },
  d11: {
    analysis: "异步时钟与状态分析",
    waveform: "异步控制与时序波形",
    design: "异步计数器与时序设计",
  },
  d12: {
    fsm: "状态机与状态编码",
    minimize: "状态化简与最少触发器",
    asm: "ASM与硬布线控制器",
    micro: "微指令、微程序与下地址逻辑",
    datapath: "控制器与数据通路",
  },
  d9: {
    memory: "RAM/ROM结构与功能",
    expand: "容量、字扩展与位扩展",
    pld: "可编程逻辑器件与应用",
  },
  d8: {
    schmitt: "施密特门限、回差与整形",
    mono: "单稳态与脉宽控制",
    oscillator: "多谐振荡与周期占空比",
    timer: "555定时器与应用",
    combined: "脉冲与数字模块联动",
  },
};
export const topics = Object.entries(topicGroups).flatMap(([chapter, values]) =>
  Object.entries(values).map(([key, title]) => ({
    id: chapter + "." + key,
    chapter,
    title,
  })),
);

// Each legacy type supplies only its essential concepts. Additional concepts are assigned per question below.
export const baseTopics = {
  "A1.1": "s1.properties",
  "A1.2": "s1.signal s3.series",
  "A1.3": "s1.impulse s1.time",
  "A2.1": "s2.ctconv",
  "A2.2": "s2.dtconv",
  "A2.3": "s2.identification",
  "A2.4": "s2.ctinitial s2.equation",
  "A2.5": "s2.dtinitial s2.equation",
  "A2.6": "s2.impulse",
  "A2.7": "s2.impulse",
  "A2.8": "s2.ctconv s2.equation s6.transform",
  "A3.1": "s3.transform",
  "A3.2": "s3.transform",
  "A3.3": "s3.series s3.transform",
  "A3.4": "s3.transform",
  "A3.5": "s3.symmetry",
  "A3.6": "s3.series",
  "A4.1": "s4.transform",
  "A4.2": "s4.transform",
  "A4.3": "s4.transform",
  "A4.4": "s4.series",
  "A4.5": "s4.series s4.parseval",
  "A5.1": "s6.inverse s6.roc",
  "A5.2": "s6.roc",
  "A5.3": "s6.function",
  "A5.4": "s6.realization s6.function",
  "A5.5": "s6.function s6.inverse",
  "A5.6": "s6.realization",
  "A5.7": "s6.transform",
  "A5.8": "s3.response s3.transform",
  "A6.1": "s7.transform",
  "A6.2": "s7.inverse s7.roc",
  "A6.3": "s7.function",
  "A6.4": "s7.realization",
  "A6.5": "s7.function s7.inverse",
  "A6.6": "s7.realization",
  "A6.7": "s7.stability",
  "A7.1": "s5.sampling",
  "A7.2": "s5.alias",
  "A7.3": "s5.reconstruct",
  "A7.4": "s5.simulation",
  "A7.5": "s5.multirate",
  "A7.6": "s5.sampling s5.alias",
  "A8.1": "s5.modulation s3.filter",
  "A8.2": "s4.transform s4.response",
  "A9.1": "s3.response s3.eigen",
  "A9.2": "s4.response s4.eigen",
  "A9.3": "s7.inverseSystem",
  "A9.4": "s3.filter",
  "A9.5": "s4.response s4.series",
  "A9.6": "s3.filter s3.transform",
  "B1.1": "d1.code",
  "B2.1": "d2.laws",
  "B2.2": "d2.laws",
  "B2.3": "d2.standard",
  "B2.4": "d2.complete",
  "B2.5": "d2.laws",
  "B3.1": "d2.kmap",
  "B3.2": "d4.hazard",
  "B3.3": "d2.dontcare d2.kmap",
  "B3.4": "d2.kmap",
  "B3.5": "d2.kmap",
  "B4.1": "d3.output",
  "B4.2": "d3.interface",
  "B4.3": "d3.cmos",
  "B5.1": "d4.design",
  "B5.2": "d4.decoder",
  "B5.3": "d4.mux",
  "B5.4": "d4.arithmetic",
  "B5.5": "d4.decoder",
  "B5.6": "d4.encoder",
  "B5.7": "d4.design d2.laws",
  "B5.8": "d4.mux",
  "B6.1": "d6.latch d6.clock",
  "B6.2": "d6.convert d6.clock",
  "B7.1": "d10.shift d10.sequence",
  "B7.2": "d10.shift d10.sequence",
  "B7.3": "d10.shift",
  "B8.1": "d10.counter d6.excitation d7.design",
  "B8.2": "d10.preset",
  "B8.3": "d10.counter d10.sequence d4.mux",
  "B8.4": "d7.startup",
  "B9.1": "d7.state",
  "B9.2": "d7.state",
  "B9.3": "d7.waveform",
  "B10.1": "d12.fsm",
  "B10.2": "d12.fsm d6.excitation",
  "B10.3": "d12.fsm",
  "B10.4": "d12.asm",
  "B10.5": "d12.micro d12.asm",
  "B10.6": "d12.minimize d12.fsm",
  "B10.7": "d12.datapath",
  "B11.1": "d8.oscillator",
  "B11.2": "d8.mono",
  "B11.3": "d8.combined",
  "B11.4": "d8.mono d8.oscillator",
  "B11.5": "d8.schmitt",
  "B12.1": "d9.expand d9.memory",
};
const trainingGroups = [
  ["s-properties", "signals", "判断系统性质与构造反例", "A1.1"],
  ["s-signal", "signals", "分析信号性质与冲激运算", "A1.2 A1.3"],
  ["s-convolution", "signals", "计算卷积与零状态响应", "A2.1 A2.2 A2.8"],
  ["s-identify", "signals", "由输入输出反求系统或响应", "A2.3 A2.7"],
  ["s-initial", "signals", "求初值响应并分解响应分量", "A2.4 A2.5"],
  ["s-step", "signals", "求阶跃响应与稳态值", "A2.6"],
  ["s-fourier", "signals", "用变换对与性质求频谱", "A3.1 A4.1"],
  ["s-invfourier", "signals", "由频谱或实虚部反求信号", "A3.2 A4.2"],
  ["s-series", "signals", "分析周期信号与傅里叶级数", "A3.3 A3.6 A4.4 A4.5"],
  ["s-integral", "signals", "用频谱求积分、求和与能量", "A3.4 A4.3"],
  ["s-spectrum", "signals", "判断幅相谱与频谱对称性", "A3.5"],
  ["s-inverse", "signals", "结合收敛域求反变换", "A5.1 A6.2"],
  ["s-roc", "signals", "联用零极点与收敛域判断性质", "A5.2 A6.7"],
  ["s-function", "signals", "由方程、框图或条件重建系统函数", "A5.3 A6.3 A5.8"],
  ["s-equation", "signals", "系统函数与微分、差分方程互换", "A5.4 A6.4"],
  ["s-impulse", "signals", "由系统函数求冲激响应", "A5.5 A6.5"],
  ["s-realize", "signals", "画系统框图与直接型结构", "A5.6 A6.6"],
  ["s-transform", "signals", "应用拉氏与Z变换性质", "A5.7 A6.1"],
  ["s-sampling", "signals", "确定采样率与混叠条件", "A7.1 A7.6"],
  ["s-sampling-spectrum", "signals", "画采样与混叠频谱", "A7.2"],
  ["s-reconstruct", "signals", "设计重构与保持补偿", "A7.3"],
  ["s-digital", "signals", "连续系统数字实现与多速率等效", "A7.4 A7.5"],
  ["s-modulate", "signals", "逐级分析调制、滤波与解调", "A8.1 A8.2"],
  ["s-response", "signals", "求周期、谐波与指数激励响应", "A9.1 A9.2 A9.5"],
  ["s-inverse-system", "signals", "设计逆系统与回波消除", "A9.3"],
  ["s-filter", "signals", "判断滤波类型并设计等效滤波器", "A9.4 A9.6"],
  ["d-code", "digital", "辨析编码性质与码制转换", "B1.1"],
  ["d-proof", "digital", "逻辑恒等式证明与规则辨析", "B2.1 B2.2 B2.5"],
  ["d-standard", "digital", "标准式、反函数与逻辑形式转换", "B2.3"],
  ["d-complete", "digital", "构造逻辑完备集与自定义运算", "B2.4"],
  ["d-simplify", "digital", "卡诺图与公式化简", "B3.1 B3.4 B3.5"],
  ["d-constraint", "digital", "由化简结果反推约束与无关项", "B3.3"],
  ["d-hazard", "digital", "判断并消除竞争冒险", "B3.2"],
  ["d-gate", "digital", "分析门电路逻辑与电平", "B4.1 B4.3"],
  ["d-interface", "digital", "计算接口电平、驱动与扇出", "B4.2"],
  ["d-combinational", "digital", "从实际要求列真值表并设计逻辑", "B5.1 B5.7"],
  ["d-decode", "digital", "用编码器、译码器实现与扩展", "B5.2 B5.5 B5.6"],
  ["d-mux", "digital", "指定选择端的MUX实现与级联", "B5.3 B5.8"],
  ["d-arithmetic", "digital", "设计加法、比较与算术模块", "B5.4"],
  ["d-flipflop", "digital", "分析时钟结构与触发器功能转换", "B6.1 B6.2"],
  ["d-sequence", "digital", "设计序列发生器与检测器", "B7.1 B7.2 B8.3"],
  ["d-counter", "digital", "设计计数器与反馈置数清零", "B8.1 B8.2"],
  ["d-state", "digital", "由电路求状态图、功能与自启动", "B7.3 B8.4 B9.1 B9.2"],
  ["d-waveform", "digital", "按时钟与异步控制画波形", "B9.3"],
  ["d-fsm", "digital", "从状态要求设计与化简电路", "B10.1 B10.2 B10.3 B10.6"],
  ["d-controller", "digital", "ASM、硬布线与数据通路设计", "B10.4 B10.7"],
  ["d-micro", "digital", "微指令格式与微程序控制设计", "B10.5"],
  ["d-oscillator", "digital", "设计振荡器与周期占空比", "B11.1"],
  ["d-mono", "digital", "单稳态、脉宽与器件替换分析", "B11.2"],
  ["d-combined", "digital", "分析脉冲与数字模块联动", "B11.3"],
  ["d-shaping", "digital", "解释施密特、整形与稳态机理", "B11.4 B11.5"],
  ["d-memory", "digital", "计算存储容量与字位扩展", "B12.1"],
];
export const trainingTypes = trainingGroups.map(
  ([id, subject, title, types]) => ({
    id,
    subject,
    title,
    legacyTypes: types.split(" "),
  }),
);

export function annotate(q) {
  let ids = (baseTopics[q.typeId] || "").split(" ").filter(Boolean);
  const text = `${q.title} ${q.tags.join(" ")}`;
  const extra = (test, topics) => {
    if (test.test(text)) ids.push(...topics.split(" "));
  };
  if (q.subject === "signals") {
    const discrete =
      /^(A4|A6)/.test(q.typeId) ||
      ["A2.2", "A2.5", "A9.2", "A9.5", "A8.2"].includes(q.typeId) ||
      /离散|序列|DTFT|DTFS|H\(z\)|Z变换/.test(text);
    const f = discrete ? "s4" : "s3",
      z = discrete ? "s7" : "s6";
    extra(/Parseval|能量|功率/, f + ".parseval");
    extra(/偶部|实虚|奇偶|共轭对称|相位谱|相频/, f + ".symmetry");
    extra(/DTFS|周期冲激|周期化/, f + ".series");
    extra(/ROC|零极点|极点/, z + ".roc");
    extra(/初值定理|终值/, z + ".limits");
    extra(/单边拉普拉斯|单边Z|单边变换|单边积分/, z + ".unilateral");
    extra(/特征函数/, f + ".eigen");
    extra(/混叠|谱复制|周期延拓|带通采样/, "s5.alias");
    extra(/重构|保持|恢复滤波/, "s5.reconstruct");
    extra(/抽取|插值|内插|上采样|下采样/, "s5.multirate");
    extra(/微分方程|差分方程/, "s2.equation");
    extra(/积分器|直接II型|延时器|实现结构/, z + ".realization");
    extra(
      /稳定|因果/,
      /^(A5|A6)/.test(q.typeId) ? z + ".stability" : "s1.properties",
    );
    extra(/低通|高通|带通|全通|滤波器/, f + ".filter");
    if (["2015|二|(1)", "2024|四|(3)"].includes(q.id))
      ids = [
        "s4.filter",
        "s4.response",
        ...ids.filter((id) => id !== "s3.filter"),
      ];
    if (q.id === "2013|四|(c)")
      ids = ["s6.inverseSystem", "s6.function", "s6.inverse"];
  } else {
    extra(/无关项|任意项|约束/, "d2.dontcare");
    extra(/卡诺图|最简/, "d2.kmap");
    extra(/JK|D触发器|T触发器|激励|驱动方程/, "d6.excitation");
    extra(/MUX|选1|选一|数据选择器/, "d4.mux");
    extra(/译码|74LS138|74138/, "d4.decoder");
    extra(/优先编码|编码器/, "d4.encoder");
    extra(/BCD|格雷码|余3码|2421码|5421码/, "d1.code");
    extra(/加法器|全加器|比较器|7485|74283|14585/, "d4.arithmetic");
    extra(/OC|高阻|三态|线与/, "d3.output");
    extra(/TTL/, "d3.ttl");
    extra(/CMOS|MOS|传输门/, "d3.cmos");
    extra(/自启动|无效状态/, "d7.startup");
    extra(/计数器|74161|74LS161|74LS160/, "d10.counter");
    extra(/置数|清零|预置/, "d10.preset");
    extra(/寄存器|74LS194|74175/, "d10.shift");
    extra(/序列发生|序列信号|序列检测|分组.*检测/, "d10.sequence");
    extra(/ASM|算法流程/, "d12.asm");
    extra(/微程序|微指令|微码|下地址/, "d12.micro");
    extra(/数据通路/, "d12.datapath");
    extra(/状态化简|消除冗余|最少.*触发器/, "d12.minimize");
    extra(/555/, "d8.timer");
    extra(/施密特|门限|回差/, "d8.schmitt");
    extra(/多谐|振荡/, "d8.oscillator");
    if (/异步时序|异步时钟/.test(text) || /^2015\|八\|/.test(q.id)) {
      ids = ids.filter((id) => !["d7.state", "d7.waveform"].includes(id));
      ids.unshift(q.typeId === "B9.3" ? "d11.waveform" : "d11.analysis");
    }
  }
  return {
    primaryChapter: ids[0].split(".")[0],
    knowledgeIds: [...new Set(ids)],
    trainingIds: trainingTypes
      .filter((t) => t.legacyTypes.includes(q.typeId))
      .map((t) => t.id),
  };
}
