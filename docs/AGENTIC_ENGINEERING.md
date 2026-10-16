# Agentic Engineering Contract

RelayForge is an independent target repository. The external control plane may normalize an authorized task, plan and generate a bounded change-set, run an adversarial review/repair pass, then execute the trusted verification profile in an isolated workspace. The maximum autonomous publication action is a **draft pull request**; merge remains human authority.

The model/task text cannot define verification commands. `.agent/verification.yaml` is trusted configuration. `.agent/policy.yaml` classifies paths, and `scripts/validate-agent-change.ts` evaluates proposed path/operation/content metadata before patch application.

Expected external sequence:

```text
EngineeringTask -> eligibility/policy -> planner/implementer/reviewer
-> bounded change set -> isolated RelayForge checkout -> trusted verification
-> evidence manifest -> agent/<task-id> branch -> DRAFT PR -> human review
```

RelayForge contains no OpenAI, GitHub or Linear secrets and does not need them for ordinary development. Those credentials belong to the external orchestration layer.
