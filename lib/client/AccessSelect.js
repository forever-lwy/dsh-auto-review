import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * Composer access control: one button in the built-in permission seat
 * (`conversation.input.permission`, a single slot the appearance tray does
 * not collect). Its menu has two independent groups — access (sandbox) and
 * approval — and stays open so both can be changed in one visit.
 */
import { useEffect, useState } from 'react';
import { APPROVAL_MODES, SANDBOX_MODES, needsRiskConfirmation } from '../policy.js';
export const PROJECTION_KEY = 'dshAccessReview';
function glyph(ui, sandbox) {
    const Icon = sandbox === 'read-only' ? ui.PermissionIconReadOnlyRegular
        : sandbox === 'workspace-write' ? ui.PermissionIconWorkspaceWriteRegular : ui.PermissionIconFullAccessRegular;
    return Icon ? _jsx(Icon, {}) : undefined;
}
/** One sentence describing what a combination does, for the trigger tooltip. */
export function describeChoice(choice, builtin, gateScope, t) {
    if (builtin)
        return t('describe.builtin');
    const full = choice.sandbox === 'danger-full-access';
    const gated = choice.approval !== 'never' && (gateScope === 'always' || (gateScope === 'full-access' && full));
    const approval = gated || (full && choice.approval === 'never') ? t(`describe.gate.${choice.approval}`) : t(`describe.${choice.approval}`);
    return `${t(`describe.${choice.sandbox}`)} ${approval}`;
}
export function AccessSelect({ locked, useProjection, select, gateScope, ui, t }) {
    const view = useProjection(PROJECTION_KEY);
    const [open, setOpen] = useState(false);
    const [pending, setPending] = useState(null);
    const [confirm, setConfirm] = useState(null);
    const [acknowledged, setAcknowledged] = useState(false);
    const [error, setError] = useState(null);
    useEffect(() => {
        if (!locked)
            return;
        setOpen(false);
        setConfirm(null);
        setAcknowledged(false);
    }, [locked]);
    useEffect(() => {
        if (error === null)
            return;
        const timer = setTimeout(() => setError(null), 6000);
        return () => clearTimeout(timer);
    }, [error]);
    if (view === undefined || view === null)
        return null;
    const builtin = pending === null && view.builtinAuto;
    const shown = pending ?? { sandbox: view.sandbox, approval: view.approval };
    const sandboxLabel = t(`sandbox.${shown.sandbox}`);
    const approvalLabel = builtin ? t('short.builtin') : t(`short.${shown.approval}`);
    const fullLabel = `${sandboxLabel} · ${approvalLabel}`;
    const submit = (choice) => {
        setPending(choice);
        select(choice).catch(failure => {
            setError(t('failed', { message: failure instanceof Error ? failure.message : String(failure) }));
        }).finally(() => setPending(null));
    };
    const choose = (id) => {
        const [dimension, value] = id.split(':');
        const base = { sandbox: shown.sandbox, approval: builtin ? 'model' : shown.approval };
        let next;
        if (dimension === 'sandbox' && SANDBOX_MODES.includes(value))
            next = { ...base, sandbox: value };
        else if (dimension === 'approval' && APPROVAL_MODES.includes(value))
            next = { ...base, approval: value };
        else
            return;
        if (!builtin && next.sandbox === shown.sandbox && next.approval === shown.approval)
            return;
        if (needsRiskConfirmation(next.sandbox, next.approval)) {
            setOpen(false);
            setAcknowledged(false);
            setConfirm(next);
            return;
        }
        submit(next);
    };
    const items = [
        { type: 'label', id: 'label:sandbox', text: t('group.sandbox') },
        ...SANDBOX_MODES.map(mode => ({ id: `sandbox:${mode}`, label: t(`sandbox.${mode}`), icon: glyph(ui, mode) })),
        { type: 'separator', id: 'separator' },
        { type: 'label', id: 'label:approval', text: t('group.approval') },
        ...APPROVAL_MODES.map(mode => ({ id: `approval:${mode}`, label: t(`approval.${mode}`) })),
    ];
    const selectedIds = [`sandbox:${shown.sandbox}`, ...(builtin ? [] : [`approval:${shown.approval}`])];
    const { Menu, RiskConfirmation, IconChevronDownOutlineRegular: Chevron } = ui;
    const unguarded = shown.sandbox === 'danger-full-access' && shown.approval === 'never' && !builtin;
    return (_jsxs(_Fragment, { children: [_jsx(Menu, { open: open, items: items, selectedIds: selectedIds, onSelect: choose, onClose: () => setOpen(false), side: "top", portal: true, anchor: _jsxs("button", { type: "button", className: "dar2-trigger", "data-dsh-auto-review": "", ...(unguarded ? { 'data-unguarded': '' } : {}), "aria-label": t('mode', { name: fullLabel }), "aria-haspopup": "menu", "aria-expanded": open, title: describeChoice(shown, builtin, gateScope(), t), disabled: locked, onClick: () => setOpen(value => !value), children: [glyph(ui, shown.sandbox) !== undefined && _jsx("span", { className: "dar2-icon", "aria-hidden": true, children: glyph(ui, shown.sandbox) }), _jsxs("span", { className: "dar2-label", children: [sandboxLabel, _jsx("span", { className: "dar2-sep", children: " \u00B7 " }), approvalLabel] }), Chevron && _jsx("span", { className: "dar2-chevron", "data-open": open ? '' : undefined, "aria-hidden": true, children: _jsx(Chevron, {}) })] }) }), confirm !== null && (_jsx(RiskConfirmation, { open: true, title: t('confirm.title'), description: t(confirm.approval === 'never' ? 'confirm.never' : 'confirm.model'), acknowledgeLabel: t('confirm.acknowledge'), cancelLabel: t('confirm.cancel'), closeLabel: t('close'), confirmLabel: t('confirm.enable'), acknowledged: acknowledged, disabled: locked, onAcknowledgedChange: setAcknowledged, onCancel: () => { setAcknowledged(false); setConfirm(null); }, onConfirm: () => { const next = confirm; setAcknowledged(false); setConfirm(null); submit(next); } })), error !== null && _jsx("div", { className: "dar2-error", role: "alert", children: error })] }));
}
