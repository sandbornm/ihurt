# Security

Report a suspected vulnerability privately through [GitHub private vulnerability reporting](https://github.com/sandbornm/ihurt/security/advisories/new). If that form is unavailable, contact the maintainer through their GitHub profile before sharing details. Do not include API keys or personal journal files in a public issue.

The browser notebook stores personal notes in IndexedDB without additional encryption. Exports also contain personal information. See [privacy and limitations](docs/SAFETY.md).

AI integrations are optional. Local provider keys belong in the ignored `.env` file on the Python server. The hosted site's search key and security controls are maintained separately. A browser cookie is an anonymous allowance marker, not proof of a person's identity.

Routine tests use local fixtures and mocked providers. Please report findings without accessing another person's data, running paid requests at volume, or disrupting the service.
