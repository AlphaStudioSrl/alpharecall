export type PowChallenge = {
  id: string;
  seed: string;
  difficulty: number;
  algorithm: "sha256";
  expires_in: number;
};

const ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
const SEED_RE = /^[a-f0-9]{32}$/;
const NONCE_RE = /^[0-9]+$/;
const SHA256_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function utf8Bytes(input: string): number[] {
  const bytes: number[] = [];
  for (const char of input) {
    const code = char.codePointAt(0) as number;
    if (code <= 0x7f) {
      bytes.push(code);
    } else if (code <= 0x7ff) {
      bytes.push(0xc0 | (code >>> 6), 0x80 | (code & 0x3f));
    } else if (code <= 0xffff) {
      bytes.push(0xe0 | (code >>> 12), 0x80 | ((code >>> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >>> 18),
        0x80 | ((code >>> 12) & 0x3f),
        0x80 | ((code >>> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
    }
  }
  return bytes;
}

export function sha256Hex(input: string): string {
  const bytes = utf8Bytes(input);
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  for (let shift = 24; shift >= 0; shift -= 8) bytes.push((high >>> shift) & 0xff);
  for (let shift = 24; shift >= 0; shift -= 8) bytes.push((low >>> shift) & 0xff);

  const hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const words = new Array<number>(64);

  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      const index = offset + i * 4;
      words[i] = (
        (bytes[index] << 24)
        | (bytes[index + 1] << 16)
        | (bytes[index + 2] << 8)
        | bytes[index + 3]
      ) >>> 0;
    }
    for (let i = 16; i < 64; i += 1) {
      const x = words[i - 15];
      const y = words[i - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      words[i] = (words[i - 16] + s0 + words[i - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let i = 0; i < 64; i += 1) {
      const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + choice + SHA256_CONSTANTS[i] + words[i]) >>> 0;
      const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }

  return hash.map((word) => word.toString(16).padStart(8, "0")).join("");
}

export function leadingZeroBits(hex: string): number {
  let count = 0;
  for (const char of hex.toLowerCase()) {
    const value = Number.parseInt(char, 16);
    if (!Number.isFinite(value)) return count;
    if (value === 0) {
      count += 4;
      continue;
    }
    if (value < 2) count += 3;
    else if (value < 4) count += 2;
    else if (value < 8) count += 1;
    break;
  }
  return count;
}

export function isValidSolution(seed: string, nonce: string, difficulty: number): boolean {
  return SEED_RE.test(seed)
    && NONCE_RE.test(nonce)
    && Number.isInteger(difficulty)
    && difficulty >= 1
    && difficulty <= 32
    && leadingZeroBits(sha256Hex(`${seed}.${nonce}`)) >= difficulty;
}

export function parsePowChallenge(value: unknown): PowChallenge | null {
  if (!value || typeof value !== "object") return null;
  const root = value as Record<string, unknown>;
  const detail = root.detail && typeof root.detail === "object"
    ? root.detail as Record<string, unknown>
    : null;
  const candidate = (root.challenge && typeof root.challenge === "object" ? root.challenge : null)
    || (detail?.challenge && typeof detail.challenge === "object" ? detail.challenge : null)
    || root;
  const raw = candidate as Record<string, unknown>;
  if (typeof raw.id !== "string" || !ID_RE.test(raw.id)) return null;
  if (typeof raw.seed !== "string" || !SEED_RE.test(raw.seed)) return null;
  if (!Number.isInteger(raw.difficulty) || (raw.difficulty as number) < 1 || (raw.difficulty as number) > 32) {
    return null;
  }
  if (raw.algorithm !== undefined && raw.algorithm !== "sha256") return null;
  const expiresIn = raw.expires_in === undefined ? 120 : raw.expires_in;
  if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0) return null;
  return {
    id: raw.id,
    seed: raw.seed,
    difficulty: raw.difficulty as number,
    algorithm: "sha256",
    expires_in: expiresIn,
  };
}

export function powHeader(challenge: PowChallenge, nonce: string): string {
  return `${challenge.id}.${nonce}`;
}

function abortError(): Error {
  if (typeof DOMException !== "undefined") return new DOMException("Aborted", "AbortError");
  const error = new Error("Aborted");
  error.name = "AbortError";
  return error;
}

function randomUint32(): number {
  const cryptoApi = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (cryptoApi && typeof cryptoApi.getRandomValues === "function") {
    return cryptoApi.getRandomValues(new Uint32Array(1))[0];
  }
  return Math.floor(Math.random() * 0x100000000);
}

const WORKER_SOURCE = `
const K = [
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
];
function utf8(input) {
  const bytes = [];
  for (const char of input) {
    const code = char.codePointAt(0);
    if (code <= 0x7f) bytes.push(code);
    else if (code <= 0x7ff) bytes.push(0xc0 | (code >>> 6), 0x80 | (code & 0x3f));
    else if (code <= 0xffff) bytes.push(0xe0 | (code >>> 12), 0x80 | ((code >>> 6) & 0x3f), 0x80 | (code & 0x3f));
    else bytes.push(0xf0 | (code >>> 18), 0x80 | ((code >>> 12) & 0x3f), 0x80 | ((code >>> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return bytes;
}
function sha256(input) {
  const bytes = utf8(input);
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  for (let shift = 24; shift >= 0; shift -= 8) bytes.push((high >>> shift) & 0xff);
  for (let shift = 24; shift >= 0; shift -= 8) bytes.push((low >>> shift) & 0xff);
  const hash = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const words = new Array(64);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      const index = offset + i * 4;
      words[i] = ((bytes[index] << 24) | (bytes[index + 1] << 16) | (bytes[index + 2] << 8) | bytes[index + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i += 1) {
      const x = words[i - 15];
      const y = words[i - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      words[i] = (words[i - 16] + s0 + words[i - 7] + s1) >>> 0;
    }
    let [a,b,c,d,e,f,g,h] = hash;
    for (let i = 0; i < 64; i += 1) {
      const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + choice + K[i] + words[i]) >>> 0;
      const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    hash[0] = (hash[0] + a) >>> 0; hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0; hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0; hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0; hash[7] = (hash[7] + h) >>> 0;
  }
  return hash.map((word) => word.toString(16).padStart(8, "0")).join("");
}
function zeroBits(hex) {
  let count = 0;
  for (const char of hex) {
    const value = parseInt(char, 16);
    if (value === 0) { count += 4; continue; }
    if (value < 2) count += 3;
    else if (value < 4) count += 2;
    else if (value < 8) count += 1;
    break;
  }
  return count;
}
self.onmessage = function (event) {
  const seed = event.data.seed;
  const difficulty = event.data.difficulty;
  let nonce = event.data.start;
  while (zeroBits(sha256(seed + "." + nonce)) < difficulty) nonce += 1;
  self.postMessage({ nonce: String(nonce) });
};`;

function solveInWorker(challenge: PowChallenge, start: number, signal: AbortSignal | undefined): Promise<string> {
  if (typeof Worker === "undefined" || typeof Blob === "undefined"
    || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    return Promise.reject(new Error("worker_unavailable"));
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
    const worker = new Worker(url);
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      worker.terminate();
      URL.revokeObjectURL(url);
      callback();
    };
    const onAbort = () => finish(() => reject(abortError()));
    const timer = window.setTimeout(
      () => finish(() => reject(new Error("pow_expired"))),
      challenge.expires_in * 1000
    );
    worker.onmessage = (event: MessageEvent<{ nonce?: unknown }>) => {
      const nonce = event.data?.nonce;
      if (typeof nonce !== "string" || !isValidSolution(challenge.seed, nonce, challenge.difficulty)) {
        finish(() => reject(new Error("worker_invalid_solution")));
        return;
      }
      finish(() => resolve(nonce));
    };
    worker.onerror = () => finish(() => reject(new Error("worker_error")));
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    worker.postMessage({ seed: challenge.seed, difficulty: challenge.difficulty, start });
  });
}

async function solveOnMainThread(
  challenge: PowChallenge,
  start: number,
  signal: AbortSignal | undefined,
  startedAt: number
): Promise<string> {
  let nonce = start;
  const expiresAt = startedAt + challenge.expires_in * 1000;
  while (Date.now() < expiresAt) {
    const sliceStartedAt = Date.now();
    while (Date.now() - sliceStartedAt < 20) {
      if (signal?.aborted) throw abortError();
      const value = String(nonce);
      if (isValidSolution(challenge.seed, value, challenge.difficulty)) return value;
      nonce += 1;
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  }
  throw new Error("pow_expired");
}

const inFlight = new Map<string, Promise<string>>();

export function solveProofOfWork(challenge: PowChallenge, opts: { signal?: AbortSignal } = {}): Promise<string> {
  const existing = inFlight.get(challenge.id);
  if (existing) return existing;
  const startedAt = Date.now();
  const start = randomUint32();
  const promise = solveInWorker(challenge, start, opts.signal).catch((error) => {
    if (opts.signal?.aborted) throw abortError();
    if (error?.name === "AbortError" || error?.message === "pow_expired") throw error;
    return solveOnMainThread(challenge, start, opts.signal, startedAt);
  });
  inFlight.set(challenge.id, promise);
  void promise.finally(() => {
    if (inFlight.get(challenge.id) === promise) inFlight.delete(challenge.id);
  }).catch(() => undefined);
  return promise;
}
