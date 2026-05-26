import { Context } from "effect";
import type { VectorStoreImpl } from "../types.ts";

/**
 * The VectorStore Effect Context tag. Wired in at boot by
 * `VectorStoreLayer`; the changes pipeline, backfill, and `/search`
 * endpoint all pull it via `Effect.gen`.
 */
export class VectorStore extends Context.Tag("VectorStore")<VectorStore, VectorStoreImpl>() {}
