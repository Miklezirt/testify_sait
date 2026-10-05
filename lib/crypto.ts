import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
function key() {
  const hex = process.env.DOCUMENT_KEY ?? "";
  if (!/^[a-f0-9]{64}$/i.test(hex))
    throw new Error("DOCUMENT_KEY должен содержать 64 hex символа");
  return Buffer.from(hex, "hex");
}
export function encrypt(data: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  return {
    ciphertext: Buffer.concat([cipher.update(data), cipher.final()]),
    iv,
    tag: cipher.getAuthTag(),
  };
}
export function decrypt(doc: {
  ciphertext: Uint8Array;
  iv: Uint8Array;
  tag: Uint8Array;
}) {
  const cipher = createDecipheriv("aes-256-gcm", key(), doc.iv);
  cipher.setAuthTag(doc.tag);
  return Buffer.concat([cipher.update(doc.ciphertext), cipher.final()]);
}
export function fileType(data: Buffer): string | null {
  if (data.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff)
    return "image/jpeg";
  if (
    data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  return null;
}
