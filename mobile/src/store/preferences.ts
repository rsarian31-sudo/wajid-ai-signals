import { create } from "zustand";
interface PreferencesState { notificationsEnabled: boolean; setNotificationsEnabled: (enabled: boolean) => void; }
export const usePreferencesStore = create<PreferencesState>((set) => ({ notificationsEnabled: false, setNotificationsEnabled: (enabled) => set({ notificationsEnabled: enabled }) }));
