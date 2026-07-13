import type { AlexusEvent, EventSink } from "./events.js";
export class EventBus {
  private readonly sinks = new Set<EventSink>();
  on(sink: EventSink): () => void {
    this.sinks.add(sink);
    return () => this.sinks.delete(sink);
  }
  emit(value: AlexusEvent): void {
    for (const sink of this.sinks) sink(value);
  }
}
