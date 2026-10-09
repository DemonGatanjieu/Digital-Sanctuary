import type { WorkQuery, WorkType } from "@sanctuary/domain";
import { elementMatchPredicate } from "./asset-tags.js";

/** SQL WHERE clause on works (`w`, with artists as `ar`) for a validated query. */
export function workQueryPredicate(query: WorkQuery): { sql: string; params: Array<string | number> } {
    const search = typeof query.search === "string" ? query.search.trim().slice(0, 200) : "";
    const clauses = ["w.deleted_at IS NULL"];
    const parameters: Array<string | number> = [];
    if (query.ownership === "managed" || query.ownership === "external") {
      clauses.push("w.ownership = ?");
      parameters.push(query.ownership);
    }
    if (typeof query.favorite === "boolean") {
      clauses.push("w.favorite = ?");
      parameters.push(query.favorite ? 1 : 0);
    }
    if (query.uncollected === true) {
      clauses.push("NOT EXISTS (SELECT 1 FROM collection_works uncollected_cw WHERE uncollected_cw.work_id = w.id)");
    }
    if (query.viewedOnly === true) clauses.push("w.last_viewed_at IS NOT NULL");
    if (query.unattributed === true) clauses.push("w.artist_id IS NULL");
    if (search) {
      clauses.push(
        `(instr(lower(w.title), lower(?)) > 0
          OR instr(lower(COALESCE(ar.name, '')), lower(?)) > 0
          OR instr(lower(COALESCE(w.source_work_id, '')), lower(?)) > 0)`
      );
      parameters.push(search, search, search);
    }
    if (isWorkType(query.workType)) {
      clauses.push("w.work_type = ?");
      parameters.push(query.workType);
    }
    if (typeof query.artistId === "string" && query.artistId) {
      clauses.push("w.artist_id = ?");
      parameters.push(query.artistId);
    }
    const includedCollections = Array.isArray(query.collectionIds)
      ? [...new Set(query.collectionIds.filter((id): id is string => typeof id === "string" && Boolean(id)))]
      : (typeof query.collectionId === "string" && query.collectionId ? [query.collectionId] : []);
    const excludedCollections = Array.isArray(query.excludedCollectionIds)
      ? [...new Set(query.excludedCollectionIds.filter((id): id is string => typeof id === "string" && Boolean(id)))]
      : [];

    if (includedCollections.length === 1 && includedCollections[0]) {
      clauses.push(
        "EXISTS (SELECT 1 FROM collection_works filter_cw WHERE filter_cw.work_id = w.id AND filter_cw.collection_id = ?)"
      );
      parameters.push(includedCollections[0]);
    } else if (includedCollections.length > 1) {
      if (query.collectionMatchMode === "all") {
        for (const colId of includedCollections) {
          clauses.push(
            "EXISTS (SELECT 1 FROM collection_works filter_cw WHERE filter_cw.work_id = w.id AND filter_cw.collection_id = ?)"
          );
          parameters.push(colId);
        }
      } else {
        const placeholders = includedCollections.map(() => "?").join(", ");
        clauses.push(
          `EXISTS (SELECT 1 FROM collection_works filter_cw WHERE filter_cw.work_id = w.id AND filter_cw.collection_id IN (${placeholders}))`
        );
        parameters.push(...includedCollections);
      }
    }

    if (excludedCollections.length > 0) {
      const placeholders = excludedCollections.map(() => "?").join(", ");
      clauses.push(
        `NOT EXISTS (SELECT 1 FROM collection_works filter_ex WHERE filter_ex.work_id = w.id AND filter_ex.collection_id IN (${placeholders}))`
      );
      parameters.push(...excludedCollections);
    }
    if (query.elementMatch) {
      const elements = elementMatchPredicate(query.elementMatch);
      clauses.push(...elements.clauses);
      parameters.push(...elements.params);
    }
    return { sql: clauses.join(" AND "), params: parameters };
}

function isWorkType(value: unknown): value is WorkType {
  return value === "illustration" || value === "manga" || value === "ugoira" ||
    value === "local" || value === "unknown";
}
