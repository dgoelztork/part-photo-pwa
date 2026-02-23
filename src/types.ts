export interface PartRecord {
  partNumber: string;
  description: string;
}

export interface CapturedPhoto {
  originalFile: File;
  blob: Blob;
  thumbnailUrl: string;
  finalName: string;
}

export interface AppState {
  currentScreen: Screen;
  isAuthenticated: boolean;
  userName: string;
  partsLoaded: number;
  partsLastSync: string | null;
  currentPart: { partNumber: string; description: string } | null;
  photos: CapturedPhoto[];
}

export type Screen = "login" | "home" | "scan" | "capture" | "export";

export interface AppSettings {
  csvFilePath: string;
  photoFolderPath: string;
}
