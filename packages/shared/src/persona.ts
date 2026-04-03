import type { ActionTier } from './action'

export interface AgentPersona {
  name: string
  /** One-line role description. Example: "Network & infrastructure specialist" */
  role: string
  /** Emoji or icon identifier. */
  avatar?: string
  /** Default autonomy tier when an event doesn't specify one. */
  defaultTier: ActionTier
  /**
   * MQTT topic patterns this persona monitors.
   * Supports MQTT wildcards: + (single level), # (multi level).
   * Events matching these patterns are routed to this persona.
   */
  eventSubscriptions: string[]
  /**
   * Names of actions (from the plugin's actions array) this persona can use.
   * Empty array means the persona can use all of this plugin's actions.
   */
  toolScopes: string[]
  /**
   * The system prompt. Write as if briefing a specialist on their role.
   * Include: domain knowledge, tools available, judgment criteria, communication style.
   * Target: 200-400 words.
   */
  systemPrompt: string
}
