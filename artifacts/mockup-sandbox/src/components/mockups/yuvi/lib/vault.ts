/**
 * lib/vault.ts — encrypted secret vault (PIN + optional biometric unlock).
 *
 * Replaces plaintext localStorage for secrets (Groq key, GitHub PAT).
 *
 * Design (unchanged from the original):
 *  - One random 256-bit AES-GCM "master key" is generated once, on this device.
 *  - The master key itself is never stored in plaintext. It's "wrapped"
 *    (encrypted) once by a PIN-derived key (PBKDF2) and, optionally, a second
 *    time by a WebAuthn PRF-derived key (biometric). Either unwrap path
 *    recovers the same master key — unlocking with PIN or fingerprint are
 *    equivalent, neither is "primary".
 *  - Individual secrets are encrypted at rest with the master key and
 *    decrypted into an in-memory cache the moment the vault unlocks.
 *    Reads (getItem) are synchronous against that cache; writes encrypt
 *    to disk asynchronously right after the cache update.
 *  - Nothing here is a substitute for real server-side secret management —
 *    it's the right trade-off for a single-user client-only tool: secrets
 *    no longer sit in localStorage in plaintext for any XSS/log-leak/
 *    CSV-import bug to scoop up, and they're gone from memory the moment
 *    the vault is locked.
 *
 * Ported from aa-os-yuvi/core/vault.js. Module-level closure state replaces
 * the original's `window.YuviVault` singleton — same semantics, one vault
 * instance per page load either way.
 */

import { registerAndGetPRF, getPRF, isWebAuthnSupported } from "./webauthn";

const LS_SALT = "yuvi_vault_salt_pin";
const LS_WRAP_PIN = "yuvi_vault_wrap_pin";
const LS_WRAP_BIO = "yuvi_vault_wrap_bio";
const LS_BIO_CRED = "yuvi_vault_bio_cred";
const LS_ITEM_PFX = "yuvi_vault_item__";

const PBKDF2_ITER = 210000;

let _masterKey: CryptoKey | null = null;
let _cache: Record<string, string> = {};
let _locked = true;

// ── buffer helpers ───────────────────────────────────────────────────────
function b64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function unb64(str: string): ArrayBuffer {
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
function randBytes(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(n));
}

// ── key derivation ───────────────────────────────────────────────────────
async function deriveKeyFromPin(pin: string, saltB64: string | null): Promise<{ key: CryptoKey; saltB64: string }> {
  const salt = saltB64 ? new Uint8Array(unb64(saltB64)) : randBytes(16);
  const baseKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(pin)), "PBKDF2", false, [
    "deriveKey",
  ]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITER, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  return { key, saltB64: b64(salt.buffer) };
}

async function deriveKeyFromPRF(prfBytesArrayBuffer: ArrayBuffer): Promise<CryptoKey> {
  // PRF output may not be exactly 32 bytes depending on authenticator; hash
  // to fixed 256-bit key material.
  const digest = await crypto.subtle.digest("SHA-256", prfBytesArrayBuffer);
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

// ── generic wrap/unwrap of the master key ───────────────────────────────
async function wrapMasterKeyWith(wrapKey: CryptoKey): Promise<string> {
  if (!_masterKey) throw new Error("No master key to wrap.");
  const raw = await crypto.subtle.exportKey("raw", _masterKey);
  const iv = randBytes(12);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, wrapKey, raw);
  return `${b64(iv.buffer)}.${b64(ct)}`;
}
async function unwrapMasterKeyWith(wrapKey: CryptoKey, blob: string): Promise<CryptoKey> {
  const [ivB64, ctB64] = blob.split(".");
  const iv = new Uint8Array(unb64(ivB64));
  const ct = unb64(ctB64);
  const raw = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, wrapKey, ct);
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
}

// ── setup / status ────────────────────────────────────────────────────────
export function isSetup(): boolean {
  return !!localStorage.getItem(LS_WRAP_PIN);
}
export function isBiometricEnrolled(): boolean {
  return !!localStorage.getItem(LS_WRAP_BIO);
}
export function getBiometricCredentialId(): string {
  return localStorage.getItem(LS_BIO_CRED) || "";
}
export function isLocked(): boolean {
  return _locked;
}

export async function setupWithPin(pin: string): Promise<boolean> {
  _masterKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const d = await deriveKeyFromPin(pin, null);
  const wrapped = await wrapMasterKeyWith(d.key);
  localStorage.setItem(LS_SALT, d.saltB64);
  localStorage.setItem(LS_WRAP_PIN, wrapped);
  _locked = false;
  _cache = {};
  return true;
}

export async function unlockWithPin(pin: string): Promise<boolean> {
  try {
    const saltB64 = localStorage.getItem(LS_SALT);
    const wrapped = localStorage.getItem(LS_WRAP_PIN);
    if (!wrapped) return false;
    const d = await deriveKeyFromPin(pin, saltB64);
    _masterKey = await unwrapMasterKeyWith(d.key, wrapped);
    _locked = false;
    await _decryptAllIntoCache();
    return true;
  } catch {
    return false;
  }
}

// Rewrap with a new PIN. Requires vault already unlocked (masterKey in memory).
export async function setNewPin(newPin: string): Promise<boolean> {
  if (!_masterKey) return false;
  const d = await deriveKeyFromPin(newPin, null);
  const wrapped = await wrapMasterKeyWith(d.key);
  localStorage.setItem(LS_SALT, d.saltB64);
  localStorage.setItem(LS_WRAP_PIN, wrapped);
  return true;
}

// ── biometric (WebAuthn PRF) ─────────────────────────────────────────────
export async function enrollBiometric(): Promise<boolean> {
  if (!_masterKey) throw new Error("Vault must be unlocked before enrolling biometric.");
  if (!isWebAuthnSupported()) throw new Error("WebAuthn not supported on this device/browser.");
  const reg = await registerAndGetPRF();
  const wrapKey = await deriveKeyFromPRF(reg.prfOutput);
  const wrapped = await wrapMasterKeyWith(wrapKey);
  localStorage.setItem(LS_WRAP_BIO, wrapped);
  localStorage.setItem(LS_BIO_CRED, reg.credentialId);
  return true;
}

export async function unlockWithBiometric(): Promise<boolean> {
  try {
    const credId = getBiometricCredentialId();
    if (!credId) return false;
    const prfOutput = await getPRF(credId);
    if (!prfOutput) return false;
    const wrapKey = await deriveKeyFromPRF(prfOutput);
    const wrapped = localStorage.getItem(LS_WRAP_BIO);
    if (!wrapped) return false;
    _masterKey = await unwrapMasterKeyWith(wrapKey, wrapped);
    _locked = false;
    await _decryptAllIntoCache();
    return true;
  } catch {
    return false;
  }
}

export function removeBiometric(): void {
  localStorage.removeItem(LS_WRAP_BIO);
  localStorage.removeItem(LS_BIO_CRED);
}

export function lock(): void {
  _masterKey = null;
  _cache = {};
  _locked = true;
}

// ── item-level encrypt/decrypt ───────────────────────────────────────────
function _listItemKeys(): string[] {
  const out: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.indexOf(LS_ITEM_PFX) === 0) out.push(k.slice(LS_ITEM_PFX.length));
  }
  return out;
}

async function _decryptAllIntoCache(): Promise<void> {
  const names = _listItemKeys();
  for (const name of names) {
    try {
      _cache[name] = await _decryptItem(name);
    } catch {
      // corrupt/foreign entry — skip
    }
  }
}

async function _encryptItem(name: string, plaintext: string): Promise<void> {
  if (!_masterKey) return;
  const iv = randBytes(12);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    _masterKey,
    new TextEncoder().encode(String(plaintext)),
  );
  localStorage.setItem(LS_ITEM_PFX + name, `${b64(iv.buffer)}.${b64(ct)}`);
}
async function _decryptItem(name: string): Promise<string> {
  const blob = localStorage.getItem(LS_ITEM_PFX + name);
  if (!blob) return "";
  const [ivB64, ctB64] = blob.split(".");
  const iv = new Uint8Array(unb64(ivB64));
  const ct = unb64(ctB64);
  if (!_masterKey) throw new Error("Vault is locked.");
  const raw = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, _masterKey, ct);
  return new TextDecoder().decode(raw);
}

// Synchronous public API — cache is updated immediately, disk write happens
// right after (fire-and-forget, but same-tick reads always see the new value).
export function setItem(name: string, plaintext: string): void {
  _cache[name] = plaintext;
  if (_masterKey) {
    _encryptItem(name, plaintext).catch((e) => console.warn("[vault] encrypt failed for", name, e));
  }
}
export function getItem(name: string): string {
  return _cache[name] || "";
}
export function removeItem(name: string): void {
  delete _cache[name];
  localStorage.removeItem(LS_ITEM_PFX + name);
}
export function clearAllItems(): void {
  _listItemKeys().forEach((n) => localStorage.removeItem(LS_ITEM_PFX + n));
  _cache = {};
}

// ── one-time migration from legacy plaintext keys ────────────────────────
// Call after first successful unlock post-upgrade. Moves any old plaintext
// secrets into the vault, then deletes the plaintext copies.
export function migrateLegacyPlaintext(map: Record<string, string>): void {
  // map: { 'yuvi_groq_key': 'yuvi_groq_key' } (localStorageKey -> vaultItemName)
  Object.keys(map).forEach((lsKey) => {
    const v = localStorage.getItem(lsKey);
    if (v) {
      setItem(map[lsKey], v);
      localStorage.removeItem(lsKey);
    }
  });
}
