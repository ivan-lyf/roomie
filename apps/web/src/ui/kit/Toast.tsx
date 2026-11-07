import * as RT from '@radix-ui/react-toast';
import { create } from 'zustand';

// "Sofa removed · Undo": one short message at a time, read out politely (§7).

type Toast = { id: number; message: string; action?: { label: string; run: () => void } };

type ToastState = {
  toast: Toast | undefined;
  show: (message: string, action?: Toast['action']) => void;
  dismiss: () => void;
};

let next = 1;

export const useToast = create<ToastState>()((set) => ({
  toast: undefined,
  show: (message, action) => set({ toast: { id: next++, message, action } }),
  dismiss: () => set({ toast: undefined }),
}));

export function Toaster() {
  const toast = useToast((s) => s.toast);
  const dismiss = useToast((s) => s.dismiss);
  return (
    <RT.Provider duration={6000} swipeDirection="down">
      {toast && (
        <RT.Root
          key={toast.id}
          onOpenChange={(open) => !open && dismiss()}
          className="flex animate-panel-in items-center gap-4 rounded-control bg-ink px-4 py-3 text-[15px] text-white"
        >
          <RT.Description>{toast.message}</RT.Description>
          {toast.action && (
            <RT.Action
              altText={toast.action.label}
              onClick={toast.action.run}
              className="font-semibold text-accent-tint underline underline-offset-4"
            >
              {toast.action.label}
            </RT.Action>
          )}
        </RT.Root>
      )}
      <RT.Viewport className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 outline-none" />
    </RT.Provider>
  );
}
