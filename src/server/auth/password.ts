import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "crypto";

const HASH_ALGORITHM = "scrypt";
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;

function deriveKey(password: string, salt: string) {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      KEY_LENGTH,
      {
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(derivedKey as Buffer);
      }
    );
  });
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = await deriveKey(password, salt);

  return [
    HASH_ALGORITHM,
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt,
    derivedKey.toString("hex"),
  ].join(":");
}

export async function verifyPassword(password: string, hash: string) {
  const [algorithm, n, r, p, salt, storedKey] = hash.split(":");

  if (
    algorithm !== HASH_ALGORITHM ||
    !n ||
    !r ||
    !p ||
    !salt ||
    !storedKey
  ) {
    return false;
  }

  const derivedKey = await new Promise<Buffer>((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      KEY_LENGTH,
      {
        N: Number(n),
        r: Number(r),
        p: Number(p),
      },
      (error, nextKey) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(nextKey as Buffer);
      }
    );
  });

  return timingSafeEqual(derivedKey, Buffer.from(storedKey, "hex"));
}
