/** Durable collection activity independent of live session lifetime. */
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { MemoryActivityId, MemoryActivityEntry } from '@deepseek-ai/dsh-memory'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'

const scope = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('global') }),
  z.object({ kind: z.literal('workspace'), workspaceId: z.string().transform(value => value as WorkspaceId) }),
])
const activity: z.ZodType<MemoryActivityEntry> = z.object({
  id: z.string().transform(value => value as MemoryActivityId),
  scope,
  sessionId: z.string(),
  time: z.number(),
  operation: z.enum(['recall', 'write']),
  status: z.enum(['completed', 'accepted', 'failed', 'unknown']),
  origin: z.enum(['automatic', 'native', 'manual']).optional(),
  question: z.string().optional(),
  error: z.string().optional(),
  contents: z.array(z.string()),
  batchId: z.string().optional(),
})

/** Append-only audit index; remote acceptance is distinct from indexing. */
export const memoryActivityDomain = defineDomain({
  name: 'memory_activity', version: 1, layout: 'per-record',
  tables: { entries: domainTable<MemoryActivityId, MemoryActivityEntry>(activity) },
})
