/** Generate a random 256-bit AES-GCM key */
export async function generateEncryptionKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

/** Export a CryptoKey to a base64url string */
export async function exportKey(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey("raw", key);
  return arrayBufferToBase64url(raw);
}

/** Import a base64url key string into a CryptoKey */
export async function importKey(keyStr: string): Promise<CryptoKey> {
  const raw = base64urlToArrayBuffer(keyStr);
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/** Encrypt text content with AES-256-GCM. Returns base64-encoded iv+ciphertext. */
export async function encryptText(plaintext: string, key: CryptoKey): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);

  // Concatenate iv + ciphertext
  const result = new Uint8Array(iv.length + ciphertext.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(ciphertext), iv.length);

  return arrayBufferToBase64(result.buffer);
}

/** Decrypt base64-encoded iv+ciphertext with AES-256-GCM. Returns plaintext string. */
export async function decryptText(encrypted: string, key: CryptoKey): Promise<string> {
  const data = base64ToArrayBuffer(encrypted);
  const iv = data.slice(0, 12);
  const ciphertext = data.slice(12);

  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(iv) },
    key,
    ciphertext
  );

  return new TextDecoder().decode(plaintext);
}

/** Encrypt file bytes with AES-256-GCM. Returns iv+ciphertext as ArrayBuffer. */
export async function encryptFile(data: ArrayBuffer, key: CryptoKey): Promise<ArrayBuffer> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);

  const result = new Uint8Array(iv.length + ciphertext.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(ciphertext), iv.length);

  return result.buffer;
}

/** Decrypt iv+ciphertext ArrayBuffer with AES-256-GCM. Returns original file bytes. */
export async function decryptFile(encrypted: ArrayBuffer, key: CryptoKey): Promise<ArrayBuffer> {
  const iv = encrypted.slice(0, 12);
  const ciphertext = encrypted.slice(12);

  return crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(iv) }, key, ciphertext);
}

// Utility conversions
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function arrayBufferToBase64url(buffer: ArrayBuffer): string {
  return arrayBufferToBase64(buffer).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlToArrayBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return base64ToArrayBuffer(padded);
}

/** Extract encryption key from URL hash fragment */
export function extractKeyFromHash(): string | null {
  const hash = window.location.hash;
  if (!hash) return null;
  const match = hash.match(/key=([A-Za-z0-9_-]+)/);
  return match ? match[1] : null;
}
