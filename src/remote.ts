/** Typert Remote contract shared by the Host service and the browser settings page. */
import { z } from 'zod'
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info'

export const SERVICE = 'accessReview'

const empty = z.object({}).strict()
const effort = z.object({ id: z.string(), name: z.string() })
const model = z.object({ id: z.string(), name: z.string() })
export const modelsSchema = z.object({
  providers: z.array(z.object({
    provider: z.string(),
    name: z.string(),
    models: z.array(model),
    /** Listing failed; models may be empty. */
    error: z.string().optional(),
  })),
})
export type ReviewerModels = z.infer<typeof modelsSchema>

export const modelInfoRequestSchema = z.object({ provider: z.string().min(1).max(200), model: z.string().min(1).max(400) }).strict()
export const modelInfoSchema = z.object({
  efforts: z.array(effort),
  defaultEffort: z.string().nullable(),
})
export type ReviewerModelInfo = z.infer<typeof modelInfoSchema>

const codec = (schema: z.ZodType, typeSymbol: string) => ({ mode: 'strict' as const, typeSymbol, create: () => schema })
const method = (input: z.ZodType, output: z.ZodType) => ({
  service: SERVICE, invocation: { kind: 'direct' as const },
  parameters: [{ name: 'request', source: 'json' as const, codec: codec(input, 'AccessReviewRequest'), strictCodec: codec(input, 'AccessReviewRequest') }],
  result: codec(output, 'AccessReviewResult'), cancellation: { parameter: 'signal' as const },
})

export const remoteInfo = createTypertRemoteInfo({ package: 'dsh-auto-review', methods: {
  'accessReview/models': method(empty, modelsSchema),
  'accessReview/modelInfo': method(modelInfoRequestSchema, modelInfoSchema),
} }, z)

async function invoke<T>(remote: unknown, key: string, request: unknown, signal?: AbortSignal): Promise<T> {
  const result = await (remoteInfo.methods as any)[key].invoke(remote, { request }, signal)
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

/** Browser-side calls bound to one mounted remote. */
export interface AccessReviewRemote {
  models(signal?: AbortSignal): Promise<ReviewerModels>
  modelInfo(request: { provider: string; model: string }, signal?: AbortSignal): Promise<ReviewerModelInfo>
}

export function bindRemote(remote: unknown): AccessReviewRemote {
  return {
    models: signal => invoke(remote, 'accessReview/models', {}, signal),
    modelInfo: (request, signal) => invoke(remote, 'accessReview/modelInfo', request, signal),
  }
}
