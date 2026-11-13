/** `memory` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  tabTitle: '记忆',
  guideTitle: '记忆面板',
  guideDescription: '查看本会话召回与写入的记忆',
  headerAction: '记忆',
  chipCount: '召回 {count} 条记忆',
  chipUnavailable: '记忆不可用',
  chipOpenHint: '打开记忆面板',
  emptyTitle: '本会话还没有记忆活动',
  emptyDescription: '回合开始时自动召回，回合结束后自动写入；也可以直接让模型记住一件事。',
  sectionRecall: '最近一次召回',
  sectionItems: '召回内容',
  sectionTrace: '检索轨迹',
  sectionWrites: '本回合写入',
  degraded: '记忆服务不可用，本回合未使用记忆',
  noItems: '本次召回没有命中任何记忆',
  score: '相关度',
  latency: '耗时',
  latencyUnit: '毫秒',
  question: '检索问题',
  queued: '已接受',
  refused: '未写入',
} satisfies Record<string, string>

/** The memory namespace key union. */
export type MemoryKey = keyof typeof zh

/** Namespace name for slot and dictionary registration. */
export const NS = 'memory'
/** English dictionary, checked complete against the zh key set. */
export const en = {
  tabTitle: 'Memory',
  guideTitle: 'Memory panel',
  guideDescription: 'Review what this session recalled and stored',
  headerAction: 'Memory',
  chipCount: 'Recalled {count} memories',
  chipUnavailable: 'Memory unavailable',
  chipOpenHint: 'Open the memory panel',
  emptyTitle: 'No memory activity in this session yet',
  emptyDescription: 'Recall runs at turn start and writing at turn end; you can also ask the model to remember something.',
  sectionRecall: 'Latest recall',
  sectionItems: 'Recalled items',
  sectionTrace: 'Retrieval trace',
  sectionWrites: 'Written this turn',
  degraded: 'Memory is unavailable; this turn ran without it',
  noItems: 'This recall matched nothing',
  score: 'Relevance',
  latency: 'Latency',
  latencyUnit: 'ms',
  question: 'Question',
  queued: 'Accepted',
  refused: 'Not written',
} satisfies Record<MemoryKey, string>
