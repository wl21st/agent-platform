# Agent Sandbox Evaluation Handoff

## Objective

Design a self-hosted, multi-tenant managed-agent platform with scalable **agent hands** (isolated execution) and **agent brains** (memory, skills, durable orchestration). The target is eventually on the order of one million concurrent users.

Key priorities:

- Kubernetes-like infrastructure foundation.
- Strong tenant/session isolation for untrusted code and tools.
- Self-hosting, privacy, transparency, and provider portability.
- Support for dynamic agent/subagent execution and human-in-the-loop pauses/resumes.
- Compatibility/migration concerns around OpenCode, Hermes, KiloCode, and related coding-agent tooling.
- Object storage should be a durable artifact capability, not the main live filesystem; use step-local scratch storage.

## Projects Discussed

### NanoClaw

**Role:** A secure, self-hosted personal-agent/edge runtime.

Notable design ideas:

- Container-per-agent-group isolation.
- Explicit host router and isolated agent containers.
- Mount-scoped workspaces and channel integrations.
- Skills act as deployable capabilities.
- Credentials are brokered/injected rather than simply copied into an agent environment.
- Local persistence, scheduled tasks, and messaging channels.

Assessment:

- Good reference for least-privilege execution, capability wiring, and agent-template packaging.
- Docker isolation is useful, but is not sufficient as the sole boundary for arbitrary model-generated or adversarial code in a multi-tenant service.
- Its fork-and-edit customization model should be replaced in a managed platform by declarative, versioned agent specifications and controlled rollout/promotion.

### Prime Agent

**Role:** A coding/research harness for long-running and self-improving agent work.

Notable design ideas:

- Persistent Python/IPython control environment.
- Recursive subagents and programmatic tool/delegation control.
- Continual Harness: durable prompts, memory, skills, and subagent specifications.
- Refinement workflow with proposed mutations, history, and rollback concepts.
- Long-running sessions, heartbeats, goals, and quality gates.

Assessment:

- Strong conceptual source for governed agent learning and durable subagent orchestration.
- Not a sandbox: generated Python and project commands execute with the user/runtime permissions.
- Do not let autonomous agents mutate global/shared policies or prompts. Scope changes to tenant/project/session and require eval, provenance, review/approval, versioning, staged rollout, and rollback before promotion.

### Mastra

**Role:** TypeScript agent/application framework and orchestration layer.

Relevant capabilities:

- Agents, workflows, memory, observability, evaluation-oriented tooling.
- Workspace abstraction for filesystem, command execution, background processes, skills, and artifacts.
- Sandbox adapters for remote providers including E2B, Daytona, and Blaxel.
- `LocalSandbox` for local development; runs child processes on the developer machine with optional OS-native restrictions.

Assessment:

- Best framework of the discussed options for integrating sandboxed code execution through a first-class workspace interface.
- Mastra is not itself the ultimate security boundary; the selected sandbox backend defines isolation strength, lifecycle, egress restrictions, and tenancy.
- Suitable as a TypeScript orchestration/application layer above a provider-neutral sandbox interface.

## Sandbox Conclusions

### Local development

Mastra is appropriate for local development on macOS:

```text
Mastra dev server on host
  -> LocalSandbox for fast, trusted local tasks
  -> dedicated ./workspaces/<project>/<session> path
  -> remote microVM sandbox for untrusted code and evaluation
```

Guidelines:

- Use a dedicated, throwaway agent workspace.
- Keep source checkout read-only when possible; work on a copy or branch.
- Deny network by default and allow only required domains/services.
- Do not mount home directories, SSH keys, cloud credential directories, secret databases, or production data.
- Treat LocalSandbox as a development containment aid, not a security-equivalent replacement for remote microVM isolation.

### Production / untrusted execution

Preferred security boundary: per-step ephemeral microVM or equivalent hard isolation, rather than ordinary containers.

Candidate directions:

| Option | Best use |
|---|---|
| E2B | Fast managed starting point; Firecracker microVM-style agent code-execution model |
| E2B BYOC | Near-term fit when control over networking, data plane, and cloud environment is required |
| Daytona | Richer, longer-lived development/repository workspaces |
| CubeSandbox / OpenSandbox | Worth evaluating for self-hosted/Kubernetes-oriented agent execution |
| OpenShell | Policy-enforcement component; not a complete sandbox fleet by itself |
| microsandbox | Local/self-hosted microVM experimentation; not sufficient alone as a large managed fleet |

Recommended practical path:

```text
Mastra / agent runtime
        |
Provider-neutral SandboxProvider interface
        |
E2B BYOC initially
        |
Kubernetes-native Firecracker, Kata, CubeSandbox, or OpenSandbox backend later
```

## Platform Design Direction

Use layers rather than choose a single framework.

### 1. Control plane

- Declarative, versioned `AgentSpec` definitions.
- Tenant/session identity and isolation policy.
- Quotas, budgets, approvals, and audit logs.
- Secret references and capability grants.
- Skill/artifact registry and evaluation gates.
- Routing/provider adapters and compatibility tooling.

### 2. Execution plane (agent hands)

- One isolated sandbox per untrusted execution step or session, according to risk/cost policy.
- Explicit filesystem mounts and step-local writable scratch disk.
- Network deny-by-default, allowlist-based egress.
- Short-lived capability-scoped credentials.
- CPU/memory/disk/time limits and automatic teardown.
- Stream logs/events and export approved artifacts.

### 3. Cognition plane (agent brains)

Adopt Prime Agent's governed-harness idea, but model it explicitly:

- Prompt notes / instruction overlays.
- Episodic evidence and task history.
- Semantic/project memory.
- Skills and tool configurations.
- Subagent playbooks.
- Evaluation outcomes and reliability metadata.

Memory records need scope, provenance, confidence, TTL/retention, retrieval policy, and inspectable UI/searchability.

### 4. Promotion plane

Controlled improvement lifecycle:

```text
observe -> propose patch -> replay/evaluate -> approve -> sign/version
-> staged rollout -> monitor -> rollback
```

Never silently promote model-authored prompt, policy, or skill modifications globally.

## Core Data Model

```text
AgentSpec          Immutable/versioned desired behavior
SessionState       Short-lived execution state and checkpoints
MemoryRecord       Content + provenance + scope + TTL + confidence + retrieval policy
SkillArtifact      Executable/package + required permissions + version + evaluation results
HarnessPatch       Proposed change + diff + evidence + approval/review status
PolicyDecision     Allowed/denied action + reason + actor + audit fields
SandboxLease       Sandbox identity + tenant/session + image + limits + expiry
ArtifactManifest   Object URI + checksum + producer step + access policy
```

## Storage Model

Use three storage classes:

```text
Hands workspace   = ephemeral local /sandbox and /tmp per execution step
Hands backpack    = tenant/session-scoped S3 or Blob prefixes for durable artifacts
Hands memory      = metadata/memory stores containing pointers, manifests, and retrieval indexes
```

Do not use an object-store mount as the primary live execution filesystem. Sync/download inputs into step-local scratch storage and upload explicit output artifacts with manifests/checksums.

## Security Baseline

For high-risk agent work:

- Fresh isolated environment per execution step.
- Immutable image/version pinning.
- No host mounts; minimally scoped data mounts only.
- Scoped, short-lived credentials; never static developer credentials.
- Egress restrictions, DNS/domain allowlists, and proxy/audit enforcement.
- Tool permission boundaries and human approval for consequential external actions.
- Artifact malware/content checks where appropriate.
- Full audit trail across session, subagent, tool call, policy decision, sandbox, and exported artifact.

## Open Questions / Next Work

1. Define `SandboxProvider` API: create/restore, exec, filesystem I/O, process control, artifact export, logs, lifecycle, and cleanup.
2. Build a sandbox evaluation matrix: E2B BYOC vs Daytona vs CubeSandbox/OpenSandbox vs Kata/Firecracker on Kubernetes.
3. Specify session graph orchestration above Kubernetes, including subagent fan-out/fan-in and human pause/resume semantics.
4. Define tenant isolation tiers: shared low-risk worker, per-session container, and per-step microVM.
5. Design a memory schema and promotion workflow that is inspectable, user-controlled, and compatible across agent tools.
6. Prototype a Mastra workspace adapter backed by the platform `SandboxProvider`, avoiding hard coupling to any one commercial sandbox vendor.
