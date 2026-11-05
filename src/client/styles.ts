/** Composer control (geometry copied from the built-in permission chip) and settings page. */
export const styles = `
.dar2-trigger{border-radius:var(--dsw-radius-sm,6px);min-width:0;max-width:260px;height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;outline:none;align-items:center;gap:4px;padding:0 4px 0 8px;font-size:13px;font-weight:500;line-height:20px;display:inline-flex;font-family:inherit}
.dar2-trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dar2-trigger:focus-visible{box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}
.dar2-trigger:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}
.dar2-trigger[data-unguarded]{color:var(--dsw-alias-state-warning-primary,#c27c0e)}
.dar2-icon{flex:none;display:inline-flex}.dar2-icon svg{width:14px;height:14px}
.dar2-label{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}
.dar2-sep{opacity:.55;padding:0 1px}
.dar2-chevron{color:var(--dsw-alias-label-caption);flex:none;transition:transform .12s;display:inline-flex}
.dar2-chevron[data-open]{transform:rotate(180deg)}
@container (width<=460px){.dar2-trigger .dar2-label{display:none}}
.dar2-error{position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:1000;max-width:min(90vw,520px);padding:8px 12px;border-radius:8px;background:var(--dsw-alias-bg-module-platform,#333);color:var(--dsw-alias-state-error-primary,#d54941);font-size:13px;box-shadow:0 4px 16px #0003}

.dar2-settings{max-width:900px;padding:4px 2px 24px;color:var(--dsw-alias-label-primary,inherit);font-size:14px;line-height:1.6}
.dar2-settings p{margin:6px 0 14px}
.dar2-settings fieldset{border:1px solid var(--dsw-alias-border-l2,#8885);border-radius:12px;padding:14px 16px;margin:16px 0;min-width:0}
.dar2-settings legend{font-weight:600;padding:0 7px}
.dar2-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:4px 18px}
.dar2-field{display:flex;flex-direction:column;gap:6px;margin-bottom:12px;min-width:0}
.dar2-field input,.dar2-field textarea,.dar2-field select{box-sizing:border-box;min-width:0;width:100%;border:1px solid var(--dsw-alias-border-l2,#8886);border-radius:7px;padding:7px 10px;background:var(--dsw-alias-bg-base,transparent);color:inherit;font:inherit}
.dar2-field select option,.dar2-field select optgroup{background:var(--dsw-alias-bg-module-platform,#fff);color:var(--dsw-alias-label-primary,#000)}
.dar2-field textarea{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;resize:vertical}
.dar2-field [aria-invalid=true]{border-color:var(--dsw-alias-state-error-primary,#d54941)}
.dar2-row{display:flex;gap:8px;align-items:center}.dar2-row>select{flex:1}
.dar2-toggle{display:flex;align-items:flex-start;gap:8px;margin:6px 0 4px;cursor:pointer}.dar2-toggle input{margin-top:5px}
.dar2-settings button{font:inherit;color:inherit;border:1px solid var(--dsw-alias-border-l2,#8886);background:transparent;border-radius:7px;padding:6px 12px;cursor:pointer}
.dar2-settings button:disabled{cursor:default;opacity:.55}
.dar2-settings input:focus-visible,.dar2-settings textarea:focus-visible,.dar2-settings select:focus-visible,.dar2-settings button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:2px}
.dar2-settings [data-action=save]{background:var(--dsw-alias-brand-primary,#4d6bfe);color:white;border-color:transparent}
.dar2-actions{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.dar2-hint,.dar2-field small{font-size:12px;color:var(--dsw-alias-label-tertiary,#888)}
.dar2-badge{margin-left:8px;font-size:11px;padding:0 6px;border-radius:4px;background:var(--dsw-alias-bg-secondary,#8882);color:var(--dsw-alias-label-secondary,#888)}
.dar2-err{color:var(--dsw-alias-state-error-primary,#d54941);overflow-wrap:anywhere}
.dar2-ok{color:var(--dsw-alias-state-success-primary,#16945f)}
`
