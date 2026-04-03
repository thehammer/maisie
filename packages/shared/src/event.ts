import { z } from 'zod'
import type { ActionTier } from './action'

/**
 * A PluginEvent declares something that happens in a plugin's domain.
 * Events complement actions: actions are things you request; events are things that occur.
 *
 * Events are published to MQTT and may trigger the agent runtime.
 */
export interface PluginEvent<TPayload extends z.ZodTypeAny = z.ZodTypeAny> {
  /** Maps to MQTT topic: home/{plugin-name}/{name} unless topic is overridden. */
  name: string

  description: string

  schema: TPayload

  /** Override the auto-generated MQTT topic. Use for standard home automation topics. */
  topic?: string

  /** AI agent behavior for this event. */
  ai: {
    /**
     * ignore  — agent never wakes for this event
     * inform  — agent logs episode, may surface insight
     * advise  — agent analyzes, queues result for human review
     * act     — agent analyzes and acts autonomously within declared tier
     */
    tier: ActionTier | 'ignore'
    /** Context hint for the agent when this event fires. */
    context: string
  }

  ui: {
    /** If true, dashboard components subscribed to this event's topic re-fetch. */
    realtime: boolean
    /** If true, this event appears in the agent notification feed when fired. */
    notify: boolean
  }
}

export function defineEvent<TPayload extends z.ZodTypeAny>(
  event: PluginEvent<TPayload>
): PluginEvent<TPayload> {
  return event
}
