export declare const NAMESPACE = "dshAutoReview";
export declare const zh: Record<string, string>;
export declare const en: Record<string, string>;
export type Translate = (key: string, params?: Record<string, unknown>) => string;
/** Fallback translator (tests, or before the locale service binds). */
export declare function fallbackT(key: string, params?: Record<string, unknown>): string;
