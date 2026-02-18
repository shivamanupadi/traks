import type { ReactElement } from 'react';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/portal/settings')({
  component: SettingsPage,
});

function SettingsPage(): ReactElement {
  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="text-[24px] font-bold text-[#2D3436] tracking-[-0.02em]">Settings</h1>
      <p className="mt-1 text-[14px] text-[#9B9590]">
        Account and billing settings (coming soon)
      </p>
    </main>
  );
}
