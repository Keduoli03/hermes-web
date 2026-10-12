import type { ConfigFieldSchema } from "./hermes-config-form";

/** Common controls are selected by meaning, never by an upstream inferred category. */
export const commonConfigFields: Record<string, string[]> = {
  agent: ["agent.max_turns", "agent.api_max_retries", "agent.service_tier", "agent.text_verbosity", "agent.image_input_mode", "agent.run_budget_seconds"],
  delegation: ["delegation.model", "delegation.provider", "delegation.reasoning_effort", "delegation.max_concurrent_children", "delegation.max_iterations", "delegation.child_timeout_seconds", "delegation.max_spawn_depth", "delegation.inherit_mcp_toolsets"],
  terminal: ["terminal.backend", "terminal.cwd", "terminal.timeout", "terminal.persistent_shell", "terminal.env_passthrough", "terminal.docker_image", "terminal.modal_image"],
  compression: ["compression.enabled", "compression.threshold", "compression.threshold_tokens", "compression.target_ratio", "compression.protect_last_n", "compression.protect_first_n", "compression.min_tail_user_messages", "compression.max_attempts", "compression.abort_on_summary_failure"],
};

// Enums are verified against image_routing.py and agent_init.py in Hermes itself.
export const configControlOverrides: Record<string, ConfigFieldSchema> = {
  "agent.image_input_mode": { type: "select", options: ["auto", "native", "text"] },
  "agent.text_verbosity": { type: "select", options: ["", "low", "medium", "high"] },
  "agent.run_budget_seconds": { type: "number" },
};
