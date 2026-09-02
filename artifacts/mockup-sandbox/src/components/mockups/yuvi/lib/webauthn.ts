/**
 * lib/webauthn.ts — biometric (WebAuthn PRF) helper.
 *
 * Thin wrapper around the platform WebAuthn API used only to obtain a PRF
 * ("pseudo-random function") output tied to a fingerprint/biometric
 * credential. That output is used by lib/vault.ts as key material — it
 * never touches the network; there is no server to verify against
 * (single-user local tool, same trust model as the vault it feeds).
 *
 * Falls back gracefully: if WebAuthn or the PRF extension isn't supported,
 * isSupported() reports false and vault.ts skips straight to PIN-only,
 * no broken UI.
 *
 * Ported from aa-os-yuvi/core/webauthn.js.
 */

const FIXED_SALT = new TextEncoder().encode("yuvi-vault-prf-v1");

export function isWebAuthnSupported(): boolean {
  return !!(
    typeof window !== "undefined" &&
    window.PublicKeyCredential &&
    navigator.credentials &&
    navigator.credentials.create
  );
}

function b64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(str: string): ArrayBuffer {
  let s = str.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

// PRF extension results aren't in the standard TS lib.dom types yet.
interface PRFExtensionResults {
  prf?: { results?: { first?: ArrayBuffer } };
}

/**
 * Registers a new platform credential (Face/Touch ID, Android biometric,
 * Windows Hello), then immediately performs an assertion against it with
 * the PRF extension to fetch the actual key material — most platforms
 * only return PRF results on get(), not create().
 */
export async function registerAndGetPRF(): Promise<{ credentialId: string; prfOutput: ArrayBuffer }> {
  const userId = crypto.getRandomValues(new Uint8Array(16));
  const challenge = crypto.getRandomValues(new Uint8Array(32));

  const cred = (await navigator.credentials.create({
    publicKey: {
      rp: { name: "YUVI", id: location.hostname },
      user: { id: userId, name: "yuvi-local-user", displayName: "YUVI" },
      challenge,
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "preferred",
      },
      timeout: 60000,
      extensions: { prf: {} } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;

  if (!cred) throw new Error("Biometric registration cancelled.");

  const credentialId = b64url(cred.rawId);
  const prfOutput = await getPRF(credentialId);
  if (!prfOutput) {
    throw new Error("This device/browser does not support the PRF extension needed for biometric unlock.");
  }
  return { credentialId, prfOutput };
}

export async function getPRF(credentialIdB64url: string): Promise<ArrayBuffer | null> {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge,
      allowCredentials: [{ id: unb64url(credentialIdB64url), type: "public-key" }],
      userVerification: "required",
      timeout: 60000,
      extensions: { prf: { eval: { first: FIXED_SALT } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;

  if (!assertion) return null;
  const ext = assertion.getClientExtensionResults() as PRFExtensionResults;
  if (!ext?.prf?.results?.first) return null;
  return ext.prf.results.first;
}
