/** Exercise persistent memory policy in the shipped headless snapshot profile. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-tool-memory/types'

/** The fixture observes actual agent lifecycle. */
export const inject = ['agents']

/** Record explicit memory settings without issuing remote operations.
 * @param ctx - Assembled profile context.
 */
export function apply(ctx: Context): void {
  ctx.on('agent/created', ({ agent }) => {
    agent.session.append('memory/settings', { enabled: false })
    agent.session.append('memory/settings', { enabled: true })
  })
}
