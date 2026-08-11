// Utilidades de cripto/codificacion "de bolsillo", 100% locales — nada de
// esto llama a un servidor. Pensado para el mismo publico que ya usa
// PasswordToolsPanel: alguien resolviendo un CTF, decodificando un JWT
// propio, o identificando que tipo de hash tiene enfrente.

export function utf8ToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function bytesToUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // No es UTF-8 valido (comun al des-XORear con la clave incorrecta) —
    // mostramos algo en vez de reventar.
    return Array.from(bytes)
      .map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : "."))
      .join("");
  }
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().replace(/\s+/g, "");
  if (clean.length % 2 !== 0) throw new Error("Longitud de hex impar.");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error("No es hexadecimal valido.");
    out[i] = byte;
  }
  return out;
}

export function encodeBase64(text: string): string {
  const bytes = utf8ToBytes(text);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

export function decodeBase64(b64: string): string {
  const binary = atob(b64.trim());
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytesToUtf8(bytes);
}

export function encodeUrl(text: string): string {
  return encodeURIComponent(text);
}

export function decodeUrl(text: string): string {
  return decodeURIComponent(text);
}

export interface JwtDecoded {
  header: unknown;
  payload: unknown;
  signature: string;
}

/** Decodifica un JWT sin verificar la firma — para inspeccionar claims propios, no para falsificar tokens ajenos. */
export function decodeJwt(token: string): JwtDecoded {
  const parts = token.trim().split(".");
  if (parts.length !== 3) throw new Error("Un JWT tiene 3 partes separadas por puntos.");
  const [headerB64, payloadB64, signature] = parts;
  const pad = (s: string) => s.replace(/-/g, "+").replace(/_/g, "/").padEnd(s.length + ((4 - (s.length % 4)) % 4), "=");
  return {
    header: JSON.parse(decodeBase64(pad(headerB64))),
    payload: JSON.parse(decodeBase64(pad(payloadB64))),
    signature,
  };
}

const ALPHA_UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const ALPHA_LOWER = "abcdefghijklmnopqrstuvwxyz";

export function caesarShift(text: string, shift: number): string {
  const s = ((shift % 26) + 26) % 26;
  return text.replace(/[a-zA-Z]/g, (ch) => {
    const alphabet = ch === ch.toUpperCase() ? ALPHA_UPPER : ALPHA_LOWER;
    const base = alphabet.indexOf(ch);
    return alphabet[(base + s) % 26];
  });
}

/** Prueba los 25 corrimientos posibles — el ataque de fuerza bruta clasico contra Cesar, que es trivial porque el espacio de claves es minusculo. */
export function caesarBruteForce(text: string): { shift: number; result: string }[] {
  return Array.from({ length: 25 }, (_, i) => ({ shift: i + 1, result: caesarShift(text, i + 1) }));
}

export function vigenereTransform(text: string, key: string, decode: boolean): string {
  const cleanKey = key.replace(/[^a-zA-Z]/g, "");
  if (!cleanKey) return text;
  let ki = 0;
  return text.replace(/[a-zA-Z]/g, (ch) => {
    const alphabet = ch === ch.toUpperCase() ? ALPHA_UPPER : ALPHA_LOWER;
    const base = alphabet.indexOf(ch);
    const keyChar = cleanKey[ki % cleanKey.length].toUpperCase();
    const keyShift = ALPHA_UPPER.indexOf(keyChar);
    ki++;
    const shift = decode ? -keyShift : keyShift;
    return alphabet[((base + shift) % 26 + 26) % 26];
  });
}

/** XOR repitiendo la clave byte a byte — la base de muchisimos retos de cripto de CTF. */
export function xorBytes(data: Uint8Array, key: Uint8Array): Uint8Array {
  if (key.length === 0) return data;
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ key[i % key.length];
  return out;
}

const HASH_ALGORITHMS = { "SHA-1": "SHA-1", "SHA-256": "SHA-256", "SHA-384": "SHA-384", "SHA-512": "SHA-512" } as const;
export type HashAlgorithm = keyof typeof HASH_ALGORITHMS | "MD5";

export async function computeHash(text: string, algorithm: HashAlgorithm): Promise<string> {
  if (algorithm === "MD5") return md5Hex(text);
  const digest = await crypto.subtle.digest(HASH_ALGORITHMS[algorithm], utf8ToBytes(text) as BufferSource);
  return bytesToHex(new Uint8Array(digest));
}

/**
 * MD5 puro en JS. El navegador (Web Crypto) no lo expone porque esta roto
 * criptograficamente para usos de seguridad — pero sigue siendo el hash mas
 * comun para identificar archivos/CTFs, asi que vale tenerlo igual.
 */
function md5Hex(input: string): string {
  const rotl = (x: number, c: number) => (x << c) | (x >>> (32 - c));
  const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
  const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];

  const bytes = Array.from(utf8ToBytes(input));
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 0; i < 8; i++) bytes.push((bitLen / 2 ** (8 * i)) & 0xff);

  let [a0, b0, c0, d0] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];

  for (let chunkStart = 0; chunkStart < bytes.length; chunkStart += 64) {
    const M = new Array(16);
    for (let i = 0; i < 16; i++) {
      M[i] = bytes[chunkStart + i * 4] | (bytes[chunkStart + i * 4 + 1] << 8) | (bytes[chunkStart + i * 4 + 2] << 16) | (bytes[chunkStart + i * 4 + 3] << 24);
    }
    let [A, B, C, D] = [a0, b0, c0, d0];
    for (let i = 0; i < 64; i++) {
      let F: number, g: number;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      F = (F + A + K[i] + M[g]) >>> 0;
      A = D;
      D = C;
      C = B;
      B = (B + rotl(F, S[i])) >>> 0;
    }
    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  const toLE = (n: number) =>
    [0, 8, 16, 24].map((s) => ((n >>> s) & 0xff).toString(16).padStart(2, "0")).join("");
  return toLE(a0) + toLE(b0) + toLE(c0) + toLE(d0);
}

export interface FormatGuess {
  label: string;
  confidence: "alta" | "media" | "baja";
  note: string;
}

/** Heuristicas rapidas tipo "cipher identifier" — no son magia, son los mismos chequeos que harias a ojo. */
export function identifyFormat(raw: string): FormatGuess[] {
  const input = raw.trim();
  const guesses: FormatGuess[] = [];
  if (!input) return guesses;

  if (/^[0-9a-fA-F]{32}$/.test(input)) guesses.push({ label: "Hash MD5", confidence: "alta", note: "32 caracteres hexadecimales." });
  if (/^[0-9a-fA-F]{40}$/.test(input)) guesses.push({ label: "Hash SHA-1", confidence: "alta", note: "40 caracteres hexadecimales." });
  if (/^[0-9a-fA-F]{64}$/.test(input)) guesses.push({ label: "Hash SHA-256", confidence: "alta", note: "64 caracteres hexadecimales." });
  if (/^[0-9a-fA-F]{128}$/.test(input)) guesses.push({ label: "Hash SHA-512", confidence: "alta", note: "128 caracteres hexadecimales." });
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(input) && input.length % 4 === 0 && input.length >= 8) {
    guesses.push({ label: "Base64", confidence: "media", note: "Alfabeto y longitud compatibles con Base64." });
  }
  if (/^[0-9a-fA-F\s]+$/.test(input) && input.replace(/\s/g, "").length % 2 === 0 && input.trim().length >= 4) {
    guesses.push({ label: "Hexadecimal", confidence: "media", note: "Solo caracteres 0-9/a-f, longitud par." });
  }
  if (/^[01\s]+$/.test(input) && input.replace(/\s/g, "").length % 8 === 0 && input.trim().length >= 8) {
    guesses.push({ label: "Binario", confidence: "media", note: "Solo 0 y 1, multiplo de 8 bits." });
  }
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(input)) {
    guesses.push({ label: "JWT", confidence: "alta", note: "Tres segmentos separados por puntos." });
  }
  if (/%[0-9a-fA-F]{2}/.test(input)) guesses.push({ label: "URL-encoded", confidence: "media", note: "Contiene secuencias %XX." });
  if (/^\$2[aby]\$\d{2}\$/.test(input)) guesses.push({ label: "Hash bcrypt", confidence: "alta", note: "Prefijo $2a$/$2b$/$2y$ tipico de bcrypt." });
  if (/^\$argon2/.test(input)) guesses.push({ label: "Hash Argon2", confidence: "alta", note: "Prefijo $argon2." });

  if (guesses.length === 0) guesses.push({ label: "Texto plano", confidence: "baja", note: "No coincide con ningun patron conocido." });
  return guesses;
}
