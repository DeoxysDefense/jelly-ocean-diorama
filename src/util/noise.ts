/**
 * Improved Perlin noise (Ken Perlin 2002 reference algorithm) with a seeded permutation.
 */
const p = new Uint8Array(512);
(function init(seed = 1337) {
  const perm = new Uint8Array(256);
  for (let i = 0; i < 256; i++) perm[i] = i;
  let s = seed;
  for (let i = 255; i > 0; i--) {
    s = (s * 16807) % 2147483647;
    const j = s % (i + 1);
    const t = perm[i];
    perm[i] = perm[j];
    perm[j] = t;
  }
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
})();

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (t: number, a: number, b: number) => a + t * (b - a);
function grad(hash: number, x: number, y: number, z: number) {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

export function perlin3(x: number, y: number, z: number): number {
  const X = Math.floor(x) & 255,
    Y = Math.floor(y) & 255,
    Z = Math.floor(z) & 255;
  x -= Math.floor(x);
  y -= Math.floor(y);
  z -= Math.floor(z);
  const u = fade(x),
    v = fade(y),
    w = fade(z);
  const A = p[X] + Y,
    AA = p[A] + Z,
    AB = p[A + 1] + Z,
    B = p[X + 1] + Y,
    BA = p[B] + Z,
    BB = p[B + 1] + Z;
  return lerp(
    w,
    lerp(
      v,
      lerp(u, grad(p[AA], x, y, z), grad(p[BA], x - 1, y, z)),
      lerp(u, grad(p[AB], x, y - 1, z), grad(p[BB], x - 1, y - 1, z)),
    ),
    lerp(
      v,
      lerp(u, grad(p[AA + 1], x, y, z - 1), grad(p[BA + 1], x - 1, y, z - 1)),
      lerp(u, grad(p[AB + 1], x, y - 1, z - 1), grad(p[BB + 1], x - 1, y - 1, z - 1)),
    ),
  );
}

export const perlin2 = (x: number, y: number) => perlin3(x, y, 0.5);

export function fbm2(x: number, y: number, octaves = 4, lacunarity = 2, gain = 0.5) {
  let sum = 0,
    amp = 0.5,
    f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * perlin2(x * f, y * f);
    f *= lacunarity;
    amp *= gain;
  }
  return sum;
}

export function fbm3(x: number, y: number, z: number, octaves = 4) {
  let sum = 0,
    amp = 0.5,
    f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * perlin3(x * f, y * f, z * f);
    f *= 2;
    amp *= 0.5;
  }
  return sum;
}
