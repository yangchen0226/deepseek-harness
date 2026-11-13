/** Memory tab header action. */
import { IconListPenOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MemoryKey } from './locales.ts'
import css from './MemoryHeaderAction.module.css'

/** What the header action needs from the plugin body. */
export interface MemoryHeaderInjected {
  /** Open (or reveal) the memory tab for this session. */
  readonly open: () => void
}

/** Props the session-header actions slot supplies. */
export interface MemoryHeaderActionProps extends MemoryHeaderInjected {
  /** Dictionary lookup bound to the `memory` namespace. */
  readonly t: (key: MemoryKey) => string
}

/**
 * The header button that opens the memory tab.
 *
 * It reads as one more icon action beside the job list and goal strip, so it
 * follows the same trigger shape: a 28px transparent control with a 14px
 * glyph, a hover tint, and a delayed tooltip carrying the accessible name.
 * @param props - the injected opener and the dictionary lookup.
 * @returns the rendered action.
 */
export function MemoryHeaderAction({ open, t }: MemoryHeaderActionProps) {
  const label = t('headerAction')
  return (
    <Tooltip label={label} delayMs={500} portal side="bottom">
      <button type="button" className={css.trigger} aria-label={label} onClick={open}>
        <span className={css.iconSlot} aria-hidden>
          <IconListPenOutlineRegular size={14} />
        </span>
      </button>
    </Tooltip>
  )
}
