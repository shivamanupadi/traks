import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface Workspace {
  id: string;
  name: string;
  role: 'owner' | 'member';
  siteCount: number;
}

interface WorkspaceContextValue {
  workspaces: Workspace[];
  isLoading: boolean;
  /** The active workspace; null until the list has loaded. */
  current: Workspace | null;
  setCurrentId: (id: string) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

const STORAGE_KEY = 'traks-workspace';

export function WorkspaceProvider({ children }: { children: ReactNode }): ReactElement {
  const { data, isLoading } = useQuery({
    queryKey: ['workspaces'],
    queryFn: () => api.getWorkspaces(),
    staleTime: 60_000,
  });

  const workspaces = ((data as any)?.data ?? []) as Workspace[];

  const [storedId, setStoredId] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY));

  // A stale stored id (deleted workspace) falls back to the first workspace.
  const current = workspaces.find(w => w.id === storedId) ?? workspaces[0] ?? null;

  const setCurrentId = useCallback((id: string): void => {
    localStorage.setItem(STORAGE_KEY, id);
    setStoredId(id);
  }, []);

  return (
    <WorkspaceContext.Provider value={{ workspaces, isLoading, current, setCurrentId }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used within WorkspaceProvider');
  return ctx;
}
