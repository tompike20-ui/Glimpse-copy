import { create } from 'zustand';
import { cloudConfigured, signIn, signOut, supabase } from './client';
import { publishProject, syncProject } from './sync';

interface CloudStore {
  configured: boolean;
  userId: string | null;
  email: string | null;
  busy: boolean;
  error: string | null;
  lastSync: number | null;

  init: () => Promise<void>;
  sendMagicLink: (email: string) => Promise<void>;
  logOut: () => Promise<void>;
  share: (projectId: string, name: string, aspect: string) => Promise<void>;
  sync: (projectId: string) => Promise<void>;
}

export const useCloud = create<CloudStore>((set, get) => ({
  configured: cloudConfigured,
  userId: null,
  email: null,
  busy: false,
  error: null,
  lastSync: null,

  async init() {
    if (!cloudConfigured) return;
    const sb = await supabase();
    const { data } = await sb.auth.getSession();
    set({
      userId: data.session?.user.id ?? null,
      email: data.session?.user.email ?? null,
    });
    sb.auth.onAuthStateChange((_e, session) => {
      set({
        userId: session?.user.id ?? null,
        email: session?.user.email ?? null,
      });
    });
  },

  async sendMagicLink(email) {
    set({ busy: true, error: null });
    try {
      await signIn(email);
    } catch (err) {
      set({ error: (err as Error).message });
    } finally {
      set({ busy: false });
    }
  },

  async logOut() {
    await signOut();
    set({ userId: null, email: null });
  },

  async share(projectId, name, aspect) {
    set({ busy: true, error: null });
    try {
      await publishProject(projectId, name, aspect);
      await syncProject(projectId);
      set({ lastSync: Date.now() });
    } catch (err) {
      set({ error: (err as Error).message });
      throw err;
    } finally {
      set({ busy: false });
    }
  },

  async sync(projectId) {
    if (!cloudConfigured || !get().userId) return;
    set({ busy: true, error: null });
    try {
      await syncProject(projectId);
      set({ lastSync: Date.now() });
    } catch (err) {
      set({ error: (err as Error).message });
    } finally {
      set({ busy: false });
    }
  },
}));
