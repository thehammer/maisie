import { TOPICS } from "@maisie/shared";
import type { BridgeCommand, BridgeMessage, BridgeParticipant, BridgeResult, BridgeStatus } from "@maisie/shared";

type PublishFn = (topic: string, payload: Record<string, unknown>) => void;

export class BridgeService {
  private messages: BridgeMessage[] = [];
  private publishFn: PublishFn | null;

  constructor(publishFn?: PublishFn) {
    this.publishFn = publishFn ?? null;
  }

  send(from: BridgeParticipant, content: string, opts?: { command?: BridgeCommand; result?: BridgeResult }): BridgeMessage {
    const msg: BridgeMessage = {
      id: crypto.randomUUID(),
      from,
      content,
      timestamp: new Date().toISOString(),
      ...(opts?.command && { command: opts.command }),
      ...(opts?.result && { result: opts.result }),
    };
    this.messages.push(msg);
    this.publishFn?.(TOPICS.bridge.message, msg as unknown as Record<string, unknown>);
    return msg;
  }

  getMessages(since?: string): BridgeMessage[] {
    if (!since) return [...this.messages];
    const sinceTime = new Date(since).getTime();
    return this.messages.filter((m) => new Date(m.timestamp).getTime() > sinceTime);
  }

  getStatus(): BridgeStatus {
    return {
      messageCount: this.messages.length,
      lastActivity:
        this.messages.length > 0
          ? this.messages[this.messages.length - 1].timestamp
          : null,
    };
  }

  reset(): void {
    this.messages = [];
  }
}
