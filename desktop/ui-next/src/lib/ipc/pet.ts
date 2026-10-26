import { invoke, listen } from "./ipc";

export type PetSound = "press" | "release" | "start" | "end" | "error" | "approval" | "question" | "idle";
export interface PetPreferences {
  scale: number;
  snap: boolean;
  bubble: "tasks" | "quota" | "credits" | "none";
  click_bubble: "credits" | "greeting" | "none";
  bubble_seconds: number;
  quota_alerts: boolean;
  quota_warning: number;
  quota_critical: number;
  credits_warning: number;
  quiet_enabled: boolean;
  quiet_start: number;
  quiet_end: number;
  muted_until: number;
  sounds: Record<PetSound, { enabled: boolean; volume: number; source: string }>;
}
export type PetPreferencesPatch = Partial<Omit<PetPreferences, "sounds">> & {
  sounds?: Partial<Record<PetSound, { enabled?: boolean; volume?: number; source?: string }>>;
};
export interface PetSettings { preferences: PetPreferences; defaults: PetPreferences; enabled: boolean }
export interface PetWallet {
  scope: string;
  credits: number | null;
  used_today: number | null;
  usage_day: number;
  remaining: number | null;
  total: number | null;
  updated_at: number;
  stale: boolean;
  status: "ready" | "signed_out" | "unavailable" | "changed";
}
export const getPetPreferences = () => invoke<PetSettings>("pet_preferences");
export const setPetPreferences = (patch: PetPreferencesPatch) => invoke<PetPreferences>("pet_set_preferences", { patch });
export const setPetEnabled = (enabled: boolean) => invoke<void>("pet_set_enabled", { enabled });
export const getPetWallet = (force = false) => invoke<PetWallet>("pet_wallet", { force });
export const resetPetPosition = () => invoke<void>("pet_reset_position");
export const activatePet = (action: string) => invoke<void>("pet_activate", { action });
export const previewPetSound = (sound: PetSound) => invoke<void>("pet_preview_sound", { sound });
export const onPetPreferences = (cb: (v: PetSettings) => void) => listen<PetSettings>("pet-preferences", cb);

export const notifyPetAccountChanged = () => invoke<void>("pet_account_changed");
export const onPetWalletInvalidated = (cb: () => void) => {
  const offAccount = listen("pet-wallet-invalidated", cb);
  const offTransport = listen("monkeycode-transport-changed", cb);
  return () => { offAccount(); offTransport(); };
};

export interface PetAudioAsset { id: string; name: string }
export const listPetSounds = () => invoke<PetAudioAsset[]>("pet_sound_list");
export const importPetSound = (name: string, data: string) => invoke<PetAudioAsset>("pet_sound_import", { name, data });
export const removePetSound = (id: string) => invoke<void>("pet_sound_remove", { id });
export const onPetAudioError = (cb: (message: string) => void) => listen<string>("pet-audio-error", cb);
