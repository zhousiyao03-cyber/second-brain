import type {
  councilPersonas,
  councilChannels,
} from "@/server/db/schema/council";

export type Persona = typeof councilPersonas.$inferSelect;
export type Channel = typeof councilChannels.$inferSelect;

export type ScopeKind = "all" | "notes" | "bookmarks";

export type ClassifierDecision = {
  shouldSpeak: boolean;
  priority: number; // 0..1
  reason: string;
};

export type SSEEvent =
  | { type: "turn_start"; turnId: string }
  | { type: "agent_start"; turnId: string; messageId: string; personaId: string }
  | { type: "agent_delta"; messageId: string; delta: string }
  | { type: "agent_end"; messageId: string; status: "complete" | "interrupted" }
  | {
      type: "stopped";
      reason:
        | "hard_limit"
        | "consecutive_no"
        | "user_interrupt"
        | "user_stop"
        | "error";
    }
  | { type: "error"; message: string };
