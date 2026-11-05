/**
 * Composer access control: one button in the built-in permission seat
 * (`conversation.input.permission`, a single slot the appearance tray does
 * not collect). Its menu has two independent groups — access (sandbox) and
 * approval — and stays open so both can be changed in one visit.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { APPROVAL_MODES, SANDBOX_MODES, needsRiskConfirmation, type ApprovalMode, type GateScope, type SandboxMode } from '../policy.js'
import type { Translate } from './locales.js'

export const PROJECTION_KEY = 'dshAccessReview'

export interface AccessView {
  sandbox: SandboxMode
  approval: ApprovalMode
  builtinAuto: boolean
}
export interface Choice { sandbox: SandboxMode; approval: ApprovalMode }

/** UI primitives supplied by the Web client (`@deepseek-ai/dsh-client-ui-primitives`). */
export interface Primitives {
  Menu: any
  RiskConfirmation: any
  IconChevronDownOutlineRegular?: any
  PermissionIconReadOnlyRegular?: any
  PermissionIconWorkspaceWriteRegular?: any
  PermissionIconFullAccessRegular?: any
}

export interface AccessSelectProps {
  locked: boolean
  useProjection: (key: string) => AccessView | undefined
  select: (choice: Choice) => Promise<void>
  gateScope: () => GateScope
  ui: Primitives
  t: Translate
}

function glyph(ui: Primitives, sandbox: SandboxMode): ReactNode {
  const Icon = sandbox === 'read-only' ? ui.PermissionIconReadOnlyRegular
    : sandbox === 'workspace-write' ? ui.PermissionIconWorkspaceWriteRegular : ui.PermissionIconFullAccessRegular
  return Icon ? <Icon /> : undefined
}

/** One sentence describing what a combination does, for the trigger tooltip. */
export function describeChoice(choice: Choice, builtin: boolean, gateScope: GateScope, t: Translate): string {
  if (builtin) return t('describe.builtin')
  const full = choice.sandbox === 'danger-full-access'
  const gated = choice.approval !== 'never' && (gateScope === 'always' || (gateScope === 'full-access' && full))
  const approval = gated || (full && choice.approval === 'never') ? t(`describe.gate.${choice.approval}`) : t(`describe.${choice.approval}`)
  return `${t(`describe.${choice.sandbox}`)} ${approval}`
}

export function AccessSelect({ locked, useProjection, select, gateScope, ui, t }: AccessSelectProps) {
  const view = useProjection(PROJECTION_KEY)
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<Choice | null>(null)
  const [confirm, setConfirm] = useState<Choice | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!locked) return
    setOpen(false)
    setConfirm(null)
    setAcknowledged(false)
  }, [locked])
  useEffect(() => {
    if (error === null) return
    const timer = setTimeout(() => setError(null), 6000)
    return () => clearTimeout(timer)
  }, [error])

  if (view === undefined || view === null) return null
  const builtin = pending === null && view.builtinAuto
  const shown: Choice = pending ?? { sandbox: view.sandbox, approval: view.approval }
  const sandboxLabel = t(`sandbox.${shown.sandbox}`)
  const approvalLabel = builtin ? t('short.builtin') : t(`short.${shown.approval}`)
  const fullLabel = `${sandboxLabel} · ${approvalLabel}`

  const submit = (choice: Choice) => {
    setPending(choice)
    select(choice).catch(failure => {
      setError(t('failed', { message: failure instanceof Error ? failure.message : String(failure) }))
    }).finally(() => setPending(null))
  }
  const choose = (id: string) => {
    const [dimension, value] = id.split(':') as [string, string]
    const base: Choice = { sandbox: shown.sandbox, approval: builtin ? 'model' : shown.approval }
    let next: Choice
    if (dimension === 'sandbox' && (SANDBOX_MODES as readonly string[]).includes(value)) next = { ...base, sandbox: value as SandboxMode }
    else if (dimension === 'approval' && (APPROVAL_MODES as readonly string[]).includes(value)) next = { ...base, approval: value as ApprovalMode }
    else return
    if (!builtin && next.sandbox === shown.sandbox && next.approval === shown.approval) return
    if (needsRiskConfirmation(next.sandbox, next.approval)) {
      setOpen(false)
      setAcknowledged(false)
      setConfirm(next)
      return
    }
    submit(next)
  }

  const items = [
    { type: 'label', id: 'label:sandbox', text: t('group.sandbox') },
    ...SANDBOX_MODES.map(mode => ({ id: `sandbox:${mode}`, label: t(`sandbox.${mode}`), icon: glyph(ui, mode) })),
    { type: 'separator', id: 'separator' },
    { type: 'label', id: 'label:approval', text: t('group.approval') },
    ...APPROVAL_MODES.map(mode => ({ id: `approval:${mode}`, label: t(`approval.${mode}`) })),
  ]
  const selectedIds = [`sandbox:${shown.sandbox}`, ...(builtin ? [] : [`approval:${shown.approval}`])]
  const { Menu, RiskConfirmation, IconChevronDownOutlineRegular: Chevron } = ui
  const unguarded = shown.sandbox === 'danger-full-access' && shown.approval === 'never' && !builtin

  return (
    <>
      <Menu
        open={open}
        items={items}
        selectedIds={selectedIds}
        onSelect={choose}
        onClose={() => setOpen(false)}
        side="top"
        portal
        anchor={
          <button
            type="button"
            className="dar2-trigger"
            data-dsh-auto-review=""
            {...(unguarded ? { 'data-unguarded': '' } : {})}
            aria-label={t('mode', { name: fullLabel })}
            aria-haspopup="menu"
            aria-expanded={open}
            title={describeChoice(shown, builtin, gateScope(), t)}
            disabled={locked}
            onClick={() => setOpen(value => !value)}
          >
            {glyph(ui, shown.sandbox) !== undefined && <span className="dar2-icon" aria-hidden>{glyph(ui, shown.sandbox)}</span>}
            <span className="dar2-label">{sandboxLabel}<span className="dar2-sep"> · </span>{approvalLabel}</span>
            {Chevron && <span className="dar2-chevron" data-open={open ? '' : undefined} aria-hidden><Chevron /></span>}
          </button>
        }
      />
      {confirm !== null && (
        <RiskConfirmation
          open
          title={t('confirm.title')}
          description={t(confirm.approval === 'never' ? 'confirm.never' : 'confirm.model')}
          acknowledgeLabel={t('confirm.acknowledge')}
          cancelLabel={t('confirm.cancel')}
          closeLabel={t('close')}
          confirmLabel={t('confirm.enable')}
          acknowledged={acknowledged}
          disabled={locked}
          onAcknowledgedChange={setAcknowledged}
          onCancel={() => { setAcknowledged(false); setConfirm(null) }}
          onConfirm={() => { const next = confirm; setAcknowledged(false); setConfirm(null); submit(next) }}
        />
      )}
      {error !== null && <div className="dar2-error" role="alert">{error}</div>}
    </>
  )
}
