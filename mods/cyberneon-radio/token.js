// Receiver session token: exactly 32 lowercase hex characters (receiver.py checks).
// Herdr's `crypto` shim can return "" from randomBytes(n).toString("hex"), so each
// source is validated and the next is tried.
const VALID = /^[a-f0-9]{32}$/;

export function receiverToken(crypto) {
  const sources = [
    () => crypto.randomUUID().replaceAll("-", ""),
    () => crypto.randomBytes(16).toString("hex"),
    () => Array.from(crypto.webcrypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join(""),
    () => Array.from({ length: 16 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, "0")).join(""),
  ];
  for (const source of sources) {
    try {
      const token = String(source()).toLowerCase();
      if (VALID.test(token)) return token;
    } catch { /* try the next source */ }
  }
  throw new Error("RECEIVER // cannot generate session token");
}
