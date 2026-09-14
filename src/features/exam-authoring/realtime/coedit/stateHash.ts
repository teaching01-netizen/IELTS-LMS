// SHA-256 hex of a byte array.
//
// Used for the state-vector hash that identifies "the exact state a client may
// call Saved". It is a correlation identity, not a security boundary, so a
// compact synchronous implementation beats pulling a WebCrypto async path into
// the save-state machine (which must observe every edit synchronously).
const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

function rotr(value: number, shift: number): number {
  return (value >>> shift) | (value << (32 - shift));
}

function u32(list: readonly number[], index: number): number {
  return list[index] ?? 0;
}

export function sha256Hex(bytes: Uint8Array): string {
  const length = bytes.length;
  const bitLength = length * 8;
  // message + 0x80 + zero pad + 8-byte big-endian length
  const paddedLength = (((length + 9) >> 6) + 1) << 6;
  const buffer = new Uint8Array(paddedLength);
  buffer.set(bytes);
  buffer[length] = 0x80;
  const view = new DataView(buffer.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  const state: number[] = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const w = new Array<number>(64).fill(0);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = view.getUint32(offset + i * 4);
    }
    for (let i = 16; i < 64; i += 1) {
      const w15 = u32(w, i - 15);
      const w2 = u32(w, i - 2);
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      w[i] = (u32(w, i - 16) + s0 + u32(w, i - 7) + s1) >>> 0;
    }
    let a = u32(state, 0);
    let b = u32(state, 1);
    let c = u32(state, 2);
    let d = u32(state, 3);
    let e = u32(state, 4);
    let f = u32(state, 5);
    let g = u32(state, 6);
    let h = u32(state, 7);
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + u32(K, i) + u32(w, i)) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    state[0] = (u32(state, 0) + a) >>> 0;
    state[1] = (u32(state, 1) + b) >>> 0;
    state[2] = (u32(state, 2) + c) >>> 0;
    state[3] = (u32(state, 3) + d) >>> 0;
    state[4] = (u32(state, 4) + e) >>> 0;
    state[5] = (u32(state, 5) + f) >>> 0;
    state[6] = (u32(state, 6) + g) >>> 0;
    state[7] = (u32(state, 7) + h) >>> 0;
  }

  let hex = "";
  for (const value of state) {
    hex += value.toString(16).padStart(8, "0");
  }
  return hex;
}

/** Convenience alias used by the save-state machine. */
export function createHash(bytes: Uint8Array): string {
  return sha256Hex(bytes);
}
