import { Context } from "effect";
import type { SearchIndexImpl } from "../types.ts";

/**
 * The SearchIndex Effect Context tag. Wired in at boot by
 * `SearchIndexLayer`; the `search_notes` tool handler resolves it to
 * query, the changes-feed subscription resolves it to mark dirty.
 */
export class SearchIndex extends Context.Tag("SearchIndex")<SearchIndex, SearchIndexImpl>() {}
