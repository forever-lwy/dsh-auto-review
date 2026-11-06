import type { AccessReviewRemote } from '../remote.js';
import { type Translate } from './locales.js';
export interface FormLike {
    getSnapshot(): {
        status: 'loading' | 'ready' | 'unavailable';
        value: unknown;
        user: unknown;
        revision: number | undefined;
        writable: boolean;
    };
    subscribe(listener: () => void): () => void;
    mutate(ops: readonly unknown[], expectedRevision?: number): Promise<boolean>;
}
export interface SettingsProps {
    form: FormLike;
    remote: () => AccessReviewRemote | undefined;
    t?: Translate;
    view?: 'summary' | 'page';
}
export declare function AccessReviewSettings(props: SettingsProps): import("react").JSX.Element;
