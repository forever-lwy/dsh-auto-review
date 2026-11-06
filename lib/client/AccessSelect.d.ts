import { type ApprovalMode, type GateScope, type SandboxMode } from '../policy.js';
import type { Translate } from './locales.js';
export declare const PROJECTION_KEY = "dshAccessReview";
export interface AccessView {
    sandbox: SandboxMode;
    approval: ApprovalMode;
    builtinAuto: boolean;
}
export interface Choice {
    sandbox: SandboxMode;
    approval: ApprovalMode;
}
/** UI primitives supplied by the Web client (`@deepseek-ai/dsh-client-ui-primitives`). */
export interface Primitives {
    Menu: any;
    RiskConfirmation: any;
    IconChevronDownOutlineRegular?: any;
    PermissionIconReadOnlyRegular?: any;
    PermissionIconWorkspaceWriteRegular?: any;
    PermissionIconFullAccessRegular?: any;
}
export interface AccessSelectProps {
    locked: boolean;
    useProjection: (key: string) => AccessView | undefined;
    select: (choice: Choice) => Promise<void>;
    gateScope: () => GateScope;
    ui: Primitives;
    t: Translate;
}
/** One sentence describing what a combination does, for the trigger tooltip. */
export declare function describeChoice(choice: Choice, builtin: boolean, gateScope: GateScope, t: Translate): string;
export declare function AccessSelect({ locked, useProjection, select, gateScope, ui, t }: AccessSelectProps): import("react").JSX.Element | null;
