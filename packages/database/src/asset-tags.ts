import type { DatabaseSync } from "node:sqlite";
import type { ResolvedElementMatch, TagThreshold, VisionAssessment } from "@sanctuary/domain";

/** Labels below this confidence are not indexed; lower rule thresholds are clamped up to it. */
export const TAG_INDEX_MIN_CONFIDENCE = 0.2;

/**
 * Element tags per page, derived from stored tagger results so the gallery can filter in SQL.
 * Rows carry the asset version they were computed for; a changed file simply stops matching.
 */
export class AssetTagIndex {
  constructor(private readonly database: DatabaseSync) {}

  ensureSchema(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS asset_tags (
        engine TEXT NOT NULL,
        tag TEXT NOT NULL,
        asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        asset_version TEXT NOT NULL,
        confidence REAL NOT NULL,
        PRIMARY KEY (asset_id, engine, tag)
      ) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS asset_tag_coverage (
        asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        engine TEXT NOT NULL,
        asset_version TEXT NOT NULL,
        PRIMARY KEY (asset_id, engine)
      ) WITHOUT ROWID;
    `);
    const applied = this.database.prepare("SELECT 1 FROM schema_migrations WHERE version = 8").get();
    if (applied) return;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      // Backfill from results stored before the index existed: analysis jobs first, then legacy per-artwork results.
      const rows = this.database.prepare(
        `SELECT a.id AS asset_id, a.updated_at AS version, r.assessment_json AS json
           FROM analysis_asset_results r JOIN assets a ON a.id = r.asset_id AND a.updated_at = r.asset_updated_at
         UNION ALL
         SELECT a.id, a.updated_at, legacy.assessment_json
           FROM assets a JOIN artworks legacy ON legacy.id = a.legacy_artwork_id
          WHERE legacy.assessment_json IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM analysis_asset_results r WHERE r.asset_id = a.id AND r.asset_updated_at = a.updated_at)`
      ).all() as { asset_id: string; version: string; json: string }[];
      for (const row of rows) {
        const assessment = parseAssessment(row.json);
        if (assessment) this.#write(row.asset_id, row.version, assessment);
      }
      this.database.prepare("INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (8, ?)").run(new Date().toISOString());
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  /** Records one page's tags; call inside the transaction that stores the tagger result. */
  record(assetId: string, assetVersion: string, assessment: VisionAssessment): void {
    if (assessment.status !== "complete") return;
    this.#write(assetId, assetVersion, assessment);
  }

  forget(assetId: string): void {
    this.database.prepare("DELETE FROM asset_tags WHERE asset_id = ?").run(assetId);
    this.database.prepare("DELETE FROM asset_tag_coverage WHERE asset_id = ?").run(assetId);
  }

  /** Pages in the library, and how many the engine has tagged at their current version. */
  coverage(engine: string): { totalAssets: number; taggedAssets: number } {
    const row = this.database.prepare(
      `SELECT COUNT(*) AS total,
              SUM(EXISTS (SELECT 1 FROM asset_tag_coverage c WHERE c.asset_id = a.id AND c.engine = ? AND c.asset_version = a.updated_at)) AS tagged
         FROM assets a JOIN works w ON w.id = a.work_id WHERE w.deleted_at IS NULL`
    ).get(engine) as { total: number; tagged: number | null };
    return { totalAssets: Number(row.total), taggedAssets: Number(row.tagged ?? 0) };
  }

  #write(assetId: string, assetVersion: string, assessment: VisionAssessment): void {
    this.database.prepare("DELETE FROM asset_tags WHERE asset_id = ? AND engine = ?").run(assetId, assessment.engine);
    const insert = this.database.prepare("INSERT INTO asset_tags (engine, tag, asset_id, asset_version, confidence) VALUES (?, ?, ?, ?, ?)");
    for (const [tag, confidence] of Object.entries(assessment.labels)) {
      if (typeof confidence === "number" && confidence >= TAG_INDEX_MIN_CONFIDENCE && tag.length <= 120) {
        insert.run(assessment.engine, tag, assetId, assetVersion, confidence);
      }
    }
    this.database.prepare(
      `INSERT INTO asset_tag_coverage (asset_id, engine, asset_version) VALUES (?, ?, ?)
       ON CONFLICT(asset_id, engine) DO UPDATE SET asset_version = excluded.asset_version`
    ).run(assetId, assessment.engine, assetVersion);
  }
}

/** SQL conditions on the work alias `w` for resolved element conditions. */
export function elementMatchPredicate(match: ResolvedElementMatch): { clauses: string[]; params: Array<string | number> } {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  const pageHas = (thresholds: TagThreshold[]) => {
    const ors = thresholds.map(() => "(t.tag = ? AND t.confidence >= ?)").join(" OR ");
    for (const { tag, minimum } of thresholds) params.push(tag, Math.max(minimum, TAG_INDEX_MIN_CONFIDENCE));
    // CROSS JOIN pins the order work -> its pages -> each page's tags, so every step is an index seek
    // no matter how common the tag is.
    return `EXISTS (SELECT 1 FROM assets ta CROSS JOIN asset_tags t ON t.asset_id = ta.id AND t.asset_version = ta.updated_at
      WHERE ta.work_id = w.id AND t.engine = ? AND (${ors}))`;
  };
  for (const threshold of match.include) {
    params.push(match.engine);
    clauses.push(pageHas([threshold]));
  }
  if (match.anyOf.length) {
    params.push(match.engine);
    clauses.push(pageHas(match.anyOf));
  }
  if (match.exclude.length) {
    // Unknown is not "absent": every page must be tagged at its current version.
    clauses.push(`NOT EXISTS (SELECT 1 FROM assets ca WHERE ca.work_id = w.id AND NOT EXISTS (
      SELECT 1 FROM asset_tag_coverage c WHERE c.asset_id = ca.id AND c.engine = ? AND c.asset_version = ca.updated_at))`);
    params.push(match.engine);
    params.push(match.engine);
    clauses.push(`NOT ${pageHas(match.exclude)}`);
  }
  return { clauses, params };
}

function parseAssessment(json: string): VisionAssessment | null {
  try {
    const value = JSON.parse(json) as Partial<VisionAssessment>;
    return value && value.status === "complete" && typeof value.engine === "string" && value.labels && typeof value.labels === "object"
      ? value as VisionAssessment
      : null;
  } catch {
    return null;
  }
}
