import assert from "node:assert/strict";
import test from "node:test";
import {
  createAppleSpeech,
  type AppleSpeechBridge,
  type SpeechEvent,
} from "../src/platform/apple-speech.ts";

function fixture() {
  const listeners = new Map<string, Set<(event: SpeechEvent) => void>>();
  const starts: string[] = [],
    cancels: string[] = [];
  let finalText = "final words";
  let startResult: Promise<void> = Promise.resolve();
  const bridge: AppleSpeechBridge = {
    async availability() {
      return { available: true };
    },
    async start({ session }) {
      starts.push(session);
      await startResult;
    },
    async stop() {
      return { text: finalText };
    },
    async cancel({ session }) {
      cancels.push(session);
    },
    async addListener(name, callback) {
      const callbacks = listeners.get(name) ?? new Set();
      listeners.set(name, callbacks);
      callbacks.add(callback);
      return {
        async remove() {
          callbacks.delete(callback);
        },
      };
    },
  };
  return {
    adapter: createAppleSpeech(bridge),
    bridge,
    starts,
    cancels,
    listeners,
    final(text: string) {
      finalText = text;
    },
    pending(promise: Promise<void>) {
      startResult = promise;
    },
    emit(
      name: string,
      event: Omit<SpeechEvent, "session"> = {},
      session = starts.at(-1)!,
    ) {
      for (const callback of listeners.get(name) ?? [])
        callback({ session, ...event });
    },
  };
}

test("Apple speech availability does not start recording", async () => {
  const f = fixture();
  assert.deepEqual(await f.adapter.availability(), { available: true });
  assert.equal(f.starts.length, 0);
  assert.equal(f.listeners.size, 0);
});

test("partial transcripts replace a session and stop delivers final words before resolving", async () => {
  const f = fixture(),
    texts: string[] = [];
  await f.adapter.start((text) => texts.push(text));
  f.emit("transcript", { text: "my" });
  f.emit("transcript", { text: "my shoulder" });
  f.emit("transcript", { text: "my shoulder" });
  f.final("my shoulder feels tight");
  await f.adapter.stop();
  assert.deepEqual(texts, ["my", "my shoulder", "my shoulder feels tight"]);
  assert.equal(f.listeners.get("transcript")?.size, 0);
  assert.equal(f.listeners.get("ended")?.size, 0);
});

test("cancel releases the native session and suppresses late text/end callbacks", async () => {
  const f = fixture(),
    events: string[] = [];
  await f.adapter.start(
    (text) => events.push(text),
    () => events.push("ended"),
  );
  const oldSession = f.starts[0];
  const delayedTranscript = [...f.listeners.get("transcript")!][0];
  const delayedEnd = [...f.listeners.get("ended")!][0];
  await f.adapter.cancel();
  delayedTranscript({ session: oldSession, text: "late" });
  delayedEnd({ session: oldSession });
  await f.adapter.start((text) => events.push(text));
  delayedTranscript({ session: oldSession, text: "old recording" });
  f.emit("transcript", { text: "new recording" });
  assert.deepEqual(f.cancels, [oldSession]);
  assert.deepEqual(events, ["new recording"]);
  await f.adapter.cancel();
});

test("automatic completion keeps final text and signals the review UI once", async () => {
  const f = fixture(),
    events: string[] = [];
  await f.adapter.start(
    (text) => events.push(text),
    (error) => events.push(error ?? "ended"),
  );
  f.emit("transcript", { text: "final words" });
  f.emit("ended");
  f.emit("ended");
  await f.adapter.stop();
  assert.deepEqual(events, ["final words", "ended"]);
  await f.adapter.start(() => {});
  await f.adapter.cancel();
});

test("native errors reach the UI and remain errors when stop follows the event", async () => {
  const f = fixture(),
    endings: (string | undefined)[] = [];
  await f.adapter.start(
    () => {},
    (error) => endings.push(error),
  );
  f.emit("ended", { error: "Recording interrupted" });
  await assert.rejects(f.adapter.stop(), /Recording interrupted/);
  assert.deepEqual(endings, ["Recording interrupted"]);
});

test("permission-time cancellation cannot deliver late callbacks or affect the next recording", async () => {
  const f = fixture(),
    texts: string[] = [];
  let rejectStart!: (reason: Error) => void;
  f.pending(
    new Promise((_, reject) => {
      rejectStart = reject;
    }),
  );
  const started = f.adapter.start((text) => texts.push(text));
  await new Promise((resolve) => setImmediate(resolve));
  const firstSession = f.starts[0];
  await f.adapter.cancel();
  rejectStart(new Error("Recording cancelled"));
  await assert.rejects(started, /cancelled/);
  f.pending(Promise.resolve());
  await f.adapter.start((text) => texts.push(text));
  f.emit("transcript", { text: "old words" }, firstSession);
  f.emit("transcript", { text: "new words" });
  assert.deepEqual(texts, ["new words"]);
  await f.adapter.cancel();
});

test("native start failure removes listeners and permits a retry", async () => {
  const f = fixture();
  f.bridge.start = async () => {
    throw new Error("Microphone permission was not granted.");
  };
  await assert.rejects(
    f.adapter.start(() => {}),
    /permission/,
  );
  assert.equal(f.listeners.get("transcript")?.size, 0);
  assert.equal(f.listeners.get("ended")?.size, 0);
  f.bridge.start = async () => {};
  await f.adapter.start(() => {});
  await f.adapter.cancel();
});
