import type { SanctuaryApi } from "../../preload/index";

declare global {
  interface Window {
    sanctuary: SanctuaryApi;
  }
}

export {};

