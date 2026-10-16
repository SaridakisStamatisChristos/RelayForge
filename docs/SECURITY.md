# Security

RelayForge intentionally implements a narrow security boundary rather than enterprise identity.

- All `/api/v1/**` routes require `Authorization: Bearer <API_AUTH_TOKEN>`; health/readiness do not.
- The token is environment-only and is redacted from API logging.
- Destination contracts require HTTPS and forbid credentials embedded in destination URLs.
- Redirect following is disabled by the delivery client.
- Arbitrary payloads are not logged by default.
- The current implementation does **not** claim comprehensive SSRF protection. DNS rebinding/private-address and cloud-metadata blocking are documented hardening opportunities.
- `.agent/policy.yaml`, auth code, CODEOWNERS and policy/verification scripts are forbidden autonomous modification surfaces.
- CI changes, migrations and configuration authority require review.
- The agent validator rejects path traversal, symlink escapes, test deletion, common token/private-key signatures, and unrestricted child-process execution additions.

Production deployments should place outbound egress behind infrastructure policy if private network access is a material risk.
