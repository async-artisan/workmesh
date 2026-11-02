export async function sha256Bytes(value: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', value as BufferSource);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
