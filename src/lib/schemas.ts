import { z } from 'zod'

export const agentSnapshotSchema = z.object({
  agentId: z.string(),
  name: z.string(),
  timestamp: z.number(),
  version: z.string(),
  sessions: z.array(z.unknown()).default([]),
  cronJobs: z.array(z.unknown()).default([]),
  metrics: z.object({
    cpuPercent: z.number(),
    memUsedBytes: z.number(),
    memTotalBytes: z.number(),
    uptimeSeconds: z.number(),
  }),
  memoryFiles: z.object({
    memory: z.string().optional(),
    current: z.string().optional(),
    today: z.string().optional(),
  }).default({}),
  containers: z.array(z.unknown()).default([]),
})

export const wsAuthMessageSchema = z.object({
  type: z.literal('auth'),
  token: z.string().min(1),
  agentId: z.string().min(1),
  name: z.string().min(1),
  version: z.string(),
  gatewayUrl: z.string().optional(),
  gatewayToken: z.string().optional(),
})

export const wsSnapshotMessageSchema = z.object({
  type: z.literal('snapshot'),
  data: agentSnapshotSchema,
})

export const wsPingMessageSchema = z.object({
  type: z.literal('ping'),
})

export const wsMessageSchema = z.discriminatedUnion('type', [
  wsAuthMessageSchema,
  wsSnapshotMessageSchema,
  wsPingMessageSchema,
])

export type ValidatedSnapshot = z.infer<typeof agentSnapshotSchema>
export type ValidatedWsMessage = z.infer<typeof wsMessageSchema>
