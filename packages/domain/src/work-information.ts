import type { CollectionRecord, GenerationProvenance, VisionAssessment, VisionEvaluationResult, WorkRecord } from "./index.js";

export interface WorkInformation {
  webSource?: { pageUrl: string; imageUrl: string; title: string; savedAt: string } | null;
  work: WorkRecord;
  collections: CollectionRecord[];
  assessment: VisionAssessment | null;
  evaluations: VisionEvaluationResult[];
  provenance: GenerationProvenance | null;
}
