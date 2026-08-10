import { contextBridge, ipcRenderer } from "electron";
import type {
  ArtworkRecord,
  CollectionRecord,
  ElementFilterSetting
} from "@sanctuary/domain";

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
  blockedFirstPartyPromotions: number;
  approvedResources: number;
  pendingResources: number;
  remoteReviewCacheHits: number;
  remoteReviewCacheMisses: number;
  error: string;
  maximized: boolean;
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
  importImages(): Promise<ArtworkRecord[]>;
  listCollections(): Promise<CollectionRecord[]>;
  createCollection(name: string): Promise<CollectionRecord[]>;
  addArtworkToCollection(artworkId: string, collectionId: string): Promise<ArtworkRecord[]>;
  listFilterSettings(): Promise<ElementFilterSetting[]>;
  updateFilterSetting(setting: ElementFilterSetting): Promise<ElementFilterSetting[]>;
  showExplore(bounds: ExploreBounds): Promise<ExploreState>;
  setExploreBounds(bounds: ExploreBounds): Promise<boolean>;
  hideExplore(): Promise<void>;
  exploreCommand(command: ExploreCommand): Promise<ExploreState>;
  getExploreState(): Promise<ExploreState>;
  onExploreState(listener: (state: ExploreState) => void): () => void;
  status(): Promise<{
    visionEngine: string;
    visionReady: boolean;
    modelBacked: boolean;
  }>;
}

const api: SanctuaryApi = {
  listArtworks: () => ipcRenderer.invoke("library:list") as Promise<ArtworkRecord[]>,
  importImages: () => ipcRenderer.invoke("library:import") as Promise<ArtworkRecord[]>,
  listCollections: () => ipcRenderer.invoke("collections:list") as Promise<CollectionRecord[]>,
  createCollection: (name) =>
    ipcRenderer.invoke("collections:create", name) as Promise<CollectionRecord[]>,
  addArtworkToCollection: (artworkId, collectionId) =>
    ipcRenderer.invoke(
      "collections:add-artwork",
      artworkId,
      collectionId
    ) as Promise<ArtworkRecord[]>,
  listFilterSettings: () =>
    ipcRenderer.invoke("filters:list") as Promise<ElementFilterSetting[]>,
  updateFilterSetting: (setting) =>
    ipcRenderer.invoke("filters:update", setting) as Promise<ElementFilterSetting[]>,
  showExplore: (bounds) =>
    ipcRenderer.invoke("explore:show", bounds) as Promise<ExploreState>,
  setExploreBounds: (bounds) =>
    ipcRenderer.invoke("explore:set-bounds", bounds) as Promise<boolean>,
  hideExplore: () => ipcRenderer.invoke("explore:hide") as Promise<void>,
  exploreCommand: (command) =>
    ipcRenderer.invoke("explore:command", command) as Promise<ExploreState>,
  getExploreState: () => ipcRenderer.invoke("explore:state") as Promise<ExploreState>,
  onExploreState: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, state: ExploreState) => listener(state);
    ipcRenderer.on("explore:state-changed", wrapped);
    return () => ipcRenderer.removeListener("explore:state-changed", wrapped);
  },
  status: () => ipcRenderer.invoke("app:status") as ReturnType<SanctuaryApi["status"]>
};

contextBridge.exposeInMainWorld("sanctuary", api);
