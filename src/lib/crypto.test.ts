import { describe, it, expect } from "vitest";
import {
  generateEncryptionKey,
  exportKey,
  importKey,
  encryptText,
  decryptText,
  encryptFile,
  decryptFile,
} from "./crypto";

describe("Key generation and import/export", () => {
  it("generates a valid AES-GCM key", async () => {
    const key = await generateEncryptionKey();
    expect(key.algorithm).toEqual({ name: "AES-GCM", length: 256 });
    expect(key.extractable).toBe(true);
    expect(key.usages).toContain("encrypt");
    expect(key.usages).toContain("decrypt");
  });

  it("exports key to base64url string", async () => {
    const key = await generateEncryptionKey();
    const exported = await exportKey(key);
    expect(typeof exported).toBe("string");
    expect(exported.length).toBeGreaterThan(0);
    // base64url has no + / or =
    expect(exported).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("round-trips key export/import", async () => {
    const key = await generateEncryptionKey();
    const exported = await exportKey(key);
    const imported = await importKey(exported);
    expect(imported.algorithm).toEqual({ name: "AES-GCM", length: 256 });
  });

  it("generates unique keys", async () => {
    const key1 = await exportKey(await generateEncryptionKey());
    const key2 = await exportKey(await generateEncryptionKey());
    expect(key1).not.toBe(key2);
  });
});

describe("Text encryption/decryption", () => {
  it("encrypts and decrypts text correctly", async () => {
    const key = await generateEncryptionKey();
    const plaintext = "Hello, World! This is a test message.";

    const encrypted = await encryptText(plaintext, key);
    expect(encrypted).not.toBe(plaintext);
    expect(typeof encrypted).toBe("string");

    const decrypted = await decryptText(encrypted, key);
    expect(decrypted).toBe(plaintext);
  });

  it("handles empty strings", async () => {
    const key = await generateEncryptionKey();
    const encrypted = await encryptText("", key);
    const decrypted = await decryptText(encrypted, key);
    expect(decrypted).toBe("");
  });

  it("handles unicode content", async () => {
    const key = await generateEncryptionKey();
    const plaintext = "Hello 🌍 世界 مرحبا";

    const encrypted = await encryptText(plaintext, key);
    const decrypted = await decryptText(encrypted, key);
    expect(decrypted).toBe(plaintext);
  });

  it("handles large content", async () => {
    const key = await generateEncryptionKey();
    const plaintext = "x".repeat(100_000);

    const encrypted = await encryptText(plaintext, key);
    const decrypted = await decryptText(encrypted, key);
    expect(decrypted).toBe(plaintext);
  });

  it("produces different ciphertext for same plaintext (random IV)", async () => {
    const key = await generateEncryptionKey();
    const plaintext = "Same content";

    const encrypted1 = await encryptText(plaintext, key);
    const encrypted2 = await encryptText(plaintext, key);
    expect(encrypted1).not.toBe(encrypted2);
  });

  it("fails to decrypt with wrong key", async () => {
    const key1 = await generateEncryptionKey();
    const key2 = await generateEncryptionKey();

    const encrypted = await encryptText("secret", key1);

    await expect(decryptText(encrypted, key2)).rejects.toThrow();
  });

  it("handles markdown content", async () => {
    const key = await generateEncryptionKey();
    const plaintext = `# Heading\n\n- item 1\n- item 2\n\n\`\`\`js\nconsole.log("hello");\n\`\`\``;

    const encrypted = await encryptText(plaintext, key);
    const decrypted = await decryptText(encrypted, key);
    expect(decrypted).toBe(plaintext);
  });
});

describe("File encryption/decryption", () => {
  it("encrypts and decrypts file data correctly", async () => {
    const key = await generateEncryptionKey();
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer;

    const encrypted = await encryptFile(data, key);
    expect(encrypted.byteLength).toBeGreaterThan(data.byteLength); // IV + ciphertext + auth tag

    const decrypted = await decryptFile(encrypted, key);
    expect(new Uint8Array(decrypted)).toEqual(new Uint8Array(data));
  });

  it("handles empty files", async () => {
    const key = await generateEncryptionKey();
    const data = new ArrayBuffer(0);

    const encrypted = await encryptFile(data, key);
    const decrypted = await decryptFile(encrypted, key);
    expect(decrypted.byteLength).toBe(0);
  });

  it("handles larger files", async () => {
    const key = await generateEncryptionKey();
    const data = new Uint8Array(1024 * 100); // 100KB
    for (let i = 0; i < data.length; i++) data[i] = i % 256;

    const encrypted = await encryptFile(data.buffer, key);
    const decrypted = await decryptFile(encrypted, key);
    expect(new Uint8Array(decrypted)).toEqual(data);
  });

  it("fails with wrong key", async () => {
    const key1 = await generateEncryptionKey();
    const key2 = await generateEncryptionKey();
    const data = new Uint8Array([1, 2, 3]).buffer;

    const encrypted = await encryptFile(data, key1);
    await expect(decryptFile(encrypted, key2)).rejects.toThrow();
  });

  it("encrypted output includes 12-byte IV prefix", async () => {
    const key = await generateEncryptionKey();
    const data = new Uint8Array([42]).buffer;

    const encrypted = await encryptFile(data, key);
    // AES-GCM: 12 byte IV + ciphertext (1 byte) + 16 byte auth tag = 29 bytes minimum
    expect(encrypted.byteLength).toBeGreaterThanOrEqual(12 + 1 + 16);
  });
});
