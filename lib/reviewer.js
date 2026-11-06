/**
 * Reviewer: rebuild a compact, sourced view of the session for one pending
 * action and ask a model for an allow/deny verdict.
 */
import { BlockAssembler } from '@deepseek-ai/dsh-llm';
import { parseVerdict, reviewSystemPrompt, reviewUserText, } from './policy.js';
/** Text of one durable user message, attachments named but not inlined. */
function messageText(content) {
    if (!Array.isArray(content))
        return '';
    return content.map((block) => {
        if (block?.type === 'text' && typeof block.text === 'string')
            return block.text;
        if (block?.type === 'image')
            return '[image]';
        if (block?.type === 'file')
            return `[file: ${block.attachment?.name ?? 'attachment'}]`;
        return '';
    }).filter(Boolean).join('\n');
}
/**
 * Walk the model-visible surface once. Only human messages (and, in a
 * delegated child, its parent's task) are labelled as instructions; tool
 * calls are facts; assistant prose and tool results are left out.
 */
export function collectFacts(session, settings, callId) {
    const subagent = session.header.origin === 'subagent';
    const projectInstructions = [];
    const userMessages = [];
    const actions = [];
    let pending;
    for (const seq of session.surface.nodes) {
        const event = session.eventAt(seq);
        if (event === undefined)
            continue;
        if (event.type === 'user/message') {
            const source = event.data?.source ?? {};
            const body = messageText(event.data?.content);
            if (body === '')
                continue;
            if (source.kind === 'agent-instructions')
                projectInstructions.push(body);
            else if (source.kind === 'user' && typeof source.rpcId === 'string')
                userMessages.push(body);
            else if (subagent && (source.kind === 'user' || (source.kind === 'agent-message' && source.senderSessionId === session.header.parentSession))) {
                userMessages.push(`[task from the parent agent]\n${body}`);
            }
            continue;
        }
        if (event.type !== 'assistant/message')
            continue;
        for (const block of event.data?.message?.content ?? []) {
            if (block?.type !== 'tool-call')
                continue;
            const args = typeof block.arguments === 'string' ? block.arguments : JSON.stringify(block.arguments ?? {});
            if (callId !== undefined && block.id === callId) {
                let parsed = args;
                try {
                    parsed = args === '' ? {} : JSON.parse(args);
                }
                catch { /* keep raw */ }
                pending = { name: block.name, arguments: parsed };
                continue;
            }
            actions.push({ name: String(block.name), arguments: args });
        }
    }
    return {
        projectInstructions,
        userMessages: settings.historyMessages === 0 ? [] : userMessages.slice(-settings.historyMessages),
        recentActions: settings.recentActions === 0 ? [] : actions.slice(-settings.recentActions),
        ...(pending === undefined ? {} : { pending }),
    };
}
/** The reviewer route: configured, or the session's own latest model. */
export function routeFor(session, settings) {
    if (settings.reviewerProvider !== '' && settings.reviewerModel !== '') {
        return {
            provider: settings.reviewerProvider, model: settings.reviewerModel,
            ...(settings.reviewerReasoning === '' ? {} : { reasoningEffort: settings.reviewerReasoning }),
        };
    }
    const header = session.requestHeader();
    if (header === undefined || !header.config.provider || !header.config.model) {
        throw new Error('no reviewer model: configure one in Settings → Auto review, or send a message first so the session has a model');
    }
    return { provider: header.config.provider, model: header.config.model };
}
/** Assemble the reviewer input for one pending action. */
export function buildInput(request, settings) {
    const facts = collectFacts(request.session, settings, request.callId);
    return {
        kind: request.kind,
        cwd: request.cwd,
        sandbox: request.sandbox,
        reason: request.reason,
        tool: request.tool ?? facts.pending,
        projectInstructions: facts.projectInstructions,
        userMessages: facts.userMessages,
        recentActions: facts.recentActions,
        subagent: request.session.header.origin === 'subagent',
    };
}
/** Stream one reviewer call and parse its verdict. */
export async function askReviewer(llm, route, settings, input, signal) {
    const assembler = new BlockAssembler();
    let finished = false;
    for await (const chunk of llm.stream({
        provider: route.provider,
        model: route.model,
        ...(route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort }),
        system: reviewSystemPrompt(settings.extraPolicy),
        messages: [{ role: 'user', content: [{ type: 'text', text: reviewUserText(input, settings.maxTextChars) }] }],
        signal,
    })) {
        assembler.push(chunk);
        if (chunk?.type !== 'finish')
            continue;
        finished = true;
        const kind = chunk.reason?.kind;
        if (kind === 'error' || kind === 'aborted') {
            const failure = chunk.reason.failure ?? {};
            throw new Error(`reviewer ${kind}: ${failure.code ?? ''} ${failure.message ?? ''}`.trim());
        }
    }
    if (!finished)
        throw new Error('reviewer stream ended without finishing');
    const text = assembler.blocks().filter((block) => block.type === 'text').map((block) => block.text).join('');
    return parseVerdict(text);
}
