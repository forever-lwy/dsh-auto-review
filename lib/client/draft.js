/**
 * Settings-page drafts and their conversion into settings path operations.
 * Kept free of React so tests can run it directly.
 */
import { DEFAULT_SETTINGS, LIMITS, SETTING_KEYS, readSettings, } from '../policy.js';
export function reviewerKey(provider, model) {
    return provider === '' || model === '' ? '' : JSON.stringify([provider, model]);
}
export function parseReviewerKey(key) {
    if (key === '')
        return { provider: '', model: '' };
    try {
        const [provider, model] = JSON.parse(key);
        return typeof provider === 'string' && typeof model === 'string' ? { provider, model } : { provider: '', model: '' };
    }
    catch {
        return { provider: '', model: '' };
    }
}
/** Resolve a Host section, filling defaults for absent fields. */
export function resolveSection(value) {
    return readSettings(value && typeof value === 'object' ? value : {});
}
export function toDraft(settings) {
    return {
        defaultSandbox: settings.defaultSandbox,
        defaultApproval: settings.defaultApproval,
        reviewer: reviewerKey(settings.reviewerProvider, settings.reviewerModel),
        reviewerReasoning: settings.reviewerReasoning,
        timeoutSeconds: String(settings.timeoutSeconds),
        gateScope: settings.gateScope,
        exemptTools: settings.exemptTools.join(', '),
        onDeny: settings.onDeny,
        onError: settings.onError,
        historyMessages: String(settings.historyMessages),
        recentActions: String(settings.recentActions),
        maxTextChars: String(settings.maxTextChars),
        extraPolicy: settings.extraPolicy,
        logDecisions: settings.logDecisions,
    };
}
function integer(text, [min, max]) {
    const trimmed = text.trim();
    if (!/^\d+$/.test(trimmed))
        return undefined;
    const value = Number(trimmed);
    return value >= min && value <= max ? value : undefined;
}
/** Validate a draft: the settings it describes, or per-field error keys. */
export function parseDraft(draft) {
    const errors = {};
    const timeoutSeconds = integer(draft.timeoutSeconds, LIMITS.timeoutSeconds);
    if (timeoutSeconds === undefined)
        errors.timeoutSeconds = 'invalidNumber';
    const historyMessages = integer(draft.historyMessages, LIMITS.historyMessages);
    if (historyMessages === undefined)
        errors.historyMessages = 'invalidNumber';
    const recentActions = integer(draft.recentActions, LIMITS.recentActions);
    if (recentActions === undefined)
        errors.recentActions = 'invalidNumber';
    const maxTextChars = integer(draft.maxTextChars, LIMITS.maxTextChars);
    if (maxTextChars === undefined)
        errors.maxTextChars = 'invalidNumber';
    if (Object.keys(errors).length > 0)
        return { errors };
    const { provider, model } = parseReviewerKey(draft.reviewer);
    return {
        settings: readSettings({
            defaultSandbox: draft.defaultSandbox,
            defaultApproval: draft.defaultApproval,
            reviewerProvider: provider,
            reviewerModel: model,
            reviewerReasoning: draft.reviewerReasoning,
            timeoutSeconds, historyMessages, recentActions, maxTextChars,
            gateScope: draft.gateScope,
            exemptTools: draft.exemptTools.split(/[\s,，;；]+/),
            onDeny: draft.onDeny,
            onError: draft.onError,
            extraPolicy: draft.extraPolicy,
            logDecisions: draft.logDecisions,
        }),
    };
}
/** Field writes turning `current` into `next`; a field back at its default is unset. */
export function diffOps(current, next) {
    return SETTING_KEYS.flatMap((key) => {
        if (JSON.stringify(current[key]) === JSON.stringify(next[key]))
            return [];
        return JSON.stringify(next[key]) === JSON.stringify(DEFAULT_SETTINGS[key])
            ? [{ op: 'unset', path: [key] }]
            : [{ op: 'set', path: [key], value: next[key] }];
    });
}
/** Unset every field the user layer overrides. */
export function resetOps(user) {
    if (!user || typeof user !== 'object')
        return [];
    return Object.keys(user).filter(key => SETTING_KEYS.includes(key)).map(key => ({ op: 'unset', path: [key] }));
}
