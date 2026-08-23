/**
 * The sandbox POLICY home (`ctx.sandboxPolicy`): the single owner of the
 * deployment's sandbox fallbacks plus per-session resolution: the file-effect
 * {@link SandboxMode}, the independent outbound-network {@link NetworkPolicy},
 * the `workspace-write` root, and the override kit (the `sandbox/mode` and
 * `network/policy` events, their folds, and their write paths, from
 * `./session-mode.ts`). Before each agent request, the owner also contributes
 * the resolved policy to the cache-safe runtime-context snapshot. The agent
 * loop logs that snapshot as model history, so replay reconstructs the same
 * mode and root the enforcing consumers resolve without rewriting the stable
 * system prompt.
 *
 * Enforcing filesystem, one-shot bash, and terminal backends read the SAME
 * resolved file policy here; network-bearing consumers (the web tools) read
 * the resolved network policy. The context describes that policy without
 * inventorying capabilities, while each backend retains its own enforcement
 * dialect and each tool owns its operation-specific denial and escalation
 * guidance. The service reads session state once at each operation boundary;
 * executors and providers remain session-free.
 *
 * @module @deepseek-ai/dsh-sandbox-policy
 */

import { resolve as resolvePath } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import {
  NETWORK_POLICIES as NETWORK_POLICY_CHOICES,
  canonicalPath,
  type NetworkPolicy,
  type SandboxExecutionPolicy,
  type SandboxMode,
} from '@deepseek-ai/dsh-sandbox'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { effectiveNetworkPolicy, effectiveSandboxMode } from './session-mode.ts'

export {
  NETWORK_POLICIES,
  SANDBOX_MODES,
  effectiveNetworkPolicy,
  effectiveSandboxMode,
  setNetworkPolicy,
  setSandboxMode,
} from './session-mode.ts'

/** Resolve filesystem identity before lexical normalization can erase symlink-sensitive components. */
function resolveWorkspaceRoot(path: string): string {
  return resolvePath(canonicalPath(path))
}

/** Render the policy without claiming which capabilities are mounted. */
function renderPolicyContext(policy: SandboxExecutionPolicy): string {
  switch (policy.mode) {
    case 'read-only':
      return 'Current DSH file policy: read-only. Any available operation enforced by the DSH file sandbox cannot modify files in the standing mode. Do not refuse a required modification from this policy alone: try an available tool normally and follow any denial and escalation guidance it returns.'
    case 'workspace-write':
      return `Current DSH file policy: workspace-write. Any available operation enforced by the DSH file sandbox may modify files under the session workspace: ${JSON.stringify(policy.workspaceRoot)}. Some platform temporary areas may also be writable.`
    case 'danger-full-access':
      return 'Current DSH file policy: danger-full-access. The DSH file sandbox does not restrict file modifications by available operations.'
    /* v8 ignore next 4 -- SandboxMode is a typed same-process closed union; this branch is only the static exhaustiveness guard. */
    default: {
      const mode: never = policy.mode
      throw new Error(`unreachable sandbox mode: ${String(mode)}`)
    }
  }
}

/** Render the outbound-network policy, including the Windows restricted-token boundary guidance. */
function renderNetworkContext(policy: SandboxExecutionPolicy): string {
  const network = policy.network ?? 'allow'
  switch (network) {
    case 'allow':
      return 'Current DSH network policy: allow. Outbound network access (HTTP(S), TCP, DNS) is NOT restricted by the file sandbox, so no permission request is needed for the network itself; a network command that also writes files still obeys the file policy above (writing inside the workspace is allowed, so most network tasks — git clone, package installs, downloads into the workspace — complete without escalation; only writes outside the workspace need sandbox_permissions). On Windows under the restricted-token sandbox, Windows-native TLS stacks (curl.exe, git.exe, .NET Invoke-WebRequest) can fail with credential or certificate errors (SEC_E_NO_CREDENTIALS / CURLE_SSL_CONNECT_ERROR) while OpenSSL-based tools (node, python) keep working, and capturing a child program\'s output through a pipe can fail with access denied — run such programs with inherited stdio instead. If a network command still fails, suspect the environment (proxy, VPN, DNS) before assuming a policy block.'
    case 'deny':
      return 'Current DSH network policy: deny. Do not attempt outbound network access (HTTP(S), TCP, DNS) in shell commands or web tools; web_search and web_fetch are refused by policy, and network-bearing shell commands should be avoided.'
    /* v8 ignore next 4 -- NetworkPolicy is a typed same-process closed union; this branch is only the static exhaustiveness guard. */
    default: {
      const unreachable: never = network
      throw new Error(`unreachable network policy: ${String(unreachable)}`)
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    sandboxPolicy: SandboxPolicyService
  }
}

/**
 * Plugin config: the deployment's sandbox default. All optional — `Config`
 * supplies the defaults (`mode: 'read-only'` is the fail-safe default; a
 * deployment that wants a workspace-writable agent opts in explicitly). The
 * runner choice is NOT here (it is the `ctx.sandbox` provider's config), nor
 * is any per-family knob: this is the one shared policy home.
 */
export interface Config {
  /** File-sandbox mode a session starts from (default: `read-only`). */
  mode?: SandboxMode
  /**
   * Outbound-network policy a session starts from (default: `allow`). The
   * independent axis: `allow` keeps the file sandbox in place while network
   * access stays permitted (the file backends do not gate sockets); `deny`
   * tells network-bearing consumers (web tools) and the model to refuse
   * outbound access. A session override outranks this default.
   */
  networkAccess?: NetworkPolicy
  /**
   * Fallback root for agentless calls and sessions without a cwd (default:
   * `process.cwd()`). Normal agent calls use their session cwd instead.
   */
  workspaceRoot?: string
}

/** Inputs that select the sandbox policy for one capability call. */
export interface SandboxPolicyRequest {
  /** Calling session; its immutable cwd becomes the workspace boundary. */
  session?: Session
  /** Explicit approved mode override, which outranks session policy. */
  mode?: SandboxMode
  /** Explicit approved network-policy override, which outranks session policy. */
  network?: NetworkPolicy
}

/**
 * The sandbox-policy service (`ctx.sandboxPolicy`). Owns the deployment
 * default mode, fallback workspace root, and current request-time policy
 * section. Tool layers call {@link resolve} for each execution so a session's
 * mode log and immutable cwd travel together to every enforcing capability.
 */
export class SandboxPolicyService extends Service {
  // Inline schema call: the config catalog walks `static Config` statically.
  static Config: z<Config> = z.object({
    mode: z.union(['read-only', 'workspace-write', 'danger-full-access'] as const).default('read-only'),
    networkAccess: z.union(NETWORK_POLICY_CHOICES as NetworkPolicy[]).default('allow'),
    // No schema default: process.cwd() is resolved in the constructor so the
    // stored root is always absolute regardless of how it was supplied.
    workspaceRoot: z.string(),
  })

  /** The deployment default mode — the fallback beneath a session override. */
  readonly defaultMode: SandboxMode
  /** The deployment default network policy — the fallback beneath a session override. */
  readonly defaultNetwork: NetworkPolicy
  /** The absolute `workspace-write` fallback root for calls without a session cwd. */
  readonly workspaceRoot: string
  constructor(ctx: Context, config: Config) {
    super(ctx, 'sandboxPolicy')
    // schemastery (static Config) already filled `mode` and `networkAccess`;
    // the casts record those runtime facts. `workspaceRoot` has NO schema
    // default, so its fallback to the process cwd is real branching, resolved
    // absolute either way.
    this.defaultMode = config.mode as SandboxMode
    this.defaultNetwork = config.networkAccess as NetworkPolicy
    this.workspaceRoot = resolveWorkspaceRoot(config.workspaceRoot ?? process.cwd())

    ctx.inject(['systemPrompt'], (scope: Context) => {
      scope.systemPrompt.context({
        name: 'sandbox:policy',
        order: 110,
        text: (context) => {
          const session = context.agent?.session
          return session === undefined
            ? ''
            : renderPolicyContext(this.resolve({ session }))
        },
      })
      scope.systemPrompt.context({
        name: 'network:policy',
        order: 109,
        text: (context) => {
          const session = context.agent?.session
          return session === undefined
            ? ''
            : renderNetworkContext(this.resolve({ session }))
        },
      })
    })
  }

  /**
   * Resolve the complete policy for one capability call. An approved explicit
   * mode/network outranks the session's last `sandbox/mode`/`network/policy`
   * event, which outranks the deployment default. A session cwd is its
   * workspace-write boundary; the configured root is the fallback for
   * agentless calls and sessions without a cwd.
   * @param request - optional session and approved mode/network overrides.
   * @returns the fully resolved per-call mode, network policy, and absolute
   *   workspace root.
   */
  resolve(request: SandboxPolicyRequest = {}): SandboxExecutionPolicy {
    const { session } = request
    return {
      mode: request.mode ?? (session === undefined ? undefined : this.overrideOf(session)) ?? this.defaultMode,
      network: request.network ?? (session === undefined ? undefined : this.networkOverrideOf(session)) ?? this.defaultNetwork,
      workspaceRoot: resolveWorkspaceRoot(session?.header.cwd ?? this.workspaceRoot),
      ...session === undefined ? {} : { sessionId: session.id },
    }
  }

  /**
   * Read the session override without applying the deployment default.
   * @param session - session whose log supplies the override.
   * @returns the last logged mode, or `undefined` without one.
   */
  overrideOf(session: Session): SandboxMode | undefined {
    return effectiveSandboxMode(session.events)
  }

  /**
   * Read the session's network-policy override without applying the
   * deployment default.
   * @param session - session whose log supplies the override.
   * @returns the last logged policy, or `undefined` without one.
   */
  networkOverrideOf(session: Session): NetworkPolicy | undefined {
    return effectiveNetworkPolicy(session.events)
  }
}

export default SandboxPolicyService
