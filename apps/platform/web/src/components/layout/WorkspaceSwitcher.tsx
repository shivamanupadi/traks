import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, Layers, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { api } from '@/lib/api';
import { FieldError } from '@/components/ui/field-error';
import { requiredTextError } from '@traks/shared';
import { useWorkspace } from '@/lib/workspace';

export function WorkspaceSwitcher(): ReactElement | null {
  const { workspaces, current, setCurrentId } = useWorkspace();
  const [createOpen, setCreateOpen] = useState(false);

  // Only the instance owner can create workspaces (server-enforced too).
  const { data: meData } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.getMe(),
    staleTime: 5 * 60_000,
  });
  const canCreate = !!(meData as any)?.data?.isInstanceOwner;

  if (!current) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1 text-[13.5px] font-medium text-[#3D3B4F] transition-colors hover:bg-[#F2F2F0] focus:outline-none focus-visible:bg-[#F2F2F0]">
            <span className="max-w-[180px] truncate">{current.name}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[#A3A1AB]" />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="start"
          className="w-60 rounded-2xl bg-white border-none shadow-float"
        >
          <DropdownMenuLabel className="px-4 pt-3 pb-1 text-[10.5px] font-bold uppercase tracking-[0.1em] text-[#9B9590]">
            Workspaces
          </DropdownMenuLabel>
          {workspaces.map(ws => (
            <DropdownMenuItem
              key={ws.id}
              onClick={() => setCurrentId(ws.id)}
              className="flex items-center gap-3 px-4 py-2.5 cursor-pointer"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-medium text-[#3D3B4F]">
                  {ws.name}
                </span>
                <span className="block text-[11px] text-[#9B9590]">
                  {ws.siteCount} {ws.siteCount === 1 ? 'site' : 'sites'}
                </span>
              </span>
              {ws.id === current.id && <Check className="w-4 h-4 shrink-0 text-[#3D3B4F]" />}
            </DropdownMenuItem>
          ))}
          {canCreate && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setCreateOpen(true)}
                className="flex items-center gap-3 px-4 py-2.5 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                New workspace
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <CreateWorkspaceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={setCurrentId}
      />
    </>
  );
}

function CreateWorkspaceDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
}): ReactElement {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);

  const createWorkspace = useMutation({
    mutationFn: () => api.createWorkspace({ name: name.trim() }),
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      onCreated(result.data.id);
      onOpenChange(false);
      setName('');
    },
  });

  const wsNameError = requiredTextError(name, 100, 'Workspace name');
  const canCreate = !wsNameError && !createWorkspace.isPending;

  const submit = (): void => {
    setTouched(true);
    if (canCreate) createWorkspace.mutate();
  };

  const handleClose = (): void => {
    onOpenChange(false);
    setTimeout(() => {
      setName('');
      setTouched(false);
      createWorkspace.reset();
    }, 200);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent onClose={handleClose} className="max-w-md">
        <DialogHeader>
          <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center mb-3">
            <Layers className="w-5 h-5 text-foreground" strokeWidth={1.7} />
          </div>
          <DialogTitle>New workspace</DialogTitle>
          <DialogDescription>
            Workspaces group your sites. Switch between them from the header.
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <div>
            <label className="mb-2 block text-[13px] font-medium text-[#3D3B4F]">Name</label>
            <Input
              placeholder="Client projects"
              value={name}
              maxLength={100}
              aria-invalid={touched && !!wsNameError}
              onChange={e => setName(e.target.value)}
              onBlur={() => setTouched(true)}
              className="h-11 px-4 text-[14px]"
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter') submit();
              }}
            />
            <FieldError message={touched ? wsNameError : null} />
          </div>
          {createWorkspace.isError && (
            <p className="mt-3 text-[13px] text-[#e5484d]">{createWorkspace.error.message}</p>
          )}
        </DialogBody>

        <DialogFooter className="border-t border-[#e6e5ea]/50 mx-6 px-0 pb-5 pt-4">
          <Button variant="ghost" onClick={handleClose} className="rounded-xl text-[13px]">
            Cancel
          </Button>
          <Button
            onClick={submit}
            isLoading={createWorkspace.isPending}
            className="text-[13px] px-5"
          >
            Create workspace
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
