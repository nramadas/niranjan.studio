import type { EmbeddingVector } from "../types.ts";

/**
 * Return a unit-length copy of the input vector. Caller-side helper so
 * each `Embedder` implementation can guarantee its outputs satisfy the
 * "L2-normalised on the wire" contract documented on the interface.
 *
 * If the input is the zero vector (or sums to a magnitude below the
 * floating-point epsilon), returns it unchanged — there is no meaningful
 * direction to project. A zero-vector embedding is itself a model bug,
 * so we don't try to paper over it here; downstream KNN will simply
 * rank it consistently last under any non-zero query.
 *
 * @param v Raw model output (`number[]` or a typed-array slice — the
 *          input is treated as a read-only iterable).
 * @returns A new array with unit L2 length.
 */
export const l2Normalise = (v: ReadonlyArray<number>): EmbeddingVector => {
  let sumSquares = 0;
  for (let i = 0; i < v.length; i++) {
    const x = v[i] ?? 0;
    sumSquares += x * x;
  }
  const norm = Math.sqrt(sumSquares);
  if (norm < 1e-12) return [...v];
  const out = new Array<number>(v.length);
  for (let i = 0; i < v.length; i++) {
    out[i] = (v[i] ?? 0) / norm;
  }
  return out;
};
