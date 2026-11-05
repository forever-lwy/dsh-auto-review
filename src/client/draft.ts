/**
 * Settings-page drafts and their conversion into settings path operations.
 * Kept free of React so tests can run it directly.
 */
import {
  DEFAULT_SETTINGS, LIMITS, SETTING_KEYS, readSettings,
  type ApprovalMode, type Fallback, type GateScope, type ReviewSettings, type SandboxMode,
} from '../policy.js'

export interface Draft {
  defaultSandbox: SandboxMode
  defaultApproval: ApprovalMode
  /** `''` = the session model, else `JSON.stringify([provider, model])`. */
  reviewer: string
  reviewerReasoning: string
  timeoutSeconds: string
  gateScope: GateScope
  exemptTools: string
  onDeny: Fallback
  onError: Fallback
  historyMessages: string
  recentActions: string
  maxTextChars: string
  extraPolicy: string
  logDecisions: boolean
}

export type PathOp = { op: 'set'; path: string[]; value: unknown } | { op: 'unset'; path: string[] }
export type DraftErrors = Partial<Record<keyof Draft, string>>

export function reviewerKey(provider: string, model: string): string {
  return provider === '' || model === '' ? '' : JSON.stringify([provider, model])
}
export function parseReviewerKey(key: string): { provider: string; model: string } {
  if (key === '') return { provider: '', model: '' }
  try {
    const [provider, model] = JSON.parse(key) as [string, string]
    return typeof provider === 'string' && typeof model === 'string' ? { provider, model } : { provider: '', model: '' }
  } catch {
    return { provider: '', model: '' }
  }
}

/** Resolve a Host section, filling defaults for absent fields. */
export function resolveSection(value: unknown): ReviewSettings {
  return readSettings(value && typeof value === 'object' ? value as Record<string, unknown> : {})
}

export function toDraft(settings: ReviewSettings): Draft {
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
  }
}

function integer(text: string, [min, max]: readonly [number, number]): number | undefined {
  const trimmed = text.trim()
  if (!/^\d+$/.test(trimmed)) return undefined
  const value = Number(trimmed)
  return value >= min && value <= max ? value : undefined
}

/** Validate a draft: the settings it describes, or per-field error keys. */
export function parseDraft(draft: Draft): { settings: ReviewSettings; errors?: undefined } | { settings?: undefined; errors: DraftErrors } {
  const errors: DraftErrors = {}
  const timeoutSeconds = integer(draft.timeoutSeconds, LIMITS.timeoutSeconds)
  if (timeoutSeconds === undefined) errors.timeoutSeconds = 'invalidNumber'
  const historyMessages = integer(draft.historyMessages, LIMITS.historyMessages)
  if (historyMessages === undefined) errors.historyMessages = 'invalidNumber'
  const recentActions = integer(draft.recentActions, LIMITS.recentActions)
  if (recentActions === undefined) errors.recentActions = 'invalidNumber'
  const maxTextChars = integer(draft.maxTextChars, LIMITS.maxTextChars)
  if (maxTextChars === undefined) errors.maxTextChars = 'invalidNumber'
  if (Object.keys(errors).length > 0) return { errors }
  const { provider, model } = parseReviewerKey(draft.reviewer)
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
  }
}

/** Field writes turning `current` into `next`; a field back at its default is unset. */
export function diffOps(current: ReviewSettings, next: ReviewSettings): PathOp[] {
  return SETTING_KEYS.flatMap((key): PathOp[] => {
    if (JSON.stringify(current[key]) === JSON.stringify(next[key])) return []
    return JSON.stringify(next[key]) === JSON.stringify(DEFAULT_SETTINGS[key])
      ? [{ op: 'unset', path: [key] }]
      : [{ op: 'set', path: [key], value: next[key] }]
  })
}

/** Unset every field the user layer overrides. */
export function resetOps(user: unknown): PathOp[] {
  if (!user || typeof user !== 'object') return []
  return Object.keys(user).filter(key => (SETTING_KEYS as string[]).includes(key)).map(key => ({ op: 'unset', path: [key] }))
}
