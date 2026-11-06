import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/** The Settings → 自动审查 page. Edits stay local until Save; each write carries the revision it was read at. */
import { useCallback, useEffect, useId, useMemo, useState, useSyncExternalStore } from 'react';
import { APPROVAL_MODES, FALLBACKS, GATE_SCOPES, SANDBOX_MODES } from '../policy.js';
import { diffOps, parseDraft, parseReviewerKey, resetOps, resolveSection, reviewerKey, toDraft } from './draft.js';
import { fallbackT } from './locales.js';
function useModels(remote) {
    const [models, setModels] = useState({ status: 'loading' });
    const [generation, setGeneration] = useState(0);
    useEffect(() => {
        const client = remote();
        if (client === undefined) {
            setModels({ status: 'failed', error: 'remote unavailable' });
            return;
        }
        const abort = new AbortController();
        setModels({ status: 'loading' });
        client.models(abort.signal).then(value => { if (!abort.signal.aborted)
            setModels({ status: 'ready', value }); }, error => { if (!abort.signal.aborted)
            setModels({ status: 'failed', error: error instanceof Error ? error.message : String(error) }); });
        return () => abort.abort();
    }, [remote, generation]);
    return [models, useCallback(() => setGeneration(value => value + 1), [])];
}
function useModelInfo(remote, key) {
    const [info, setInfo] = useState();
    useEffect(() => {
        const { provider, model } = parseReviewerKey(key);
        const client = remote();
        if (provider === '' || client === undefined)
            return;
        const abort = new AbortController();
        client.modelInfo({ provider, model }, abort.signal).then(value => { if (!abort.signal.aborted)
            setInfo({ key, value }); }, () => { if (!abort.signal.aborted)
            setInfo({ key, value: { efforts: [], defaultEffort: null } }); });
        return () => abort.abort();
    }, [remote, key]);
    return info?.key === key ? info.value : undefined;
}
export function AccessReviewSettings(props) {
    const t = props.t ?? fallbackT;
    const snapshot = useSyncExternalStore(props.form.subscribe.bind(props.form), () => props.form.getSnapshot());
    const current = useMemo(() => resolveSection(snapshot.value), [snapshot.value]);
    const accepted = useMemo(() => toDraft(current), [current]);
    const [draft, setDraft] = useState(accepted);
    const [dirty, setDirty] = useState(false);
    const [errors, setErrors] = useState({});
    const [status, setStatus] = useState('idle');
    const [models, reloadModels] = useModels(props.remote);
    const efforts = useModelInfo(props.remote, draft.reviewer);
    const id = useId();
    // Follow Host changes (another window, a reset) until the user starts editing.
    useEffect(() => { if (!dirty)
        setDraft(accepted); }, [accepted, dirty]);
    if (props.view === 'summary')
        return _jsx(_Fragment, { children: t('intro') });
    if (snapshot.status === 'loading')
        return _jsx("div", { className: "dar2-settings", children: _jsx("p", { className: "dar2-hint", children: t('loading') }) });
    if (snapshot.status === 'unavailable')
        return _jsx("div", { className: "dar2-settings", children: _jsx("p", { className: "dar2-hint", children: t('unavailable') }) });
    const disabled = !snapshot.writable || status === 'saving';
    const user = (snapshot.user && typeof snapshot.user === 'object' ? snapshot.user : {});
    const edit = (key, value) => {
        setDraft(previous => ({ ...previous, [key]: value, ...(key === 'reviewer' ? { reviewerReasoning: '' } : {}) }));
        setDirty(true);
        setErrors(previous => ({ ...previous, [key]: undefined }));
        if (status !== 'saving')
            setStatus('idle');
    };
    const write = async (ops) => {
        if (ops.length === 0) {
            setDirty(false);
            return;
        }
        setStatus('saving');
        try {
            const ok = await props.form.mutate(ops, snapshot.revision);
            setStatus(ok ? 'saved' : 'failed');
            if (ok)
                setDirty(false);
        }
        catch {
            setStatus('failed');
        }
    };
    const save = () => {
        const parsed = parseDraft(draft);
        if (parsed.errors) {
            setErrors(parsed.errors);
            return;
        }
        void write(diffOps(current, parsed.settings));
    };
    const reset = () => {
        if (!window.confirm(t('resetConfirm')))
            return;
        setErrors({});
        void write(resetOps(snapshot.user));
    };
    const badge = (...fields) => fields.some(field => field in user) ? _jsx("span", { className: "dar2-badge", children: t('overridden') }) : null;
    const field = (key, label, input, hint, overrides = [key]) => (_jsxs("div", { className: "dar2-field", children: [_jsxs("label", { htmlFor: `${id}-${key}`, children: [label, badge(...overrides)] }), input, hint ? _jsx("small", { children: hint }) : null, errors[key] ? _jsx("small", { className: "dar2-err", role: "alert", children: t(errors[key]) }) : null] }));
    const select = (key, options, extra) => (_jsxs("select", { id: `${id}-${key}`, value: draft[key], disabled: disabled, onChange: event => edit(key, event.target.value), children: [options.map(option => _jsx("option", { value: option.value, children: option.label }, option.value)), extra] }));
    const number = (key) => (_jsx("input", { id: `${id}-${key}`, type: "text", inputMode: "numeric", value: draft[key], disabled: disabled, "aria-invalid": errors[key] ? true : undefined, onChange: event => edit(key, event.target.value) }));
    const providers = models.status === 'ready' ? models.value.providers : [];
    const listed = new Set(providers.flatMap(group => group.models.map(model => reviewerKey(group.provider, model.id))));
    const configured = parseReviewerKey(draft.reviewer);
    const effortList = efforts?.efforts ?? [];
    const reviewerSelect = (_jsxs("select", { id: `${id}-reviewer`, value: draft.reviewer, disabled: disabled, onChange: event => edit('reviewer', event.target.value), children: [_jsx("option", { value: "", children: t('option.sessionModel') }), providers.filter(group => group.models.length > 0).map(group => (_jsx("optgroup", { label: group.name, children: group.models.map(model => _jsx("option", { value: reviewerKey(group.provider, model.id), children: model.name }, model.id)) }, group.provider))), draft.reviewer !== '' && !listed.has(draft.reviewer)
                ? _jsx("option", { value: draft.reviewer, children: `${configured.provider} / ${configured.model} ${t('option.missing')}` }) : null] }));
    return (_jsxs("div", { className: "dar2-settings", children: [_jsx("p", { children: t('intro') }), _jsxs("fieldset", { children: [_jsx("legend", { children: t('section.defaults') }), _jsxs("div", { className: "dar2-grid", children: [field('defaultSandbox', t('field.defaultSandbox'), select('defaultSandbox', SANDBOX_MODES.map(mode => ({ value: mode, label: t(`sandbox.${mode}`) })))), field('defaultApproval', t('field.defaultApproval'), select('defaultApproval', APPROVAL_MODES.map(mode => ({ value: mode, label: t(`approval.${mode}`) }))))] }), _jsx("small", { className: "dar2-hint", children: t('hint.defaults') })] }), _jsxs("fieldset", { children: [_jsx("legend", { children: t('section.reviewer') }), field('reviewer', t('field.reviewerModel'), (_jsxs("div", { className: "dar2-row", children: [reviewerSelect, _jsx("button", { type: "button", onClick: reloadModels, disabled: models.status === 'loading', children: t('models.reload') })] })), models.status === 'loading' ? t('models.loading') : models.status === 'failed' ? `${t('models.failed')}${models.error}` : undefined, ['reviewerProvider', 'reviewerModel']), _jsxs("div", { className: "dar2-grid", children: [field('reviewerReasoning', t('field.reviewerReasoning'), (_jsxs("select", { id: `${id}-reviewerReasoning`, value: draft.reviewerReasoning, disabled: disabled || draft.reviewer === '', onChange: event => edit('reviewerReasoning', event.target.value), children: [_jsx("option", { value: "", children: t('option.defaultEffort') }), effortList.map(effort => _jsx("option", { value: effort.id, children: effort.name }, effort.id)), draft.reviewerReasoning !== '' && !effortList.some(effort => effort.id === draft.reviewerReasoning)
                                        ? _jsx("option", { value: draft.reviewerReasoning, children: draft.reviewerReasoning }) : null] }))), field('timeoutSeconds', t('field.timeoutSeconds'), number('timeoutSeconds'))] }), _jsx("small", { className: "dar2-hint", children: t('hint.reviewer') })] }), _jsxs("fieldset", { children: [_jsx("legend", { children: t('section.scope') }), field('gateScope', t('field.gateScope'), select('gateScope', GATE_SCOPES.map(scope => ({ value: scope, label: t(`gate.${scope}`) }))), t('hint.gateScope')), field('exemptTools', t('field.exemptTools'), (_jsx("textarea", { id: `${id}-exemptTools`, rows: 3, value: draft.exemptTools, disabled: disabled, onChange: event => edit('exemptTools', event.target.value) })), t('hint.exemptTools'))] }), _jsxs("fieldset", { children: [_jsx("legend", { children: t('section.outcome') }), _jsxs("div", { className: "dar2-grid", children: [field('onDeny', t('field.onDeny'), select('onDeny', FALLBACKS.map(value => ({ value, label: t(`fallback.${value}`) })))), field('onError', t('field.onError'), select('onError', FALLBACKS.map(value => ({ value, label: t(`fallback.${value}`) }))))] }), _jsxs("label", { className: "dar2-toggle", children: [_jsx("input", { type: "checkbox", checked: draft.logDecisions, disabled: disabled, onChange: event => edit('logDecisions', event.target.checked) }), _jsxs("span", { children: [t('field.logDecisions'), badge('logDecisions')] })] })] }), _jsxs("fieldset", { children: [_jsx("legend", { children: t('section.context') }), _jsxs("div", { className: "dar2-grid", children: [field('historyMessages', t('field.historyMessages'), number('historyMessages')), field('recentActions', t('field.recentActions'), number('recentActions')), field('maxTextChars', t('field.maxTextChars'), number('maxTextChars'))] })] }), _jsxs("fieldset", { children: [_jsx("legend", { children: t('section.policy') }), field('extraPolicy', t('section.policy'), (_jsx("textarea", { id: `${id}-extraPolicy`, rows: 5, value: draft.extraPolicy, disabled: disabled, onChange: event => edit('extraPolicy', event.target.value) })), t('hint.extraPolicy'))] }), _jsxs("div", { className: "dar2-actions", children: [_jsx("button", { type: "button", "data-action": "save", disabled: disabled || !dirty, onClick: save, children: status === 'saving' ? t('saving') : t('save') }), _jsx("button", { type: "button", disabled: disabled || Object.keys(user).length === 0, onClick: reset, children: t('reset') }), status === 'saved' ? _jsx("span", { className: "dar2-ok", role: "status", children: t('saved') }) : null, status === 'failed' ? _jsx("span", { className: "dar2-err", role: "alert", children: t('saveFailed') }) : null] })] }));
}
