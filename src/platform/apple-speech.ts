import type { NativeSpeech, SpeechAvailability } from "./speech.ts";
import { nativeError, nativeMessage } from "./native-messages.ts";
import { t } from "../i18n/index.ts";

export interface SpeechEvent {
  session: string;
  text?: string;
  error?: string;
  code?: string;
}
interface Listener {
  remove(): Promise<void>;
}
export interface AppleSpeechBridge {
  availability(options?: { locale?: string }): Promise<SpeechAvailability>;
  start(options: { session: string; locale?: string }): Promise<void>;
  stop(options: { session: string }): Promise<{ text: string }>;
  cancel(options: { session: string }): Promise<void>;
  languages?(): Promise<{ languages?: string[] }>;
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
  onEnd?: (error?: string, text?: string) => void;
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
    async availability(locale) {
      const state = await bridge.availability(locale ? { locale } : undefined);
      if (state.available) return state;
      return {
        ...state,
        reason: nativeMessage(state.code, state.reason) ?? state.reason,
      };
    },
    async start(onText, onEnd, locale) {
      if (current && !current.ended && !current.cancelled)
        throw new Error(t("native.already-recording"));
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
          throw new Error(t("native.cancelled"));
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
          session.error = event.error
            ? nativeMessage(event.code, event.error)
            : undefined;
          void removeListeners(session);
          session.onEnd?.(
            session.error,
            session.error ? undefined : session.text,
          );
        });
        if (session.cancelled || current !== session)
          throw new Error(t("native.cancelled"));
        await bridge.start({
          session: session.id,
          ...(locale ? { locale } : {}),
        });
      } catch (error) {
        await removeListeners(session);
        if (current === session) current = undefined;
        throw nativeError(error, t("native.speech-stopped"));
      }
    },
    async stop() {
      const session = current;
      if (!session || session.cancelled) return undefined;
      if (session.ended) {
        if (session.error) throw new Error(session.error);
        return session.text;
      }
      try {
        const result = await bridge.stop({ session: session.id });
        deliver(session, result.text);
        session.ended = true;
        return session.text;
      } catch (error) {
        session.ended = true;
        const failure = nativeError(error, t("native.speech-stopped"));
        session.error = failure.message;
        throw failure;
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
