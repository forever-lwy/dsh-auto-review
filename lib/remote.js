/** Typert Remote contract shared by the Host service and the browser settings page. */
import { z } from 'zod';
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info';
export const SERVICE = 'accessReview';
const empty = z.object({}).strict();
const effort = z.object({ id: z.string(), name: z.string() });
const model = z.object({ id: z.string(), name: z.string() });
export const modelsSchema = z.object({
    providers: z.array(z.object({
        provider: z.string(),
        name: z.string(),
        models: z.array(model),
        /** Listing failed; models may be empty. */
        error: z.string().optional(),
    })),
});
export const modelInfoRequestSchema = z.object({ provider: z.string().min(1).max(200), model: z.string().min(1).max(400) }).strict();
export const modelInfoSchema = z.object({
    efforts: z.array(effort),
    defaultEffort: z.string().nullable(),
});
const codec = (schema, typeSymbol) => ({ mode: 'strict', typeSymbol, create: () => schema });
const method = (input, output) => ({
    service: SERVICE, invocation: { kind: 'direct' },
    parameters: [{ name: 'request', source: 'json', codec: codec(input, 'AccessReviewRequest'), strictCodec: codec(input, 'AccessReviewRequest') }],
    result: codec(output, 'AccessReviewResult'), cancellation: { parameter: 'signal' },
});
export const remoteInfo = createTypertRemoteInfo({ package: '@forever-lwy/dsh-auto-review', methods: {
        'accessReview/models': method(empty, modelsSchema),
        'accessReview/modelInfo': method(modelInfoRequestSchema, modelInfoSchema),
    } }, z);
async function invoke(remote, key, request, signal) {
    const result = await remoteInfo.methods[key].invoke(remote, { request }, signal);
    if (!result.ok)
        throw new Error(result.error.message);
    return result.value;
}
export function bindRemote(remote) {
    return {
        models: signal => invoke(remote, 'accessReview/models', {}, signal),
        modelInfo: (request, signal) => invoke(remote, 'accessReview/modelInfo', request, signal),
    };
}
