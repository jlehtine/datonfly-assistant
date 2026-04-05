# TODO

## Security

### JWT token passing in URL fragment

After OIDC callback the JWT is delivered to the frontend via URL hash
(`/#token=...`). While the fragment is not sent to servers, it can leak via
browser history, extensions, or crash reports. Switch to an HTTP-only secure
cookie for the session token and add CSRF protection (e.g. double-submit cookie
or `SameSite=Strict`).

### Input validation of API bodies

Request bodies accepted by the REST API (e.g. thread creation, thread update)
have TypeScript types but no runtime validation. Add NestJS `ValidationPipe`
with `class-validator` DTOs to enforce maximum lengths, allowed values, and
correct types at the boundary.

### Rate limiting

No rate limiting is applied to any endpoint. Add rate limiting middleware (e.g.
`@nestjs/throttler`) to protect login, OIDC callback, thread creation, and
WebSocket message sending against brute-force and abuse.

### Operation audit logging

Security-sensitive operations (login, thread creation/deletion, membership
changes) are not audit-logged. Add structured audit logging for these events to
support incident investigation and compliance.
