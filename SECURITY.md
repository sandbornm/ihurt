# Security

## Reporting Security Issues

**Please do not file public GitHub issues for security vulnerabilities.**

To report a security vulnerability, please email the details to security@momnt.dev. We will respond within 48 hours.

## Security Measures

### Input Validation & Sanitization

**XSS Prevention:**
- All user input is escaped before rendering (`escape()` function in `src/export.ts`)
- No use of `dangerouslySetInnerHTML`, `innerHTML`, `eval()`, or `Function()`
- Markdown rendering uses safe HTML escaping with explicit whitelisted tags
- URL validation rejects non-HTTPS URLs and credentials in URLs

**Data Validation:**
- JSON imports are validated through comprehensive type guards (`src/notebook-data.ts`)
- Numeric bounds checking on coordinates, intensities, and array sizes
- String length limits on all text fields
- Enum validation for model sources and layer types

**File Uploads:**
- Audio uploads limited to 60 seconds and 3MB
- Request body size limits enforced (24KB general, 3MB+ for audio)
- File type validation on import

### Content Security Policy

**HTTP Headers** (backend/app.py):
```
Content-Security-Policy: default-src 'self'; 
  script-src 'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com; 
  style-src 'self' 'unsafe-inline'; 
  img-src 'self' data: blob:; 
  font-src 'self'; 
  connect-src 'self'; 
  frame-src https://challenges.cloudflare.com; 
  worker-src 'self' blob:; 
  object-src 'none'; 
  base-uri 'self'; 
  frame-ancestors 'none'; 
  form-action 'self'
```

**Additional Security Headers:**
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`
- `Permissions-Policy: camera=(self), geolocation=(), microphone=(self)`
- `Strict-Transport-Security: max-age=31536000` (production only)
- `Cache-Control: no-store` (API endpoints)

### Authentication & Session Management

**Session Security:**
- Cryptographic session tokens using `itsdangerous.URLSafeTimedSerializer`
- 24-hour session expiry
- HttpOnly cookies (browser default)
- Random 32-byte session secret required in production

**Turnstile Bot Protection:**
- Cloudflare Turnstile challenges for AI features (optional, production recommended)
- Challenge tokens validated server-side before processing

### Rate Limiting & Abuse Prevention

**Per-Visitor Limits** (backend/limits.py):
- 3 AI analysis requests per day
- 6 turns per analysis session
- 12 requests per minute
- 12 new sessions per IP per day

**Cost Controls:**
- $5.00 daily budget cap across all users
- $0.10 reserved per analysis request
- $0.03 reserved per transcription request
- Requests rejected before API calls if budget exhausted

**Request Size Limits:**
- 3MB for audio transcription
- 24KB for other API requests

### Secret Management

**Server-Side Only:**
- API keys (OpenAI, Anthropic, Grok, ElevenLabs) stay on server
- No secrets in client code or git history
- `.env` file gitignored
- Gitleaks secret scanning in CI

**Production Requirements** (backend/config.py):
- SESSION_SECRET: minimum 32 characters
- HTTPS-only origins
- Explicit allowed hosts (no wildcards)
- Turnstile keys required when providers configured

### Privacy & Data Handling

**Local-First:**
- Notebook entries stored in browser IndexedDB
- No automatic uploads to servers
- Voice transcription is opt-in
- Research requests require explicit consent

**Export Safety:**
- Personal data sanitized in exports
- URLs validated before inclusion
- Attachments scanned for sensitive data
- `.ihm` bundles are JSON (no binary executable formats)

### Dependency Security

**Current Status:**
- npm audit: 0 vulnerabilities
- Automated dependency updates via Dependabot
- Node.js 22.23.4+ required (node2shell CVE fixed)

**Review Process:**
- Dependencies audited on every PR
- Production dependencies kept minimal (14 total)
- dev dependencies (236) isolated from runtime

### Model & AI Security

**Prompt Injection Mitigations:**
- User input and system prompts kept separate
- No user content executed as code
- Model responses validated against schema
- Safety messages for potential emergencies

**Provider Isolation:**
- All paid API calls routed through central spend gate
- Budget enforcement before provider reached
- Provider errors sanitized before display

### iOS Security

**Native App:**
- Camera/microphone permissions requested on-demand
- Files app integration for exports (no cloud uploads)
- Apple Speech on-device (no audio sent to servers)
- Health data read-only, excluded from exports

### Development Security

**CI/CD:**
- Gitleaks scans full git history on every PR
- Secrets never logged or exposed in CI
- Test fixtures use fake/demo data only

**Local Development:**
- Demo provider available without API keys
- Isolated test database (data/ihurt.sqlite3)
- Zero-dollar test budget enforced

## Security Checklist for Contributors

Before submitting a PR that touches security-sensitive areas:

- [ ] No secrets committed (run `git secrets --scan` or gitleaks locally)
- [ ] User input sanitized/escaped before display
- [ ] URLs validated (HTTPS only, no credentials)
- [ ] File uploads validated (type, size, content)
- [ ] JSON imports validated with type guards
- [ ] Cost/rate limits enforced before external calls
- [ ] Error messages don't leak sensitive data
- [ ] Tests cover security boundaries
- [ ] `npm audit` returns 0 vulnerabilities
- [ ] Privacy policy updated if data handling changes

## Threat Model

**In Scope:**
- XSS via crafted notebook entries or imports
- CSRF on API endpoints
- Excessive spending via abuse
- Secret exposure in git history or logs
- Prompt injection in AI features
- Path traversal in exports
- DoS via large requests

**Out of Scope:**
- Physical device theft
- Browser/OS vulnerabilities
- Compromised dependencies (covered by audit)
- Social engineering
- Man-in-the-middle (TLS handled by hosting)

## Security Contacts

- General security: security@momnt.dev
- Project maintainer: @sandbornm (GitHub)

---

Last updated: 2026-11-26
