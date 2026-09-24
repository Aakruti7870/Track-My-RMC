type JsonMap = Record<string, any>;

function decodeBase64Url(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function encodeBase64Url(value: ArrayBuffer | ArrayBufferView | null): string | null {
  if (value == null) return null;
  const view = ArrayBuffer.isView(value)
    ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    : new Uint8Array(value);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function browserCredentialApi(): CredentialsContainer {
  if (typeof navigator === "undefined" || !navigator.credentials) {
    throw new Error("Passkeys are not supported by this browser");
  }
  return navigator.credentials;
}

export function canUseBrowserPasskeys(): boolean {
  return typeof navigator !== "undefined" && !!navigator.credentials && typeof globalThis.PublicKeyCredential !== "undefined";
}

function credentialDescriptor(item: JsonMap): PublicKeyCredentialDescriptor {
  return {
    ...item,
    id: decodeBase64Url(item.id),
  } as PublicKeyCredentialDescriptor;
}

function registrationOptions(raw: JsonMap): PublicKeyCredentialCreationOptions {
  return {
    ...raw,
    challenge: decodeBase64Url(raw.challenge),
    user: { ...raw.user, id: decodeBase64Url(raw.user.id) },
    excludeCredentials: Array.isArray(raw.excludeCredentials)
      ? raw.excludeCredentials.map(credentialDescriptor)
      : undefined,
  } as PublicKeyCredentialCreationOptions;
}

function authenticationOptions(raw: JsonMap): PublicKeyCredentialRequestOptions {
  return {
    ...raw,
    challenge: decodeBase64Url(raw.challenge),
    allowCredentials: Array.isArray(raw.allowCredentials)
      ? raw.allowCredentials.map(credentialDescriptor)
      : undefined,
  } as PublicKeyCredentialRequestOptions;
}

function serializeCredential(credential: PublicKeyCredential): JsonMap {
  const response: any = credential.response;
  const serialized: JsonMap = {
    id: credential.id,
    rawId: encodeBase64Url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: (credential as any).authenticatorAttachment ?? null,
    clientExtensionResults: credential.getClientExtensionResults?.() ?? {},
    response: {
      clientDataJSON: encodeBase64Url(response.clientDataJSON),
    },
  };

  if ("attestationObject" in response) {
    serialized.response.attestationObject = encodeBase64Url(response.attestationObject);
    if (typeof response.getTransports === "function") {
      serialized.response.transports = response.getTransports();
    }
  } else {
    serialized.response.authenticatorData = encodeBase64Url(response.authenticatorData);
    serialized.response.signature = encodeBase64Url(response.signature);
    serialized.response.userHandle = encodeBase64Url(response.userHandle);
  }
  return serialized;
}

export async function createBrowserPasskey(rawOptions: JsonMap): Promise<JsonMap> {
  const credential = await browserCredentialApi().create({
    publicKey: registrationOptions(rawOptions),
  });
  if (!(credential instanceof PublicKeyCredential)) {
    throw new Error("Passkey creation was cancelled or did not return a credential");
  }
  return serializeCredential(credential);
}

export async function getBrowserPasskey(rawOptions: JsonMap): Promise<JsonMap> {
  const credential = await browserCredentialApi().get({
    publicKey: authenticationOptions(rawOptions),
  });
  if (!(credential instanceof PublicKeyCredential)) {
    throw new Error("Passkey verification was cancelled or did not return a credential");
  }
  return serializeCredential(credential);
}
