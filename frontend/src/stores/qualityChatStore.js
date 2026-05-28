import { create } from "zustand";

export const useQualityChatStore = create((set) => ({
  messages: [],
  draftTask: null,
  appendMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),
  setDraftTask: (draftTask) => set({ draftTask }),
  reset: () => set({ messages: [], draftTask: null }),
}));
