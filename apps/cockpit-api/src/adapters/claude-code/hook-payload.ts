// Shapes Claude Code POSTs to its hook URLs. Conservative typing — any field
// could go missing across versions. We extract what we need and keep the
// raw payload on cockpit_events for forensics.

export type ClaudeCodeHookKind =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'Notification'
  | 'Stop'
  | 'SubagentStop';

export interface ClaudeCodeHookEnvelope {
  hook_event_name?: ClaudeCodeHookKind;
  session_id?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: { exit_code?: number; output?: string } & Record<string, unknown>;
  // PostToolUseFailure carries an `error` string instead of tool_response.
  error?: string;
  is_interrupt?: boolean;
  message?: string; // Notification hook
  cwd?: string;
  // The cockpit injects this via env var so the hook script can tag the POST.
  cockpit_session_id?: string;
}

export function extractCommand(toolInput: Record<string, unknown> | undefined): string | undefined {
  if (!toolInput) return undefined;
  const c = toolInput.command ?? toolInput.cmd ?? toolInput.bash;
  return typeof c === 'string' ? c : undefined;
}

export function extractFilePath(
  toolInput: Record<string, unknown> | undefined,
): string | undefined {
  if (!toolInput) return undefined;
  const f = toolInput.file_path ?? toolInput.path ?? toolInput.notebook_path;
  return typeof f === 'string' ? f : undefined;
}
