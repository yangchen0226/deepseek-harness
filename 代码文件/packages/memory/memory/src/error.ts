/** Machine-routable memory-engine failures. @module */

import { HarnessError } from '@deepseek-ai/dsh-error'

/**
 * Every {@link MemoryError} code:
 * - `MEMORY_UNAVAILABLE` — the engine is unreachable, misconfigured, or rejected credentials. `recall`
 *   converts this into a degraded result; every other operation rejects with it.
 * - `MEMORY_UNSUPPORTED` — the engine does not implement the operation (for example, removal on an
 *   upstream surface that exposes no delete endpoint).
 * - `MEMORY_INVALID_REQUEST` — the caller supplied a value the engine cannot accept.
 * - `MEMORY_UPSTREAM_REJECTED` — the engine answered and refused the operation for a reason the caller
 *   must see unchanged, such as a quota or a missing end-user binding.
 */
export const MEMORY_ERROR_CODES = [
  'MEMORY_UNAVAILABLE',
  'MEMORY_UNSUPPORTED',
  'MEMORY_INVALID_REQUEST',
  'MEMORY_UPSTREAM_REJECTED',
] as const

/** One code from {@link MEMORY_ERROR_CODES}. */
export type MemoryErrorCode = typeof MEMORY_ERROR_CODES[number]

/** Memory-engine failure carrying a stable {@link MemoryErrorCode}. */
export class MemoryError extends HarnessError {
  override readonly code: MemoryErrorCode

  /**
   * @param message - names the operation and the safe next step.
   * @param code - the failure class consumers route on.
   * @param options - standard `cause` chaining.
   */
  constructor(message: string, code: MemoryErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'MemoryError'
    this.code = code
  }
}
