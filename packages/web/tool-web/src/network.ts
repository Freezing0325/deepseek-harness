/**
 * The web tools' network-policy gate: refuse execution BEFORE any provider is
 * contacted when the calling session's resolved outbound-network policy is
 * `deny`. The policy is optional — a composition without a sandbox-policy
 * service has no network restriction, so an absent policy means `allow`.
 *
 * @module dsh-tool-web/network
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
// Side-effect type import: declaration-merges `ctx.sandboxPolicy` so
// `ctx.get('sandboxPolicy')` is typed; no value dependency on the service.
import type {} from '@deepseek-ai/dsh-sandbox-policy'

/**
 * Throw when the calling session's network policy denies outbound access. The
 * error text tells the model the block is policy (not a provider failure), so
 * it stops retrying and reports the policy instead.
 * @param ctx - context whose optional `sandboxPolicy` service supplies the
 *   per-session resolution; absent means no network restriction.
 * @param exec - the tool execution carrying the calling agent's session.
 */
export function assertNetworkAllowed(ctx: Context, exec: ToolExecution): void {
  const session = exec.agent?.session
  const policy = ctx.get('sandboxPolicy')?.resolve(session === undefined ? {} : { session })
  if (policy?.network === 'deny') {
    throw new Error('network access is denied by the current DSH network policy (deny); web_search/web_fetch are refused by policy — switch the session network policy to allow before retrying')
  }
}
