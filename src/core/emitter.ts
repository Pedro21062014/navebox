export type EventMap = Record<string, unknown>;
export type EventListener<T> = (payload: T) => void;

export class TypedEmitter<Events extends EventMap> {
  private readonly listeners = new Map<keyof Events, Set<EventListener<Events[keyof Events]>>>();

  on<K extends keyof Events>(event: K, listener: EventListener<Events[K]>): () => void {
    const bucket = (this.listeners.get(event) ?? new Set()) as Set<EventListener<Events[K]>>;
    bucket.add(listener);
    this.listeners.set(event, bucket as Set<EventListener<Events[keyof Events]>>);
    return () => this.off(event, listener);
  }

  off<K extends keyof Events>(event: K, listener: EventListener<Events[K]>): void {
    const bucket = this.listeners.get(event) as Set<EventListener<Events[K]>> | undefined;
    bucket?.delete(listener);
    if (bucket?.size === 0) this.listeners.delete(event);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const bucket = this.listeners.get(event) as Set<EventListener<Events[K]>> | undefined;
    bucket?.forEach((listener) => listener(payload));
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }
}
