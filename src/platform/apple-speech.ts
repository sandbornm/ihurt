import type { NativeSpeech, SpeechAvailability } from "./speech.ts";

export interface SpeechEvent {
  session: string;
  text?: string;
  error?: string;
}
interface Listener {
  remove(): Promise<void>;
}
export interface AppleSpeechBridge {
  availability(): Promise<SpeechAvailability>;
  start(options: { session: string }): Promise<void>;
  stop(options: { session: string }): Promise<{ text: string }>;
  cancel(options: { session: string }): Promise<void>;
  addListener(
    name: "transcript" | "ended",
    callback: (event: SpeechEvent) => void,
  ): Promise<Listener>;
}
interface Session {
  id: string;
  listeners: Listener[];
  cancelled: boolean;
  ended: boolean;
  text: string;
  error?: string;
  onText: (text: string) => void;
  onEnd?: (error?: string) => void;
}

export function createAppleSpeech(bridge: AppleSpeechBridge): NativeSpeech {
  let current: Session | undefined;
  const removeListeners = async (session: Session) => {
    const listeners = session.listeners.splice(0);
    await Promise.all(
      listeners.map((listener) => listener.remove().catch(() => {})),
    );
  };
  const deliver = (session: Session, text: string) => {
    if (current !== session || session.cancelled || session.text === text)
      return;
    session.text = text;
    session.onText(text);
  };
  return {
    availability: () => bridge.availability(),
    async start(onText, onEnd) {
      if (current && !current.ended && !current.cancelled)
        throw new Error("A recording is already in progress.");
      const session: Session = {
        id: crypto.randomUUID(),
        listeners: [],
        cancelled: false,
        ended: false,
        text: "",
        onText,
        onEnd,
      };
      current = session;
      const listen = async (
        name: "transcript" | "ended",
        callback: (event: SpeechEvent) => void,
      ) => {
        const listener = await bridge.addListener(name, callback);
        if (session.cancelled || current !== session) {
          await listener.remove();
          throw new Error("Recording cancelled.");
        }
        session.listeners.push(listener);
      };
      try {
        await listen("transcript", (event) => {
          if (
            event.session === session.id &&
            !session.ended &&
            typeof event.text === "string"
          )
            deliver(session, event.text);
        });
        await listen("ended", (event) => {
          if (
            event.session !== session.id ||
            current !== session ||
            session.cancelled ||
            session.ended
          )
            return;
          session.ended = true;
          session.error = event.error;
          void removeListeners(session);
          session.onEnd?.(event.error);
        });
        if (session.cancelled || current !== session)
          throw new Error("Recording cancelled.");
        await bridge.start({ session: session.id });
      } catch (error) {
        await removeListeners(session);
        if (current === session) current = undefined;
        throw error;
      }
    },
    async stop() {
      const session = current;
      if (!session || session.cancelled) return;
      if (session.ended) {
        if (session.error) throw new Error(session.error);
        return;
      }
      try {
        const result = await bridge.stop({ session: session.id });
        // The bridge promise also carries the final text so stop never races an event.
        deliver(session, result.text);
        session.ended = true;
      } catch (error) {
        session.ended = true;
        session.error =
          error instanceof Error
            ? error.message
            : "Speech recognition stopped.";
        throw error;
      } finally {
        await removeListeners(session);
      }
    },
    async cancel() {
      const session = current;
      if (!session) return;
      session.cancelled = true;
      current = undefined;
      try {
        await bridge.cancel({ session: session.id });
      } finally {
        await removeListeners(session);
      }
    },
  };
}
