import { contextBridge, ipcRenderer } from "electron";
import type {
  AppearancePreferences,
  AnalysisApplyResult,
  AnalysisJob,
  AnalysisTaskSummary,
  AnalysisScope,
  AnalysisScopePreview,
  ArtistRecord,
  ArtworkRecord,
  ArtworkPageQuery,
  ArtworkPageQueryResult,
  ArtistSummary,
  CollectionSummary,
  DirectoryPageQuery,
  GalleryScope,
  SavedViewSummaryResult,
  ScopedArtworkRecord,
  CollectionRecord,
  CustomElementGroup,
  ElementFilterSetting,
  LibraryPreferences,
  LocalImportBatch,
  LocalImportOptions,
  RuleSandboxResult,
  SavedCollectionView,
  SavedCollectionViewDraft,
  SavedWorkFilter,
  SavedWorkFilterDraft,
  StorageLocationInfo,
  StorageMigrationResult,
  ActiveTheme,
  InstalledTheme,
  StoreCatalogResponse,
  ThemeChangedEvent,
  ThemeDownloadProgress,
  WorkQuery,
  WorkQueryResult,
  WorkRecord,
  WorkInformation,
  GallerySearchSnapshot, ImageTarget, ImageExportBatch, WorkbenchSnapshot, WorkbenchSource, WorkbenchQuery, SemanticAvailability, ImageTaskSummary,
  WorkReadingProgress,
  WorkDeletionPreview,
  WorkDeletionResult,
  ExternalVisionPublicConfig,
  VisionEvaluationResult,
  VisionEvaluationRequest,
  TypographyFontDescriptor,
  TypographyPreferencesV1,
  TriageQueryResultItem,
  ExploreTriageResult,
  VisionAssessment,
  InspectArtworkPage,
  InspectArtworkResponse,
  PromptWorkspacePreferences,
  ComfyUiConfig,
  ComfyUiJob,
  ComfyUiSendRequest,
  ComfyWorkflowTemplateSummary,
  GenerationProvenance,
  ModelActivationResult,
  ModelCenterSnapshot,
  ModelDownloadProgress,
  InspirationConversation,
  InspirationSendRequest,
  InspirationRegenerateRequest,
  InspirationSourceUpdateRequest,
  InspirationExportRequest,
  InspirationExportResult
} from "@sanctuary/domain";
import type {
  ArtistAvatarRepairResult,
  BookmarkDownloadPreview,
  ExploreDownloadResult,
  ExploreDownloadState,
  PixivPageKind
} from "../shared/pixiv-download.js";
import type { ThumbnailBatchResult } from "../main/thumbnail-service.js";

export interface StorageDirectoryChoiceResult {
  preferences: LibraryPreferences;
  location: StorageLocationInfo;
  migrationResult?: StorageMigrationResult;
}

export interface ExploreBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ExploreState {
  browserMode?: "pixiv" | "web";
  notice?: string;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  blockedResources: number;
  blockedAds: number;
  approvedResources: number;
  pendingResources: number;
  queuedResources: number;
  remoteReviewCacheHits: number;
  remoteReviewCacheMisses: number;
  error: string;
  protectionStatus: "starting" | "ready" | "failed" | "stopped" | "bypassed";
  protectionError: string;
  maximized: boolean;
  pageKind: PixivPageKind;
  artworkId: string;
  bookmarkUserId: string;
  download: ExploreDownloadState;
}

export type ExploreCommand =
  | "home"
  | "login"
  | "open-password-setup"
  | "back"
  | "forward"
  | "reload"
  | "maximize"
  | "retry-vision"
  | "browse-unprotected"
  | "resume-protection";

export interface ApplicationStatus {
  visionEngine: string;
  visionProvider: string;
  visionReady: boolean;
  visionState: "starting" | "ready" | "failed" | "stopped";
  visionError: string;
  modelBacked: boolean;
}

export interface PersonalTagPreferenceView {
  label: string;
  weight: number;
  evidenceCount: number;
  enabled: boolean;
  explicit: boolean;
  updatedAt: string;
}

export interface PersonalPreferenceProfileView {
  engine: string;
  engineVersion: string;
  available: boolean;
  entries: PersonalTagPreferenceView[];
}

export interface SanctuaryApi {
  listArtworks(): Promise<ArtworkRecord[]>;
  listCollectionSummaries(): Promise<CollectionSummary[]>;
  listArtistSummaries(): Promise<ArtistSummary[]>;
  querySavedViewSummaries(query?: DirectoryPageQuery): Promise<SavedViewSummaryResult>;
  listScopedArtworks(scope: GalleryScope): Promise<ScopedArtworkRecord[]>;
  queryArtworkPages(query?: ArtworkPageQuery): Promise<ArtworkPageQueryResult>;
  addArtworksToCollection(artworkIds: string[], collectionId: string): Promise<number>;
  queryWorks(query?: WorkQuery): Promise<WorkQueryResult>;
  getWork(workId: string): Promise<WorkRecord | null>;
  getWorkInformation(workId: string, pageIndex: number): Promise<WorkInformation | null>;
  renameWork(workId: string, name: string): Promise<WorkRecord>;
  relinkExternalImage(workId: string, assetId: string): Promise<WorkRecord | null>;
  prepareInspirationTargets(targets: ImageTarget[]): Promise<Array<{workId:string;pageIndex:number}>>;
  importInspirationSources(batchId: string): Promise<Array<{workId:string;pageIndex:number}>>;
  exportImages(targets: ImageTarget[]): Promise<ImageExportBatch | null>;
  getImageExport(id: string): Promise<ImageExportBatch>;
  currentImageExport(): Promise<ImageExportBatch | null>;
  cancelImageExport(id: string): Promise<ImageExportBatch>;
  retryImageExport(id: string): Promise<ImageExportBatch>;
  useImage(target: ImageTarget, action: "copy" | "reveal"): Promise<void>;
  dragImage(target: ImageTarget): Promise<void>;
  getGalleryBanner(): Promise<string | null>;
  chooseGalleryBanner(): Promise<string | null>;
  resetGalleryBanner(): Promise<null>;
  searchGalleryPictures(text: string, query: WorkQuery): Promise<GallerySearchSnapshot>;
  galleryPictureResults(id: string, offset?: number): Promise<GallerySearchSnapshot>;
  currentGalleryPictureSearch(): Promise<GallerySearchSnapshot | null>;
  chooseWorkbenchFolder(recursive: boolean): Promise<WorkbenchSnapshot | null>;
  chooseWorkbenchLibrary(scope: AnalysisScope): Promise<WorkbenchSnapshot>;
  currentWorkbench(source: WorkbenchSource): Promise<WorkbenchSnapshot | null>;
  getWorkbench(id: string, offset?: number, filter?: "matches" | "all" | "failed"): Promise<WorkbenchSnapshot>;
  startWorkbench(id: string, query: WorkbenchQuery): Promise<WorkbenchSnapshot>;
  cancelWorkbench(id: string): Promise<WorkbenchSnapshot>;
  prepareWorkbenchImport(id: string, itemIds: string[]): Promise<LocalImportBatch | null>;
  assignWorkbenchImages(id: string, itemIds: string[], collectionId: string): Promise<number>;
  semanticAvailability(): Promise<SemanticAvailability>;
  listImageTaskSummaries(): Promise<ImageTaskSummary[]>;
  recordWorkView(workId: string, assetId: string): Promise<WorkReadingProgress | null>;
  getGenerationProvenance(workId: string): Promise<GenerationProvenance | null>;
  listInspirationConversations(): Promise<InspirationConversation[]>;
  sendInspirationMessage(request: InspirationSendRequest): Promise<InspirationConversation>;
  regenerateInspirationMessage(request: InspirationRegenerateRequest): Promise<InspirationConversation>;
  updateInspirationSource(request: InspirationSourceUpdateRequest): Promise<InspirationConversation>;
  cancelInspirationMessage(requestId: string): Promise<boolean>;
  deleteInspirationConversation(conversationId: string): Promise<boolean>;
  exportInspirationMarkdown(request: InspirationExportRequest): Promise<InspirationExportResult>;
  copyInspirationMarkdown(request: InspirationExportRequest): Promise<void>;
  copyInspirationMessage(request: { conversationId: string; messageId: string }): Promise<void>;
  generateThumbnails(): Promise<ThumbnailBatchResult>;
  createLibraryBackup(): Promise<string | null>;
  previewWorkDeletion(workIds: string[]): Promise<WorkDeletionPreview>;
  confirmWorkDeletion(token: string): Promise<WorkDeletionResult>;
  importImages(): Promise<LocalImportBatch | null>;
  getImportBatch(id: string): Promise<LocalImportBatch>;
  startImportBatch(id: string, options: LocalImportOptions): Promise<LocalImportBatch>;
  cancelImportBatch(id: string): Promise<LocalImportBatch>;
  retryImportBatch(id: string): Promise<LocalImportBatch>;
  listCollections(): Promise<CollectionRecord[]>;
  createCollection(draft: { name: string; description: string }): Promise<CollectionRecord[]>;
  updateCollection(collectionId: string, draft: { name: string; description: string }): Promise<CollectionRecord[]>;
  deleteCollection(collectionId: string): Promise<CollectionRecord[]>;
  updateCollectionCover(collectionId: string, artworkId: string | null): Promise<CollectionRecord[]>;
  listSavedCollectionViews(): Promise<SavedCollectionView[]>;
  createSavedCollectionView(draft: SavedCollectionViewDraft): Promise<SavedCollectionView>;
  updateSavedCollectionView(id: string, draft: SavedCollectionViewDraft): Promise<SavedCollectionView | null>;
  deleteSavedCollectionView(id: string): Promise<boolean>;
  listSavedWorkFilters(): Promise<SavedWorkFilter[]>;
  createSavedWorkFilter(draft: SavedWorkFilterDraft): Promise<SavedWorkFilter>;
  deleteSavedWorkFilter(id: string): Promise<boolean>;
  addArtworkToCollection(artworkId: string, collectionId: string): Promise<ArtworkRecord[]>;
  addWorkToCollection(workId: string, collectionId: string): Promise<WorkRecord | null>;
  removeWorkFromCollection(workId: string, collectionId: string): Promise<WorkRecord | null>;
  updateWorkFavorite(workIds: string[], favorite: boolean): Promise<boolean>;
  getAppearancePreferences(): Promise<AppearancePreferences>;
  updateAppearancePreferences(preferences: AppearancePreferences): Promise<AppearancePreferences>;
  listArtists(): Promise<ArtistRecord[]>;
  repairArtistAvatars(): Promise<ArtistAvatarRepairResult>;
  listFilterSettings(): Promise<ElementFilterSetting[]>;
  updateFilterSetting(setting: ElementFilterSetting): Promise<ElementFilterSetting[]>;
  listCustomElementGroups(): Promise<CustomElementGroup[]>;
  updateCustomElementGroups(groups: CustomElementGroup[]): Promise<CustomElementGroup[]>;
  listPersonalTagPreferences(): Promise<PersonalPreferenceProfileView>;
  togglePersonalTagPreference(label: string, enabled: boolean): Promise<PersonalPreferenceProfileView>;
  resetPersonalTagPreferences(): Promise<PersonalPreferenceProfileView>;
  getLibraryPreferences(): Promise<LibraryPreferences>;
  updateLibraryPreferences(preferences: LibraryPreferences): Promise<LibraryPreferences>;
  getStorageLocation(): Promise<StorageLocationInfo>;
  chooseDownloadDirectory(): Promise<StorageDirectoryChoiceResult>;
  openStorageDirectory(): Promise<boolean>;
  migrateStorage(): Promise<StorageMigrationResult>;
  getInstalledThemes(): Promise<InstalledTheme[]>;
  getActiveTheme(): Promise<ActiveTheme>;
  setActiveTheme(themeId: string): Promise<{ success: boolean; cssContent: string }>;
  deleteTheme(themeId: string): Promise<boolean>;
  importThemeFromDialog(): Promise<InstalledTheme | null>;
  fetchStoreCatalog(forceRefresh?: boolean): Promise<StoreCatalogResponse>;
  installFromStore(themeId: string): Promise<InstalledTheme>;
  onDownloadProgress(listener: (event: ThemeDownloadProgress) => void): () => void;
  onThemeChanged(listener: (event: ThemeChangedEvent) => void): () => void;
  testFilterImage(): Promise<RuleSandboxResult | null>;
  previewAnalysis(scope: AnalysisScope, engine?: string): Promise<AnalysisScopePreview>;
  createAnalysisJob(scope: AnalysisScope, engine?: string): Promise<AnalysisJob>;
  listAnalysisJobs(): Promise<AnalysisJob[]>;
  listAnalysisTaskSummaries(): Promise<AnalysisTaskSummary[]>;
  startAnalysisJob(jobId: string): Promise<AnalysisJob>;
  cancelAnalysisJob(jobId: string): Promise<AnalysisJob>;
  applyAnalysisSuggestions(jobId: string, suggestionIds: string[]): Promise<AnalysisApplyResult>;
  getExternalVisionConfig(providerId: string): Promise<ExternalVisionPublicConfig>;
  saveExternalVisionConfig(config: ExternalVisionPublicConfig, newApiKey?: string): Promise<ExternalVisionPublicConfig>;
  deleteExternalVisionApiKey(providerId: string): Promise<void>;
  testExternalVisionConnection(providerId: string): Promise<{ success: boolean; latencyMs: number; error?: string }>;
  listVisionEvaluationsForWork(workId: string): Promise<VisionEvaluationResult[]>;
  evaluateWorkVision(request: VisionEvaluationRequest): Promise<VisionEvaluationResult>;
  getModelCenterSnapshot(): Promise<ModelCenterSnapshot>;
  installModel(modelId: string): Promise<ModelCenterSnapshot>;
  cancelModelDownload(modelId: string): Promise<boolean>;
  removeModel(modelId: string): Promise<ModelCenterSnapshot>;
  activateModel(modelId: string): Promise<ModelActivationResult>;
  deactivateModel(modelId: string): Promise<ModelCenterSnapshot>;
  openModelHomepage(modelId: string): Promise<boolean>;
  openModelsDirectory(): Promise<boolean>;
  onModelDownloadProgress(listener: (event: ModelDownloadProgress) => void): () => void;
  getPromptWorkspace(engine: string, engineVersion: string): Promise<PromptWorkspacePreferences>;
  savePromptWorkspace(engine: string, engineVersion: string, preferences: PromptWorkspacePreferences): Promise<PromptWorkspacePreferences>;
  copyPromptText(text: string): Promise<boolean>;
  getComfyUiConfig(): Promise<ComfyUiConfig>;
  saveComfyUiConfig(config: ComfyUiConfig): Promise<ComfyUiConfig>;
  testComfyUiConnection(): Promise<{ success: boolean; latencyMs: number; deviceName?: string; error?: string }>;
  listComfyUiTemplates(): Promise<ComfyWorkflowTemplateSummary[]>;
  importComfyUiTemplate(): Promise<ComfyWorkflowTemplateSummary | null>;
  deleteComfyUiTemplate(templateId: string): Promise<boolean>;
  listComfyUiJobs(): Promise<ComfyUiJob[]>;
  startComfyUiJob(request: ComfyUiSendRequest): Promise<ComfyUiJob>;
  cancelComfyUiJob(jobId: string): Promise<ComfyUiJob>;
  inspectArtwork(params: { workId?: string; artworkId?: string; url?: string; pageIndex?: number }): Promise<InspectArtworkResponse | null>;
  addCustomBlacklistTag(payload: { tag: string; threshold?: number; action?: "blur" | "hide"; groupName?: string }): Promise<CustomElementGroup[]>;
  queryTriageWorks(params: { tags: string[]; minConfidence?: number; scope?: AnalysisScope }): Promise<TriageQueryResultItem[]>;
  queryTriageByExploreRules(scope: AnalysisScope): Promise<ExploreTriageResult>;
  showExplore(bounds: ExploreBounds): Promise<ExploreState>;
  setExploreBounds(bounds: ExploreBounds): Promise<boolean>;
  hideExplore(): Promise<void>;
  focusExplore(): Promise<void>;
  exploreCommand(command: ExploreCommand): Promise<ExploreState>;
  navigateExplore(input: string): Promise<ExploreState>;
  listExploreSites(): Promise<Array<{ url: string; title: string }>>;
  saveExploreSite(remove?: string): Promise<Array<{ url: string; title: string }>>;
  openPixivArtist(artistId: string): Promise<ExploreState>;
  getExploreState(): Promise<ExploreState>;
  downloadCurrentArtwork(): Promise<ExploreDownloadResult>;
  previewBookmarkDownload(): Promise<BookmarkDownloadPreview>;
  downloadAllBookmarks(): Promise<ExploreDownloadResult>;
  listFonts(): Promise<TypographyFontDescriptor[]>;
  importFontFromDialog(): Promise<TypographyFontDescriptor | null>;
  deleteFont(fontId: string): Promise<boolean>;
  getTypographyPreferences(): Promise<TypographyPreferencesV1>;
  saveTypographyPreferences(preferences: TypographyPreferencesV1): Promise<TypographyPreferencesV1>;
  onExploreState(listener: (state: ExploreState) => void): () => void;
  onExploreOpenInspector(listener: (data: { artworkId?: string; url?: string; pageIndex?: number }) => void): () => void;
  onAppStatus(listener: (status: ApplicationStatus) => void): () => void;
  onQuickActionsRequested(listener: () => void): () => void;
  status(): Promise<ApplicationStatus>;
}

const api: SanctuaryApi = {
  listArtworks: () => ipcRenderer.invoke("library:list") as Promise<ArtworkRecord[]>,
  listCollectionSummaries: () => ipcRenderer.invoke("collections:summaries") as Promise<CollectionSummary[]>,
  listArtistSummaries: () => ipcRenderer.invoke("artists:summaries") as Promise<ArtistSummary[]>,
  querySavedViewSummaries: (query = {}) => ipcRenderer.invoke("saved-collection-views:summaries", query) as Promise<SavedViewSummaryResult>,
  listScopedArtworks: (scope) => ipcRenderer.invoke("library:scoped-artworks", scope) as Promise<ScopedArtworkRecord[]>,
  queryArtworkPages: (query = {}) => ipcRenderer.invoke("library:query-artwork-pages", query) as Promise<ArtworkPageQueryResult>,
  addArtworksToCollection: (artworkIds, collectionId) => ipcRenderer.invoke("collections:add-artworks", artworkIds, collectionId) as Promise<number>,
  queryWorks: (query = {}) =>
    ipcRenderer.invoke("library:query-works", query) as Promise<WorkQueryResult>,
  getWork: (workId) =>
    ipcRenderer.invoke("library:get-work", workId) as Promise<WorkRecord | null>,
  getWorkInformation: (workId, pageIndex) =>
    ipcRenderer.invoke("library:work-information", workId, pageIndex) as Promise<WorkInformation | null>,
  renameWork: (workId, name) => ipcRenderer.invoke("library:rename-work", workId, name) as Promise<WorkRecord>,
  relinkExternalImage: (workId, assetId) => ipcRenderer.invoke("library:relink-external", workId, assetId) as Promise<WorkRecord | null>,
  prepareInspirationTargets: (targets) => ipcRenderer.invoke("inspiration:prepare-targets", targets) as Promise<Array<{workId:string;pageIndex:number}>>,
  importInspirationSources: (id) => ipcRenderer.invoke("inspiration:import-sources", id) as Promise<Array<{workId:string;pageIndex:number}>>,
  exportImages: (targets) => ipcRenderer.invoke("images:export", targets),
  getImageExport: (id) => ipcRenderer.invoke("images:export-get", id),
  currentImageExport: () => ipcRenderer.invoke("images:export-current"),
  cancelImageExport: (id) => ipcRenderer.invoke("images:export-cancel", id),
  retryImageExport: (id) => ipcRenderer.invoke("images:export-retry", id),
  useImage: (target, action) => ipcRenderer.invoke("images:use", target, action),
  dragImage: (target) => ipcRenderer.invoke("images:drag", target),
  getGalleryBanner: () => ipcRenderer.invoke("gallery:banner-get"),
  chooseGalleryBanner: () => ipcRenderer.invoke("gallery:banner-choose"),
  resetGalleryBanner: () => ipcRenderer.invoke("gallery:banner-reset"),
  searchGalleryPictures: (text, query) => ipcRenderer.invoke("gallery:search-pictures",text,query),
  galleryPictureResults: (id, offset=0) => ipcRenderer.invoke("gallery:picture-results",id,offset),
  currentGalleryPictureSearch: () => ipcRenderer.invoke("gallery:current-picture-search"),
  chooseWorkbenchFolder: (recursive) => ipcRenderer.invoke("workbench:folder", recursive),
  chooseWorkbenchLibrary: (scope) => ipcRenderer.invoke("workbench:library", scope),
  currentWorkbench: (source) => ipcRenderer.invoke("workbench:current", source),
  getWorkbench: (id, offset = 0, filter = "matches") => ipcRenderer.invoke("workbench:get", id, offset, filter),
  startWorkbench: (id, query) => ipcRenderer.invoke("workbench:start", id, query),
  cancelWorkbench: (id) => ipcRenderer.invoke("workbench:cancel", id),
  prepareWorkbenchImport: (id, ids) => ipcRenderer.invoke("workbench:import", id, ids),
  assignWorkbenchImages: (id, ids, collectionId) => ipcRenderer.invoke("workbench:assign", id, ids, collectionId),
  semanticAvailability: () => ipcRenderer.invoke("workbench:semantic-status"),
  listImageTaskSummaries: () => ipcRenderer.invoke("tasks:images"),
  recordWorkView: (workId, assetId) =>
    ipcRenderer.invoke("library:record-work-view", { workId, assetId }) as Promise<WorkReadingProgress | null>,
  getGenerationProvenance: (workId) =>
    ipcRenderer.invoke("library:get-generation-provenance", workId) as Promise<GenerationProvenance | null>,
  listInspirationConversations: () =>
    ipcRenderer.invoke("inspiration:list") as Promise<InspirationConversation[]>,
  sendInspirationMessage: (request) =>
    ipcRenderer.invoke("inspiration:send", request) as Promise<InspirationConversation>,
  regenerateInspirationMessage: (request) =>
    ipcRenderer.invoke("inspiration:regenerate", request) as Promise<InspirationConversation>,
  updateInspirationSource: (request) =>
    ipcRenderer.invoke("inspiration:update-source", request) as Promise<InspirationConversation>,
  cancelInspirationMessage: (requestId) =>
    ipcRenderer.invoke("inspiration:cancel", requestId) as Promise<boolean>,
  deleteInspirationConversation: (conversationId) =>
    ipcRenderer.invoke("inspiration:delete", conversationId) as Promise<boolean>,
  exportInspirationMarkdown: (request) =>
    ipcRenderer.invoke("inspiration:export-markdown", request) as Promise<InspirationExportResult>,
  copyInspirationMarkdown: (request) =>
    ipcRenderer.invoke("inspiration:copy-markdown", request) as Promise<void>,
  copyInspirationMessage: (request) =>
    ipcRenderer.invoke("inspiration:copy-message", request) as Promise<void>,
  inspectArtwork: (params) =>
    ipcRenderer.invoke("vision:inspect-artwork", params) as Promise<InspectArtworkResponse | null>,
  addCustomBlacklistTag: (payload) =>
    ipcRenderer.invoke("filters:add-blacklist-tag", payload) as Promise<CustomElementGroup[]>,
  queryTriageWorks: (params) =>
    ipcRenderer.invoke("analysis:triage-query", params) as Promise<TriageQueryResultItem[]>,
  queryTriageByExploreRules: (scope) =>
    ipcRenderer.invoke("analysis:triage-explore-rules", scope) as Promise<ExploreTriageResult>,
  generateThumbnails: () =>
    ipcRenderer.invoke("library:generate-thumbnails") as Promise<ThumbnailBatchResult>,
  createLibraryBackup: () =>
    ipcRenderer.invoke("library:create-backup") as Promise<string | null>,
  previewWorkDeletion: (workIds) =>
    ipcRenderer.invoke("library:delete-preview", workIds) as Promise<WorkDeletionPreview>,
  confirmWorkDeletion: (token) =>
    ipcRenderer.invoke("library:delete-confirmed", token) as Promise<WorkDeletionResult>,
  importImages: () => ipcRenderer.invoke("library:import") as Promise<LocalImportBatch | null>,
  getImportBatch: (id) => ipcRenderer.invoke("library:import-get", id) as Promise<LocalImportBatch>,
  startImportBatch: (id, options) => ipcRenderer.invoke("library:import-start", id, options) as Promise<LocalImportBatch>,
  cancelImportBatch: (id) => ipcRenderer.invoke("library:import-cancel", id) as Promise<LocalImportBatch>,
  retryImportBatch: (id) => ipcRenderer.invoke("library:import-retry", id) as Promise<LocalImportBatch>,
  listCollections: () => ipcRenderer.invoke("collections:list") as Promise<CollectionRecord[]>,
  createCollection: (draft) =>
    ipcRenderer.invoke("collections:create", draft) as Promise<CollectionRecord[]>,
  updateCollection: (collectionId, draft) =>
    ipcRenderer.invoke("collections:update", collectionId, draft) as Promise<CollectionRecord[]>,
  deleteCollection: (collectionId) =>
    ipcRenderer.invoke("collections:delete", collectionId) as Promise<CollectionRecord[]>,
  updateCollectionCover: (collectionId, artworkId) =>
    ipcRenderer.invoke("collections:update-cover", collectionId, artworkId) as Promise<CollectionRecord[]>,
  listSavedCollectionViews: () =>
    ipcRenderer.invoke("saved-collection-views:list") as Promise<SavedCollectionView[]>,
  createSavedCollectionView: (draft) =>
    ipcRenderer.invoke("saved-collection-views:create", draft) as Promise<SavedCollectionView>,
  updateSavedCollectionView: (id, draft) =>
    ipcRenderer.invoke("saved-collection-views:update", id, draft) as Promise<SavedCollectionView | null>,
  deleteSavedCollectionView: (id) =>
    ipcRenderer.invoke("saved-collection-views:delete", id) as Promise<boolean>,
  listSavedWorkFilters: () => ipcRenderer.invoke("saved-work-filters:list") as Promise<SavedWorkFilter[]>,
  createSavedWorkFilter: (draft) => ipcRenderer.invoke("saved-work-filters:create", draft) as Promise<SavedWorkFilter>,
  deleteSavedWorkFilter: (id) => ipcRenderer.invoke("saved-work-filters:delete", id) as Promise<boolean>,
  addArtworkToCollection: (artworkId, collectionId) =>
    ipcRenderer.invoke(
      "collections:add-artwork",
      artworkId,
      collectionId
    ) as Promise<ArtworkRecord[]>,
  addWorkToCollection: (workId, collectionId) =>
    ipcRenderer.invoke(
      "collections:add-work",
      workId,
      collectionId
    ) as Promise<WorkRecord | null>,
  removeWorkFromCollection: (workId, collectionId) =>
    ipcRenderer.invoke(
      "collections:remove-work",
      workId,
      collectionId
    ) as Promise<WorkRecord | null>,
  updateWorkFavorite: (workIds, favorite) =>
    ipcRenderer.invoke("library:update-favorite", workIds, favorite) as Promise<boolean>,
  getAppearancePreferences: () =>
    ipcRenderer.invoke("preferences:appearance:get") as Promise<AppearancePreferences>,
  updateAppearancePreferences: (preferences) =>
    ipcRenderer.invoke("preferences:appearance:update", preferences) as Promise<AppearancePreferences>,
  listArtists: () => ipcRenderer.invoke("artists:list") as Promise<ArtistRecord[]>,
  repairArtistAvatars: () =>
    ipcRenderer.invoke("artists:repair-avatars") as Promise<ArtistAvatarRepairResult>,
  listFilterSettings: () =>
    ipcRenderer.invoke("filters:list") as Promise<ElementFilterSetting[]>,
  updateFilterSetting: (setting) =>
    ipcRenderer.invoke("filters:update", setting) as Promise<ElementFilterSetting[]>,
  listCustomElementGroups: () =>
    ipcRenderer.invoke("filters:custom-list") as Promise<CustomElementGroup[]>,
  updateCustomElementGroups: (groups) =>
    ipcRenderer.invoke("filters:custom-update", groups) as Promise<CustomElementGroup[]>,
  listPersonalTagPreferences: () =>
    ipcRenderer.invoke("filters:personal-preferences-list") as Promise<PersonalPreferenceProfileView>,
  togglePersonalTagPreference: (label, enabled) =>
    ipcRenderer.invoke("filters:personal-preference-toggle", { label, enabled }) as Promise<PersonalPreferenceProfileView>,
  resetPersonalTagPreferences: () =>
    ipcRenderer.invoke("filters:personal-preferences-reset") as Promise<PersonalPreferenceProfileView>,
  getLibraryPreferences: () =>
    ipcRenderer.invoke("preferences:library:get") as Promise<LibraryPreferences>,
  updateLibraryPreferences: (preferences) =>
    ipcRenderer.invoke("preferences:library:update", preferences) as Promise<LibraryPreferences>,
  getStorageLocation: () =>
    ipcRenderer.invoke("preferences:library:get-storage-location") as Promise<StorageLocationInfo>,
  chooseDownloadDirectory: () =>
    ipcRenderer.invoke("preferences:library:choose-download-directory") as Promise<StorageDirectoryChoiceResult>,
  openStorageDirectory: () =>
    ipcRenderer.invoke("preferences:library:open-storage-directory") as Promise<boolean>,
  migrateStorage: () =>
    ipcRenderer.invoke("preferences:library:migrate-storage") as Promise<StorageMigrationResult>,
  getInstalledThemes: () =>
    ipcRenderer.invoke("themes:installed") as Promise<InstalledTheme[]>,
  getActiveTheme: () =>
    ipcRenderer.invoke("themes:active") as Promise<ActiveTheme>,
  setActiveTheme: (themeId) =>
    ipcRenderer.invoke("themes:set-active", themeId) as Promise<{ success: boolean; cssContent: string }>,
  deleteTheme: (themeId) =>
    ipcRenderer.invoke("themes:delete", themeId) as Promise<boolean>,
  importThemeFromDialog: () =>
    ipcRenderer.invoke("themes:import") as Promise<InstalledTheme | null>,
  fetchStoreCatalog: (forceRefresh = false) =>
    ipcRenderer.invoke("themes:store-catalog", forceRefresh) as Promise<StoreCatalogResponse>,
  installFromStore: (themeId) =>
    ipcRenderer.invoke("themes:store-install", themeId) as Promise<InstalledTheme>,
  onDownloadProgress: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, data: ThemeDownloadProgress) => listener(data);
    ipcRenderer.on("themes:download-progress", wrapped);
    return () => ipcRenderer.removeListener("themes:download-progress", wrapped);
  },
  onThemeChanged: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, data: ThemeChangedEvent) => listener(data);
    ipcRenderer.on("themes:changed", wrapped);
    return () => ipcRenderer.removeListener("themes:changed", wrapped);
  },
  testFilterImage: () =>
    ipcRenderer.invoke("filters:test-image") as Promise<RuleSandboxResult | null>,
  previewAnalysis: (scope, engine) =>
    ipcRenderer.invoke("analysis:preview", scope, engine) as Promise<AnalysisScopePreview>,
  createAnalysisJob: (scope, engine) =>
    ipcRenderer.invoke("analysis:create", scope, engine) as Promise<AnalysisJob>,
  listAnalysisJobs: () =>
    ipcRenderer.invoke("analysis:list") as Promise<AnalysisJob[]>,
  listAnalysisTaskSummaries: () => ipcRenderer.invoke("tasks:analysis") as Promise<AnalysisTaskSummary[]>,
  startAnalysisJob: (jobId) =>
    ipcRenderer.invoke("analysis:start", jobId) as Promise<AnalysisJob>,
  cancelAnalysisJob: (jobId) =>
    ipcRenderer.invoke("analysis:cancel", jobId) as Promise<AnalysisJob>,
  applyAnalysisSuggestions: (jobId, suggestionIds) =>
    ipcRenderer.invoke("analysis:apply-suggestions", { jobId, suggestionIds }) as Promise<AnalysisApplyResult>,
  getExternalVisionConfig: (providerId) =>
    ipcRenderer.invoke("vision:get-config", providerId) as Promise<ExternalVisionPublicConfig>,
  saveExternalVisionConfig: (config, newApiKey) =>
    ipcRenderer.invoke("vision:save-config", config, newApiKey) as Promise<ExternalVisionPublicConfig>,
  deleteExternalVisionApiKey: (providerId) =>
    ipcRenderer.invoke("vision:delete-key", providerId) as Promise<void>,
  testExternalVisionConnection: (providerId) =>
    ipcRenderer.invoke("vision:test-connection", providerId) as Promise<{ success: boolean; latencyMs: number; error?: string }>,
  listVisionEvaluationsForWork: (workId) =>
    ipcRenderer.invoke("vision:list-evaluations", workId) as Promise<VisionEvaluationResult[]>,
  evaluateWorkVision: (request) =>
    ipcRenderer.invoke("vision:evaluate-work", request) as Promise<VisionEvaluationResult>,
  getModelCenterSnapshot: () =>
    ipcRenderer.invoke("models:snapshot") as Promise<ModelCenterSnapshot>,
  installModel: (modelId) =>
    ipcRenderer.invoke("models:install", modelId) as Promise<ModelCenterSnapshot>,
  cancelModelDownload: (modelId) =>
    ipcRenderer.invoke("models:cancel", modelId) as Promise<boolean>,
  removeModel: (modelId) =>
    ipcRenderer.invoke("models:remove", modelId) as Promise<ModelCenterSnapshot>,
  activateModel: (modelId) =>
    ipcRenderer.invoke("models:activate", modelId) as Promise<ModelActivationResult>,
  deactivateModel: (modelId) =>
    ipcRenderer.invoke("models:deactivate", modelId) as Promise<ModelCenterSnapshot>,
  openModelHomepage: (modelId) =>
    ipcRenderer.invoke("models:open-homepage", modelId) as Promise<boolean>,
  openModelsDirectory: () =>
    ipcRenderer.invoke("models:open-directory") as Promise<boolean>,
  onModelDownloadProgress: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, data: ModelDownloadProgress) => listener(data);
    ipcRenderer.on("models:download-progress", wrapped);
    return () => ipcRenderer.removeListener("models:download-progress", wrapped);
  },
  getPromptWorkspace: (engine, engineVersion) =>
    ipcRenderer.invoke("prompt-bridge:get-workspace", engine, engineVersion) as Promise<PromptWorkspacePreferences>,
  savePromptWorkspace: (engine, engineVersion, preferences) =>
    ipcRenderer.invoke("prompt-bridge:save-workspace", engine, engineVersion, preferences) as Promise<PromptWorkspacePreferences>,
  copyPromptText: (text) =>
    ipcRenderer.invoke("prompt-bridge:copy", text) as Promise<boolean>,
  getComfyUiConfig: () =>
    ipcRenderer.invoke("comfyui:get-config") as Promise<ComfyUiConfig>,
  saveComfyUiConfig: (config) =>
    ipcRenderer.invoke("comfyui:save-config", config) as Promise<ComfyUiConfig>,
  testComfyUiConnection: () =>
    ipcRenderer.invoke("comfyui:test-connection") as Promise<{ success: boolean; latencyMs: number; deviceName?: string; error?: string }>,
  listComfyUiTemplates: () =>
    ipcRenderer.invoke("comfyui:list-templates") as Promise<ComfyWorkflowTemplateSummary[]>,
  importComfyUiTemplate: () =>
    ipcRenderer.invoke("comfyui:import-template") as Promise<ComfyWorkflowTemplateSummary | null>,
  deleteComfyUiTemplate: (templateId) =>
    ipcRenderer.invoke("comfyui:delete-template", templateId) as Promise<boolean>,
  listComfyUiJobs: () =>
    ipcRenderer.invoke("comfyui:list-jobs") as Promise<ComfyUiJob[]>,
  startComfyUiJob: (request) =>
    ipcRenderer.invoke("comfyui:start-job", request) as Promise<ComfyUiJob>,
  cancelComfyUiJob: (jobId) =>
    ipcRenderer.invoke("comfyui:cancel-job", jobId) as Promise<ComfyUiJob>,
  showExplore: (bounds) =>
    ipcRenderer.invoke("explore:show", bounds) as Promise<ExploreState>,
  setExploreBounds: (bounds) =>
    ipcRenderer.invoke("explore:set-bounds", bounds) as Promise<boolean>,
  hideExplore: () => ipcRenderer.invoke("explore:hide") as Promise<void>,
  focusExplore: () => ipcRenderer.invoke("explore:focus") as Promise<void>,
  exploreCommand: (command) =>
    ipcRenderer.invoke("explore:command", command) as Promise<ExploreState>,
  openPixivArtist: (artistId) =>
    ipcRenderer.invoke("explore:open-artist", artistId) as Promise<ExploreState>,
  getExploreState: () => ipcRenderer.invoke("explore:state") as Promise<ExploreState>,
  navigateExplore: (input) => ipcRenderer.invoke("explore:navigate", input) as Promise<ExploreState>,
  listExploreSites: () => ipcRenderer.invoke("explore:sites") as Promise<Array<{url:string;title:string}>>,
  saveExploreSite: (remove) => ipcRenderer.invoke("explore:save-site", remove) as Promise<Array<{url:string;title:string}>>,
  downloadCurrentArtwork: () =>
    ipcRenderer.invoke("explore:download-current") as Promise<ExploreDownloadResult>,
  previewBookmarkDownload: () =>
    ipcRenderer.invoke("explore:bookmarks-preview") as Promise<BookmarkDownloadPreview>,
  downloadAllBookmarks: () =>
    ipcRenderer.invoke("explore:download-bookmarks") as Promise<ExploreDownloadResult>,
  listFonts: () => ipcRenderer.invoke("typography:list-fonts") as Promise<TypographyFontDescriptor[]>,
  importFontFromDialog: () => ipcRenderer.invoke("typography:import-dialog") as Promise<TypographyFontDescriptor | null>,
  deleteFont: (fontId) => ipcRenderer.invoke("typography:delete-font", fontId) as Promise<boolean>,
  getTypographyPreferences: () => ipcRenderer.invoke("typography:get-preferences") as Promise<TypographyPreferencesV1>,
  saveTypographyPreferences: (preferences) =>
    ipcRenderer.invoke("typography:save-preferences", preferences) as Promise<TypographyPreferencesV1>,
  onExploreState: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, state: ExploreState) => listener(state);
    ipcRenderer.on("explore:state-changed", wrapped);
    return () => ipcRenderer.removeListener("explore:state-changed", wrapped);
  },
  onAppStatus: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, status: ApplicationStatus) => listener(status);
    ipcRenderer.on("app:status-changed", wrapped);
    return () => ipcRenderer.removeListener("app:status-changed", wrapped);
  },
  onQuickActionsRequested: (listener) => {
    const wrapped = () => listener();
    ipcRenderer.on("app:quick-actions", wrapped);
    return () => ipcRenderer.removeListener("app:quick-actions", wrapped);
  },
  onExploreOpenInspector: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, data: { artworkId?: string; url?: string }) => listener(data);
    ipcRenderer.on("explore:open-inspector", wrapped);
    return () => ipcRenderer.removeListener("explore:open-inspector", wrapped);
  },
  status: () => ipcRenderer.invoke("app:status") as ReturnType<SanctuaryApi["status"]>
};

contextBridge.exposeInMainWorld("sanctuary", api);
