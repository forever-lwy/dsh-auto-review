/** The Settings → 自动审查 page. Edits stay local until Save; each write carries the revision it was read at. */
import { useCallback, useEffect, useId, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { APPROVAL_MODES, FALLBACKS, GATE_SCOPES, SANDBOX_MODES } from '../policy.js'
import type { AccessReviewRemote, ReviewerModelInfo, ReviewerModels } from '../remote.js'
import { diffOps, parseDraft, parseReviewerKey, resetOps, resolveSection, reviewerKey, toDraft, type Draft, type DraftErrors } from './draft.js'
import { fallbackT, type Translate } from './locales.js'

export interface FormLike {
  getSnapshot(): { status: 'loading' | 'ready' | 'unavailable'; value: unknown; user: unknown; revision: number | undefined; writable: boolean }
  subscribe(listener: () => void): () => void
  mutate(ops: readonly unknown[], expectedRevision?: number): Promise<boolean>
}

export interface SettingsProps {
  form: FormLike
  remote: () => AccessReviewRemote | undefined
  t?: Translate
  view?: 'summary' | 'page'
}

type Status = 'idle' | 'saving' | 'saved' | 'failed'
type Models = { status: 'loading' } | { status: 'ready'; value: ReviewerModels } | { status: 'failed'; error: string }

function useModels(remote: () => AccessReviewRemote | undefined): [Models, () => void] {
  const [models, setModels] = useState<Models>({ status: 'loading' })
  const [generation, setGeneration] = useState(0)
  useEffect(() => {
    const client = remote()
    if (client === undefined) { setModels({ status: 'failed', error: 'remote unavailable' }); return }
    const abort = new AbortController()
    setModels({ status: 'loading' })
    client.models(abort.signal).then(
      value => { if (!abort.signal.aborted) setModels({ status: 'ready', value }) },
      error => { if (!abort.signal.aborted) setModels({ status: 'failed', error: error instanceof Error ? error.message : String(error) }) },
    )
    return () => abort.abort()
  }, [remote, generation])
  return [models, useCallback(() => setGeneration(value => value + 1), [])]
}

function useModelInfo(remote: () => AccessReviewRemote | undefined, key: string): ReviewerModelInfo | undefined {
  const [info, setInfo] = useState<{ key: string; value: ReviewerModelInfo } | undefined>()
  useEffect(() => {
    const { provider, model } = parseReviewerKey(key)
    const client = remote()
    if (provider === '' || client === undefined) return
    const abort = new AbortController()
    client.modelInfo({ provider, model }, abort.signal).then(
      value => { if (!abort.signal.aborted) setInfo({ key, value }) },
      () => { if (!abort.signal.aborted) setInfo({ key, value: { efforts: [], defaultEffort: null } }) },
    )
    return () => abort.abort()
  }, [remote, key])
  return info?.key === key ? info.value : undefined
}

export function AccessReviewSettings(props: SettingsProps) {
  const t = props.t ?? fallbackT
  const snapshot = useSyncExternalStore(props.form.subscribe.bind(props.form), () => props.form.getSnapshot())
  const current = useMemo(() => resolveSection(snapshot.value), [snapshot.value])
  const accepted = useMemo(() => toDraft(current), [current])
  const [draft, setDraft] = useState<Draft>(accepted)
  const [dirty, setDirty] = useState(false)
  const [errors, setErrors] = useState<DraftErrors>({})
  const [status, setStatus] = useState<Status>('idle')
  const [models, reloadModels] = useModels(props.remote)
  const efforts = useModelInfo(props.remote, draft.reviewer)
  const id = useId()

  // Follow Host changes (another window, a reset) until the user starts editing.
  useEffect(() => { if (!dirty) setDraft(accepted) }, [accepted, dirty])

  if (props.view === 'summary') return <>{t('intro')}</>
  if (snapshot.status === 'loading') return <div className="dar2-settings"><p className="dar2-hint">{t('loading')}</p></div>
  if (snapshot.status === 'unavailable') return <div className="dar2-settings"><p className="dar2-hint">{t('unavailable')}</p></div>

  const disabled = !snapshot.writable || status === 'saving'
  const user = (snapshot.user && typeof snapshot.user === 'object' ? snapshot.user : {}) as Record<string, unknown>
  const edit = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft(previous => ({ ...previous, [key]: value, ...(key === 'reviewer' ? { reviewerReasoning: '' } : {}) }))
    setDirty(true)
    setErrors(previous => ({ ...previous, [key]: undefined }))
    if (status !== 'saving') setStatus('idle')
  }
  const write = async (ops: ReturnType<typeof diffOps>) => {
    if (ops.length === 0) { setDirty(false); return }
    setStatus('saving')
    try {
      const ok = await props.form.mutate(ops, snapshot.revision)
      setStatus(ok ? 'saved' : 'failed')
      if (ok) setDirty(false)
    } catch {
      setStatus('failed')
    }
  }
  const save = () => {
    const parsed = parseDraft(draft)
    if (parsed.errors) { setErrors(parsed.errors); return }
    void write(diffOps(current, parsed.settings))
  }
  const reset = () => {
    if (!window.confirm(t('resetConfirm'))) return
    setErrors({})
    void write(resetOps(snapshot.user))
  }

  const badge = (...fields: string[]) => fields.some(field => field in user) ? <span className="dar2-badge">{t('overridden')}</span> : null
  const field = (key: keyof Draft, label: string, input: ReactNode, hint?: string, overrides: string[] = [key]) => (
    <div className="dar2-field">
      <label htmlFor={`${id}-${key}`}>{label}{badge(...overrides)}</label>
      {input}
      {hint ? <small>{hint}</small> : null}
      {errors[key] ? <small className="dar2-err" role="alert">{t(errors[key]!)}</small> : null}
    </div>
  )
  const select = <K extends keyof Draft>(key: K, options: readonly { value: string; label: string }[], extra?: ReactNode) => (
    <select id={`${id}-${key}`} value={draft[key] as string} disabled={disabled} onChange={event => edit(key, event.target.value as Draft[K])}>
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      {extra}
    </select>
  )
  const number = (key: keyof Draft) => (
    <input id={`${id}-${key}`} type="text" inputMode="numeric" value={draft[key] as string} disabled={disabled}
      aria-invalid={errors[key] ? true : undefined} onChange={event => edit(key, event.target.value as never)} />
  )

  const providers = models.status === 'ready' ? models.value.providers : []
  const listed = new Set(providers.flatMap(group => group.models.map(model => reviewerKey(group.provider, model.id))))
  const configured = parseReviewerKey(draft.reviewer)
  const effortList = efforts?.efforts ?? []
  const reviewerSelect = (
    <select id={`${id}-reviewer`} value={draft.reviewer} disabled={disabled} onChange={event => edit('reviewer', event.target.value)}>
      <option value="">{t('option.sessionModel')}</option>
      {providers.filter(group => group.models.length > 0).map(group => (
        <optgroup key={group.provider} label={group.name}>
          {group.models.map(model => <option key={model.id} value={reviewerKey(group.provider, model.id)}>{model.name}</option>)}
        </optgroup>
      ))}
      {draft.reviewer !== '' && !listed.has(draft.reviewer)
        ? <option value={draft.reviewer}>{`${configured.provider} / ${configured.model} ${t('option.missing')}`}</option> : null}
    </select>
  )

  return (
    <div className="dar2-settings">
      <p>{t('intro')}</p>

      <fieldset>
        <legend>{t('section.defaults')}</legend>
        <div className="dar2-grid">
          {field('defaultSandbox', t('field.defaultSandbox'), select('defaultSandbox', SANDBOX_MODES.map(mode => ({ value: mode, label: t(`sandbox.${mode}`) }))))}
          {field('defaultApproval', t('field.defaultApproval'), select('defaultApproval', APPROVAL_MODES.map(mode => ({ value: mode, label: t(`approval.${mode}`) }))))}
        </div>
        <small className="dar2-hint">{t('hint.defaults')}</small>
      </fieldset>

      <fieldset>
        <legend>{t('section.reviewer')}</legend>
        {field('reviewer', t('field.reviewerModel'), (
          <div className="dar2-row">
            {reviewerSelect}
            <button type="button" onClick={reloadModels} disabled={models.status === 'loading'}>{t('models.reload')}</button>
          </div>
        ), models.status === 'loading' ? t('models.loading') : models.status === 'failed' ? `${t('models.failed')}${models.error}` : undefined,
        ['reviewerProvider', 'reviewerModel'])}
        <div className="dar2-grid">
          {field('reviewerReasoning', t('field.reviewerReasoning'), (
            <select id={`${id}-reviewerReasoning`} value={draft.reviewerReasoning} disabled={disabled || draft.reviewer === ''}
              onChange={event => edit('reviewerReasoning', event.target.value)}>
              <option value="">{t('option.defaultEffort')}</option>
              {effortList.map(effort => <option key={effort.id} value={effort.id}>{effort.name}</option>)}
              {draft.reviewerReasoning !== '' && !effortList.some(effort => effort.id === draft.reviewerReasoning)
                ? <option value={draft.reviewerReasoning}>{draft.reviewerReasoning}</option> : null}
            </select>
          ))}
          {field('timeoutSeconds', t('field.timeoutSeconds'), number('timeoutSeconds'))}
        </div>
        <small className="dar2-hint">{t('hint.reviewer')}</small>
      </fieldset>

      <fieldset>
        <legend>{t('section.scope')}</legend>
        {field('gateScope', t('field.gateScope'), select('gateScope', GATE_SCOPES.map(scope => ({ value: scope, label: t(`gate.${scope}`) }))), t('hint.gateScope'))}
        {field('exemptTools', t('field.exemptTools'), (
          <textarea id={`${id}-exemptTools`} rows={3} value={draft.exemptTools} disabled={disabled} onChange={event => edit('exemptTools', event.target.value)} />
        ), t('hint.exemptTools'))}
      </fieldset>

      <fieldset>
        <legend>{t('section.outcome')}</legend>
        <div className="dar2-grid">
          {field('onDeny', t('field.onDeny'), select('onDeny', FALLBACKS.map(value => ({ value, label: t(`fallback.${value}`) }))))}
          {field('onError', t('field.onError'), select('onError', FALLBACKS.map(value => ({ value, label: t(`fallback.${value}`) }))))}
        </div>
        <label className="dar2-toggle">
          <input type="checkbox" checked={draft.logDecisions} disabled={disabled} onChange={event => edit('logDecisions', event.target.checked)} />
          <span>{t('field.logDecisions')}{badge('logDecisions')}</span>
        </label>
      </fieldset>

      <fieldset>
        <legend>{t('section.context')}</legend>
        <div className="dar2-grid">
          {field('historyMessages', t('field.historyMessages'), number('historyMessages'))}
          {field('recentActions', t('field.recentActions'), number('recentActions'))}
          {field('maxTextChars', t('field.maxTextChars'), number('maxTextChars'))}
        </div>
      </fieldset>

      <fieldset>
        <legend>{t('section.policy')}</legend>
        {field('extraPolicy', t('section.policy'), (
          <textarea id={`${id}-extraPolicy`} rows={5} value={draft.extraPolicy} disabled={disabled} onChange={event => edit('extraPolicy', event.target.value)} />
        ), t('hint.extraPolicy'))}
      </fieldset>

      <div className="dar2-actions">
        <button type="button" data-action="save" disabled={disabled || !dirty} onClick={save}>{status === 'saving' ? t('saving') : t('save')}</button>
        <button type="button" disabled={disabled || Object.keys(user).length === 0} onClick={reset}>{t('reset')}</button>
        {status === 'saved' ? <span className="dar2-ok" role="status">{t('saved')}</span> : null}
        {status === 'failed' ? <span className="dar2-err" role="alert">{t('saveFailed')}</span> : null}
      </div>
    </div>
  )
}
