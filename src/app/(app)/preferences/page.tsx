import { PreferencesTable } from "./preferences-table";

export default function PreferencesPage() {
  return (
    <main className="p-6 max-w-5xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Agent Preferences</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Cross-agent constraints. All connected agents (Claude Code, Hermes,
          Web) read this list at session start. Single source of truth.
        </p>
      </header>
      <PreferencesTable />
    </main>
  );
}
