// The user is asked before these run; the CLI decides how
export interface ApprovalRequest {
  tool: string;
  args: Record<string, unknown>;
  callId: string;
}

export type ApprovalDecision = "allow" | "deny";

export type ApproveFn = (
  request: ApprovalRequest,
  signal: AbortSignal,
) => Promise<ApprovalDecision>;

// Seen by the model when the user says no
export const DECLINED_NOTE =
  "[The user declined this action when Nimbus asked for permission, so it did not run and nothing was changed. Your reply was stopped here. When the user writes next, follow what they say. Do not run this action again, and do not try to get the same result another way (a different tool, a different command or smaller steps), unless they ask for it.]";

export const SKIPPED_NOTE =
  "[Not run: the user declined an earlier action in this step, so the rest of this step was skipped.]";
