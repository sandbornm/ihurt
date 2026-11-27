import { AccountAuthError } from "./auth.ts";

const IDENTITY_HOST = "https://identitytoolkit.googleapis.com";

// WebAuthn relying party. On ihurt.app (and its subdomains) this is ihurt.app.
// A loopback page uses its own host, because a browser rejects a foreign rpId.
export function passkeyRpId(hostname: string, configured = "ihurt.app"): string {
  const host = hostname.trim().toLowerCase();
  const rp = configured.trim().toLowerCase() || "ihurt.app";
  if (host === rp || host.endsWith(`.${rp}`)) return rp;
  return host || rp;
}

export function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function credentialIds(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  return value.map((item) => {
    const row = item as { id?: unknown; transports?: AuthenticatorTransport[] };
    return {
      type: "public-key" as const,
      id: decodeBase64(typeof row.id === "string" ? row.id : ""),
      transports: row.transports,
    };
  });
}

export function prepareRequestOptions(
  raw: Record<string, unknown>,
  rpId: string,
): PublicKeyCredentialRequestOptions {
  return {
    challenge: decodeBase64(String(raw.challenge ?? "")),
    timeout: typeof raw.timeout === "number" ? raw.timeout : undefined,
    rpId,
    userVerification:
      raw.userVerification === "required" || raw.userVerification === "discouraged"
        ? raw.userVerification
        : "preferred",
    allowCredentials: credentialIds(raw.allowCredentials),
  };
}

export function prepareCreationOptions(
  raw: Record<string, unknown>,
  rpId: string,
): PublicKeyCredentialCreationOptions {
  const user = (raw.user ?? {}) as {
    id?: unknown;
    name?: unknown;
    displayName?: unknown;
  };
  const rp = (raw.rp ?? {}) as { name?: unknown };
  return {
    challenge: decodeBase64(String(raw.challenge ?? "")),
    rp: {
      name: typeof rp.name === "string" && rp.name ? rp.name : "iHurt",
      id: rpId,
    },
    user: {
      name: typeof user.name === "string" && user.name ? user.name : "iHurt",
      displayName:
        typeof user.displayName === "string" && user.displayName
          ? user.displayName
          : "iHurt",
      id: decodeBase64(typeof user.id === "string" ? user.id : ""),
    },
    pubKeyCredParams: Array.isArray(raw.pubKeyCredParams)
      ? (raw.pubKeyCredParams as PublicKeyCredentialParameters[])
      : [{ type: "public-key", alg: -7 }],
    timeout: typeof raw.timeout === "number" ? raw.timeout : undefined,
    excludeCredentials: credentialIds(raw.excludeCredentials),
    authenticatorSelection:
      raw.authenticatorSelection as AuthenticatorSelectionCriteria | undefined,
    attestation:
      raw.attestation === "direct" || raw.attestation === "indirect"
        ? raw.attestation
        : "none",
  };
}

export function publicKeyCredentialToJSON(credential: PublicKeyCredential) {
  const response = credential.response as AuthenticatorResponse & {
    attestationObject?: ArrayBuffer;
    authenticatorData?: ArrayBuffer;
    signature?: ArrayBuffer;
    userHandle?: ArrayBuffer | null;
  };
  const clientDataJSON = bufferToBase64(response.clientDataJSON);
  if (response.attestationObject) {
    return {
      id: credential.id,
      type: credential.type,
      rawId: bufferToBase64(credential.rawId),
      response: {
        clientDataJSON,
        attestationObject: bufferToBase64(response.attestationObject),
      },
    };
  }
  return {
    id: credential.id,
    type: credential.type,
    rawId: bufferToBase64(credential.rawId),
    response: {
      clientDataJSON,
      authenticatorData: bufferToBase64(
        response.authenticatorData ?? new ArrayBuffer(0),
      ),
      signature: bufferToBase64(response.signature ?? new ArrayBuffer(0)),
      userHandle: response.userHandle
        ? bufferToBase64(response.userHandle)
        : undefined,
    },
  };
}

interface PasskeyTokens {
  idToken: string;
  refreshToken: string;
  localId: string;
}

async function postIdentity(
  path: string,
  apiKey: string,
  body: unknown,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const response = await fetchImpl(
    `${IDENTITY_HOST}${path}?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const data = (await response.json().catch(() => ({}))) as {
    idToken?: unknown;
    refreshToken?: unknown;
    localId?: unknown;
    error?: { message?: unknown };
  };
  if (!response.ok) {
    throw new AccountAuthError(
      response.status === 403 ? "passkey-unavailable" : "passkey-failed",
    );
  }
  return data;
}

function tokensFrom(data: unknown): PasskeyTokens {
  const row = data as {
    idToken?: unknown;
    refreshToken?: unknown;
    localId?: unknown;
  };
  if (
    typeof row.idToken !== "string" ||
    typeof row.refreshToken !== "string" ||
    typeof row.localId !== "string"
  )
    throw new AccountAuthError("passkey-failed");
  return {
    idToken: row.idToken,
    refreshToken: row.refreshToken,
    localId: row.localId,
  };
}

export async function passkeySignIn(input: {
  apiKey: string;
  rpId: string;
  fetchImpl?: typeof fetch;
  credentials?: Pick<CredentialsContainer, "get">;
  name?: string;
}): Promise<PasskeyTokens> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const credentials = input.credentials ?? navigator.credentials;
  const started = (await postIdentity(
    "/v2/accounts/passkeySignIn:start",
    input.apiKey,
    {},
    fetchImpl,
  )) as { credentialRequestOptions?: Record<string, unknown> };
  const options = started.credentialRequestOptions;
  if (!options) throw new AccountAuthError("passkey-unavailable");
  const credential = await credentials.get({
    publicKey: prepareRequestOptions(options, input.rpId),
  });
  if (!credential) throw new AccountAuthError("cancelled");
  const name = input.name || "iHurt";
  const finished = await postIdentity(
    "/v2/accounts/passkeySignIn:finalize",
    input.apiKey,
    {
      authenticatorAuthenticationResponse: publicKeyCredentialToJSON(
        credential as PublicKeyCredential,
      ),
      name,
      displayName: name,
    },
    fetchImpl,
  );
  return tokensFrom(finished);
}

export async function passkeyEnroll(input: {
  apiKey: string;
  rpId: string;
  idToken: string;
  fetchImpl?: typeof fetch;
  credentials?: Pick<CredentialsContainer, "create">;
  name?: string;
}): Promise<void> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const credentials = input.credentials ?? navigator.credentials;
  const started = (await postIdentity(
    "/v2/accounts/passkeyEnrollment:start",
    input.apiKey,
    { idToken: input.idToken },
    fetchImpl,
  )) as { credentialCreationOptions?: Record<string, unknown> };
  const options = started.credentialCreationOptions;
  if (!options || !credentials.create)
    throw new AccountAuthError("passkey-unavailable");
  const credential = await credentials.create({
    publicKey: prepareCreationOptions(options, input.rpId),
  });
  if (!credential) throw new AccountAuthError("cancelled");
  const name = input.name || "iHurt";
  await postIdentity(
    "/v2/accounts/passkeyEnrollment:finalize",
    input.apiKey,
    {
      idToken: input.idToken,
      authenticatorRegistrationResponse: publicKeyCredentialToJSON(
        credential as PublicKeyCredential,
      ),
      name,
      displayName: name,
    },
    fetchImpl,
  );
}

export function tokenExpiryMs(idToken: string): number {
  try {
    const segment = idToken.split(".")[1] ?? "";
    const payload = JSON.parse(
      new TextDecoder().decode(decodeBase64(segment)),
    ) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

export async function refreshIdToken(
  apiKey: string,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ idToken: string; refreshToken: string; localId: string }> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const response = await fetchImpl(
    `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    },
  );
  const data = (await response.json().catch(() => ({}))) as {
    id_token?: unknown;
    refresh_token?: unknown;
    user_id?: unknown;
  };
  if (
    !response.ok ||
    typeof data.id_token !== "string" ||
    typeof data.refresh_token !== "string" ||
    typeof data.user_id !== "string"
  )
    throw new AccountAuthError("passkey-failed");
  return {
    idToken: data.id_token,
    refreshToken: data.refresh_token,
    localId: data.user_id,
  };
}
