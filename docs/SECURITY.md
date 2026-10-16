# Security

RelayForge intentionally implements a narrow security boundary rather than enterprise identity.

- All `/api/v1/**` routes require `Authorization: Bearer <API_AUTH_TOKEN>`; health/readiness do not.
- The token is environment-only and is redacted from API logging.
- Destination contracts require HTTPS and forbid credentials embedded in destination URLs.
- Redirect following is disabled by the delivery client.
- Arbitrary payloads are not logged by default.
- Outbound delivery enforces an application-level SSRF policy at delivery time:
  - `localhost` and `.localhost` names are rejected;
  - IPv4 loopback, private, link-local, carrier-grade NAT, benchmark, documentation, multicast and reserved ranges are rejected, including common metadata targets such as `169.254.169.254` and `100.100.100.200`;
  - IPv6 destinations must be global-unicast addresses in `2000::/3`, with documented/special transition ranges such as `2001::/23`, `2001:db8::/32`, `2002::/16` and `3fff::/20` rejected;
  - every DNS answer is validated and the destination is rejected if any answer is non-public;
  - the HTTPS connection is made with a pinned lookup result and connection reuse disabled, preventing a second DNS lookup from rebinding the same delivery to a private address;
  - unsafe destinations are recorded as permanent `UNSAFE_DESTINATION` failures instead of being retried.
- `.agent/policy.yaml`, auth code, CODEOWNERS and policy/verification scripts are forbidden autonomous modification surfaces.
- CI changes, migrations and configuration authority require review.
- The agent validator rejects path traversal, symlink escapes, test deletion, common token/private-key signatures, and unrestricted child-process execution additions.

These controls are defense in depth, not a universal SSRF claim. They assume RelayForge uses its direct Node HTTPS transport; future proxying, redirect-following, custom transport, or alternate resolver features must preserve the same address validation and connection-pinning invariant. Production deployments should still use outbound egress policy when private network access is a material risk.
