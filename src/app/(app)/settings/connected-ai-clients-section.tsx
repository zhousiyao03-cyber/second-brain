import { revokeConnectedAiClient } from "./connected-ai-clients-actions";

type ConnectedAiClientRow = {
  id: string;
  tokenType: "access" | "refresh";
  clientId: string;
  tokenPreview: string;
  scopes: string;
  createdAt: Date | null;
  revokedAt: Date | null;
};

function formatDate(value: Date | null) {
  return value ? value.toLocaleString("en-SG") : "Unknown";
}

export function ConnectedAiClientsSection(props: {
  connections: ConnectedAiClientRow[];
  schemaAvailable: boolean;
  statusMessage: string | null;
}) {
  return (
    <section className="rounded-[28px] border border-stone-200 bg-white/92 p-6 shadow-[0_22px_80px_-58px_rgba(15,23,42,0.55)] dark:border-stone-800 dark:bg-stone-950/88">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
          Connected AI Clients
        </h2>
        <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
          Review and revoke Claude connector or CLI credentials that can read from Knosi or save into your AI Inbox.
        </p>
      </div>

      {props.statusMessage ? (
        <p className="mb-4 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200">
          {props.statusMessage}
        </p>
      ) : null}

      {!props.schemaAvailable ? (
        <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200">
          OAuth integration tables are not available in this environment yet. Run the latest schema rollout before managing AI clients here.
        </div>
      ) : props.connections.length === 0 ? (
        <div className="rounded-xl border border-dashed border-stone-300 px-4 py-4 text-sm text-stone-500 dark:border-stone-700 dark:text-stone-400">
          No AI clients connected yet.
        </div>
      ) : (
        <div className="space-y-3">
          {props.connections.map((connection) => (
            <div
              key={`${connection.tokenType}-${connection.id}`}
              className="rounded-2xl border border-stone-200 px-4 py-4 dark:border-stone-800"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                  <div className="text-sm font-medium text-stone-900 dark:text-stone-100">
                    {connection.clientId}
                  </div>
                  <div className="text-xs uppercase tracking-[0.18em] text-stone-400 dark:text-stone-500">
                    {connection.tokenType} token · …{connection.tokenPreview}
                  </div>
                  <div className="text-sm text-stone-500 dark:text-stone-400">
                    Scopes: {connection.scopes}
                  </div>
                  <div className="text-sm text-stone-500 dark:text-stone-400">
                    Created: {formatDate(connection.createdAt)}
                  </div>
                  <div className="text-sm text-stone-500 dark:text-stone-400">
                    {connection.revokedAt
                      ? `Revoked: ${formatDate(connection.revokedAt)}`
                      : "Status: Active"}
                  </div>
                </div>

                {!connection.revokedAt ? (
                  <form action={revokeConnectedAiClient}>
                    <input type="hidden" name="tokenId" value={connection.id} />
                    <input type="hidden" name="tokenType" value={connection.tokenType} />
                    <button
                      type="submit"
                      className="rounded-xl border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800"
                    >
                      Revoke
                    </button>
                  </form>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
