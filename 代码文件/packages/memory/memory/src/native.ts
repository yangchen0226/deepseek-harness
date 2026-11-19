/** Model-native memory call protocol; independent of the tool registry. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { MemoryScope, MemoryRecallResult, MemoryRememberResult, MemoryProfileResult } from './types.ts'

/** Model-issued identity correlating one native call with its durable result. */
export type MemoryCallId = Branded<'MemoryCallId'>

/** Explicit structured model request; ordinary assistant prose is never executable. */
export type MemoryCallBlock = {
  readonly type: 'memory-call'
  readonly id: MemoryCallId
  readonly scope: MemoryScope
} & (
  | { readonly operation: 'recall'; readonly question: string }
  | { readonly operation: 'write'; readonly content: string }
  | { readonly operation: 'profile' }
)

/** Structured settlement; unknown writes must not be automatically retried. */
export type MemoryResultBlock = {
  readonly type: 'memory-result'
  readonly id: MemoryCallId
} & (
  | { readonly status: 'ok'; readonly operation: 'recall'; readonly value: MemoryRecallResult }
  | { readonly status: 'ok'; readonly operation: 'write'; readonly value: MemoryRememberResult }
  | { readonly status: 'ok'; readonly operation: 'profile'; readonly value: MemoryProfileResult }
  | { readonly status: 'disabled' | 'unsupported' | 'failed' | 'unknown'; readonly message: string }
)

declare module '@deepseek-ai/dsh-llm' {
  interface ContentBlockMap {
    'memory-call': MemoryCallBlock
    'memory-result': MemoryResultBlock
  }
  interface MessageSourceMap {
    'memory-native': { kind: 'memory-native' }
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Native request committed before its side effect. */
    'memory/call': MemoryCallBlock
    /** Native settlement committed before continuation. */
    'memory/result': MemoryResultBlock
  }
}
