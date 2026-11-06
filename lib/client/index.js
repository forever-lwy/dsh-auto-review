import * as primitives from '@deepseek-ai/dsh-client-ui-primitives';
import { readSettings } from '../policy.js';
import { bindRemote, remoteInfo } from '../remote.js';
import { AccessSelect } from './AccessSelect.js';
import { AccessReviewSettings } from './Settings.js';
import { en, NAMESPACE, zh } from './locales.js';
import { styles } from './styles.js';
export const name = 'dsh-auto-review-client';
export const inject = ['slots', 'locale', 'configForms', 'remote', 'sessions'];
/** npm package name: the key of this bundle's page on the Plugins page. */
const PACKAGE = '@forever-lwy/dsh-auto-review';
/** Host row id from cordis.patch.yml, also its settings namespace. */
export const ENTRY = 'access-review';
/** Below the built-in registrations (default priority 0), so ours renders. */
const SHADOW_PRIORITY = -100;
/** Renders nothing: shadows the built-in General-settings permission row. */
export function Hidden() { return null; }
export async function apply(ctx) {
    const c = ctx;
    try {
        const unmount = await c.remote.$mount(remoteInfo);
        ctx.effect(() => unmount, 'access-review: remote schema');
    }
    catch (error) {
        console.warn('[dsh-auto-review] model list unavailable', error);
    }
    let remote;
    ctx.inject(['remote.accessReview'], (scoped) => {
        remote = bindRemote(scoped.remote);
        scoped.effect(() => () => { remote = undefined; }, 'access-review: remote binding');
    });
    const getRemote = () => remote;
    ctx.effect(() => c.locale.register(NAMESPACE, 'zh', zh), 'access-review: Chinese');
    ctx.effect(() => c.locale.register(NAMESPACE, 'en', en), 'access-review: English');
    ctx.effect(() => {
        const node = document.createElement('style');
        node.dataset.plugin = PACKAGE;
        node.textContent = styles;
        document.head.appendChild(node);
        return () => node.remove();
    }, 'access-review: styles');
    const bound = c.locale.bind(NAMESPACE);
    const t = (key, params) => bound(key, params);
    const form = c.configForms.get(ENTRY);
    const gateScope = () => readSettings((form.getSnapshot().value ?? {})).gateScope;
    const ui = primitives;
    const submit = async (sessionId, choice) => {
        const live = c.sessions.binding(sessionId)?.session;
        if (live === undefined)
            throw new Error('this session is not ready yet');
        const result = await live.command(`/access ${choice.sandbox} ${choice.approval}`);
        if (!result.ok)
            throw new Error(`${result.error.code}: ${result.error.message}`);
        if (!result.value.matched)
            throw new Error('the Host offers no /access command');
        const outcome = result.value.result;
        if (outcome?.kind === 'error')
            throw new Error(outcome.text);
    };
    const settingsFace = () => ({ form, remote: getRemote, t });
    ctx.effect(() => c.configForms.whileServed([ENTRY], () => {
        const disposers = [
            c.slots.inject('conversation.input.permission', () => c.slots.register({
                name: 'conversation.input.permission',
                priority: SHADOW_PRIORITY,
                inject: (sessionId) => ({ select: (choice) => submit(sessionId, choice), gateScope, ui, t }),
            }, AccessSelect)),
            c.slots.inject('settings.general.item', () => c.slots.register({
                name: 'settings.general.item', id: 'permission', priority: SHADOW_PRIORITY,
            }, Hidden)),
            c.slots.inject('settings.section', () => c.slots.register({
                name: 'settings.section', id: 'dsh-auto-review', order: 65, label: () => t('nav'), inject: settingsFace,
            }, AccessReviewSettings)),
            c.slots.inject('plugins.bundle.config', () => c.slots.register({
                name: 'plugins.bundle.config', key: PACKAGE, inject: settingsFace,
            }, AccessReviewSettings)),
        ];
        return () => { for (const dispose of disposers.reverse())
            dispose(); };
    }), 'access-review: composer control and settings');
}
export { AccessSelect, AccessReviewSettings };
