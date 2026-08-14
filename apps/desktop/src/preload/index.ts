import { contextBridge, ipcRenderer } from "electron";
import type {
  AppearancePreferences,
  AnalysisApplyResult,
  AnalysisJob,
  AnalysisScope,
  AnalysisScopePreview,
  ArtistRecord,
  ArtworkRecord,
  CollectionRecord,
  CustomElementGroup,
  ElementFilterSetting,
  LibraryPreferences,
  RuleSandboxResult,
  SavedCollectionView,
  SavedCollectionViewDraft,
  ActiveTheme,
  InstalledTheme,
  StoreCatalogResponse,
  ThemeChangedEvent,
  ThemeDownloadProgress,
  WorkQuery,
  WorkQueryResult,
  WorkRecord,
  WorkDeletionPreview,
  WorkDeletionResult,
  ExternalVisionPublicConfig,
  VisionEvaluationResult
} from "@sanctuary/domain";
import type {
  ArtistAvatarRepairResult,
  BookmarkDownloadPreview,
  ExploreDownloadResult,
  ExploreDownloadState,
  PixivPageKind
} from "../shared/pixiv-download.js";
import type { ThumbnailBatchResult } from "../main/thumbnail-service.js";

export interface ExploreBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ExploreState {
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
  | "maximize";

export interface SanctuaryApi {
  listArtworks(): Promise<ArtworkRecord[]>;
  queryWorks(query?: WorkQuery): Promise<WorkQueryResult>;
  getWork(workId: string): Promise<WorkRecord | null>;
  generateThumbnails(): Promise<ThumbnailBatchResult>;
  createLibraryBackup(): Promise<string | null>;
  previewWorkDeletion(workIds: string[]): Promise<WorkDeletionPreview>;
  confirmWorkDeletion(token: string): Promise<WorkDeletionResult>;
  importImages(): Promise<ArtworkRecord[]>;
  listCollections(): Promise<CollectionRecord[]>;
  createCollection(draft: { name: string; description: string }): Promise<CollectionRecord[]>;
  updateCollection(collectionId: string, draft: { name: string; description: string }): Promise<CollectionRecord[]>;
  deleteCollection(collectionId: string): Promise<CollectionRecord[]>;
  updateCollectionCover(collectionId: string, artworkId: string | null): Promise<CollectionRecord[]>;
  listSavedCollectionViews(): Promise<SavedCollectionView[]>;
  createSavedCollectionView(draft: SavedCollectionViewDraft): Promise<SavedCollectionView>;
  updateSavedCollectionView(id: string, draft: SavedCollectionViewDraft): Promise<SavedCollectionView | null>;
  deleteSavedCollectionView(id: string): Promise<boolean>;
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
  getLibraryPreferences(): Promise<LibraryPreferences>;
  updateLibraryPreferences(preferences: LibraryPreferences): Promise<LibraryPreferences>;
  chooseDownloadDirectory(): Promise<LibraryPreferences>;
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
  startAnalysisJob(jobId: string): Promise<AnalysisJob>;
  cancelAnalysisJob(jobId: string): Promise<AnalysisJob>;
  applyAnalysisSuggestions(jobId: string, suggestionIds: string[]): Promise<AnalysisApplyResult>;
  getExternalVisionConfig(providerId: string): Promise<ExternalVisionPublicConfig>;
  saveExternalVisionConfig(config: ExternalVisionPublicConfig, newApiKey?: string): Promise<ExternalVisionPublicConfig>;
  deleteExternalVisionApiKey(providerId: string): Promise<void>;
  testExternalVisionConnection(providerId: string): Promise<{ success: boolean; latencyMs: number; error?: string }>;
  listVisionEvaluationsForWork(workId: string): Promise<VisionEvaluationResult[]>;
  showExplore(bounds: ExploreBounds): Promise<ExploreState>;
  setExploreBounds(bounds: ExploreBounds): Promise<boolean>;
  hideExplore(): Promise<void>;
  exploreCommand(command: ExploreCommand): Promise<ExploreState>;
  getExploreState(): Promise<ExploreState>;
  downloadCurrentArtwork(): Promise<ExploreDownloadResult>;
  previewBookmarkDownload(): Promise<BookmarkDownloadPreview>;
  downloadAllBookmarks(): Promise<ExploreDownloadResult>;
  onExploreState(listener: (state: ExploreState) => void): () => void;
  status(): Promise<{
    visionEngine: string;
    visionProvider: string;
    visionReady: boolean;
    modelBacked: boolean;
  }>;
}

const api: SanctuaryApi = {
  listArtworks: () => ipcRenderer.invoke("library:list") as Promise<ArtworkRecord[]>,
  queryWorks: (query = {}) =>
    ipcRenderer.invoke("library:query-works", query) as Promise<WorkQueryResult>,
  getWork: (workId) =>
    ipcRenderer.invoke("library:get-work", workId) as Promise<WorkRecord | null>,
  generateThumbnails: () =>
    ipcRenderer.invoke("library:generate-thumbnails") as Promise<ThumbnailBatchResult>,
  createLibraryBackup: () =>
    ipcRenderer.invoke("library:create-backup") as Promise<string | null>,
  previewWorkDeletion: (workIds) =>
    ipcRenderer.invoke("library:delete-preview", workIds) as Promise<WorkDeletionPreview>,
  confirmWorkDeletion: (token) =>
    ipcRenderer.invoke("library:delete-confirmed", token) as Promise<WorkDeletionResult>,
  importImages: () => ipcRenderer.invoke("library:import") as Promise<ArtworkRecord[]>,
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
  getLibraryPreferences: () =>
    ipcRenderer.invoke("preferences:library:get") as Promise<LibraryPreferences>,
  updateLibraryPreferences: (preferences) =>
    ipcRenderer.invoke("preferences:library:update", preferences) as Promise<LibraryPreferences>,
  chooseDownloadDirectory: () =>
    ipcRenderer.invoke("preferences:library:choose-download-directory") as Promise<LibraryPreferences>,
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
  showExplore: (bounds) =>
    ipcRenderer.invoke("explore:show", bounds) as Promise<ExploreState>,
  setExploreBounds: (bounds) =>
    ipcRenderer.invoke("explore:set-bounds", bounds) as Promise<boolean>,
  hideExplore: () => ipcRenderer.invoke("explore:hide") as Promise<void>,
  exploreCommand: (command) =>
    ipcRenderer.invoke("explore:command", command) as Promise<ExploreState>,
  getExploreState: () => ipcRenderer.invoke("explore:state") as Promise<ExploreState>,
  downloadCurrentArtwork: () =>
    ipcRenderer.invoke("explore:download-current") as Promise<ExploreDownloadResult>,
  previewBookmarkDownload: () =>
    ipcRenderer.invoke("explore:bookmarks-preview") as Promise<BookmarkDownloadPreview>,
  downloadAllBookmarks: () =>
    ipcRenderer.invoke("explore:download-bookmarks") as Promise<ExploreDownloadResult>,
  onExploreState: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, state: ExploreState) => listener(state);
    ipcRenderer.on("explore:state-changed", wrapped);
    return () => ipcRenderer.removeListener("explore:state-changed", wrapped);
  },
  status: () => ipcRenderer.invoke("app:status") as ReturnType<SanctuaryApi["status"]>
};

contextBridge.exposeInMainWorld("sanctuary", api);
