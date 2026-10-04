import type { CollectionRecord, GenerationProvenance, VisionAssessment, VisionEvaluationResult, WorkRecord } from "./index.js";

export interface WorkInformation {
  work: WorkRecord;
  collections: CollectionRecord[];
  assessment: VisionAssessment | null;
  evaluations: VisionEvaluationResult[];
  provenance: GenerationProvenance | null;
}
