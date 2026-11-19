/**
 * The shipped `memory` preset composes through the real preset registry.
 *
 * The registry refuses a preset whose plugins publish a service into the root
 * realm, so the memory provider and every consumer of `ctx.memory` must share
 * one isolated group. Unit suites build their own contexts and never cross
 * that check; this one mounts the rows read from the shipped patch file.
 */
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import * as memoryBear from '@deepseek-ai/dsh-memory-bear'
import * as toolMemory from '@deepseek-ai/dsh-tool-memory'
import * as memoryAutosave from '@deepseek-ai/dsh-memory-autosave'
import { loadCordisYaml, presetDefinitions } from '../../../../scripts/cordis-yaml.ts'
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import { declare, harness } from '../../../preset/agent-preset-registry/tests/harness.ts'

/** The memory plugins, served to the Loader under `cordis:` builtin names. */
const BUILTINS = {
  'memory-bear': memoryBear,
  'tool-memory': toolMemory,
  'memory-autosave': memoryAutosave,
} as const

/** One preset plugin row as the registry accepts it. */
type Row = PresetDefinition['plugins'][number]

/** The shipped preset's isolated memory group, renamed onto builtins. */
function memoryGroup(): Row {
  const source = readFileSync(new URL('../presets/memory.patch.yml', import.meta.url), 'utf8')
  const preset = presetDefinitions(loadCordisYaml(source)).find(definition => definition.id === 'memory')
  if (preset === undefined) throw new Error('the memory patch declares no `memory` preset')
  const group = (preset.plugins as Row[]).find(row => row.id === 'memory')
  if (group === undefined) throw new Error('the memory preset has no `memory` group')
  return {
    ...group,
    config: (group.config as Row[]).map(row => ({
      ...row,
      name: `cordis:${row.name.replace('@deepseek-ai/dsh-', '')}`,
    })),
  }
}

async function setup(): Promise<Context> {
  vi.stubEnv('MEMORYBEAR_API_KEY', 'key')
  vi.stubEnv('MEMORYBEAR_BASE_URL', 'http://memory.invalid')
  const ctx = await harness()
  Object.assign(ctx.loader.builtins, BUILTINS)
  return ctx
}

afterEach(() => { vi.unstubAllEnvs() })

describe('memory preset composition', () => {
  it('mounts the shipped memory group without leaking ctx.memory', async () => {
    const ctx = await setup()
    await declare(ctx, { id: 'memory-under-test', plugins: [memoryGroup()] })
    const record = await ctx.agentPresets.resolve('memory-under-test')
    expect(record.broken).toBeUndefined()
  })

  it('refuses the same rows outside an isolated group', async () => {
    const ctx = await setup()
    const flattened = memoryGroup().config as Row[]
    await declare(ctx, { id: 'memory-flattened', plugins: flattened })
    const record = await ctx.agentPresets.resolve('memory-flattened')
    expect(record.broken).toContain('require isolate realms: memory')
  })
})
