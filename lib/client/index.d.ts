/**
 * Browser half.
 *
 * - Takes over the composer's permission seat (`conversation.input.permission`,
 *   a single slot) with a two-group access/approval menu. The seat is not one
 *   of the `conversation.input.left/right` lists, so dsh-appearance's button
 *   tray never collects it.
 * - Hides the built-in "default permission" row in General settings and adds
 *   Settings → 自动审查 (also shown on this bundle's Plugins page).
 *
 * Everything is registered only while the Host row serves its settings
 * namespace, so a disabled Host half leaves the built-in controls in place.
 */
import type { Context } from '@deepseek-ai/cordis';
import { AccessSelect } from './AccessSelect.js';
import { AccessReviewSettings } from './Settings.js';
export declare const name = "dsh-auto-review-client";
export declare const inject: string[];
/** Host row id from cordis.patch.yml, also its settings namespace. */
export declare const ENTRY = "access-review";
/** Renders nothing: shadows the built-in General-settings permission row. */
export declare function Hidden(): null;
export declare function apply(ctx: Context): Promise<void>;
export { AccessSelect, AccessReviewSettings };
