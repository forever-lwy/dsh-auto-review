/** Typert Remote contract shared by the Host service and the browser settings page. */
import { z } from 'zod';
export declare const SERVICE = "accessReview";
export declare const modelsSchema: z.ZodObject<{
    providers: z.ZodArray<z.ZodObject<{
        provider: z.ZodString;
        name: z.ZodString;
        models: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            name: z.ZodString;
        }, z.core.$strip>>;
        error: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type ReviewerModels = z.infer<typeof modelsSchema>;
export declare const modelInfoRequestSchema: z.ZodObject<{
    provider: z.ZodString;
    model: z.ZodString;
}, z.core.$strict>;
export declare const modelInfoSchema: z.ZodObject<{
    efforts: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
    }, z.core.$strip>>;
    defaultEffort: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export type ReviewerModelInfo = z.infer<typeof modelInfoSchema>;
export declare const remoteInfo: import("@deepseek-ai/dsh-typert-protocol").TypertRemoteInfo<Readonly<Record<string, import("@deepseek-ai/dsh-typert-protocol").TypertRemoteMethod<object, unknown, "unary", never, unknown> | import("@deepseek-ai/dsh-typert-protocol").TypertRemoteMethod<object, unknown, "stream", unknown, unknown>>>>;
/** Browser-side calls bound to one mounted remote. */
export interface AccessReviewRemote {
    models(signal?: AbortSignal): Promise<ReviewerModels>;
    modelInfo(request: {
        provider: string;
        model: string;
    }, signal?: AbortSignal): Promise<ReviewerModelInfo>;
}
export declare function bindRemote(remote: unknown): AccessReviewRemote;
