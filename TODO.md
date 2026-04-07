# TODO

## Security

### Rate limiting

No rate limiting is applied to any endpoint. Add rate limiting middleware (e.g.
`@nestjs/throttler`) to protect login, OIDC callback, thread creation, and
WebSocket message sending against brute-force and abuse.
