const encoder = new TextEncoder();

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Returns undefined when the text is not an even number of hex digits. */
export function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | undefined {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) return undefined;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

export async function sha256Hex(text: string): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text))));
}

export async function hmacHex(key: CryptoKey, text: string): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(text))));
}

/** Check a MAC in constant time. A malformed MAC gives false. */
export async function hmacVerify(key: CryptoKey, mac: string, text: string): Promise<boolean> {
  const bytes = hexToBytes(mac);
  return bytes !== undefined && crypto.subtle.verify("HMAC", key, bytes, encoder.encode(text));
}
