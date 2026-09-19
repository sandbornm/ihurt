export interface Recording {
  stop(): Promise<Blob>;
  cancel(): void;
}

export async function startRecording(
  onLimit: () => void,
  maxSeconds: number,
  onError: (message: string) => void,
): Promise<Recording> {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
    throw new Error(
      "Recording is unavailable here. Use your keyboard’s microphone or type below.",
    );
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream);
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    throw error;
  }
  const chunks: BlobPart[] = [];
  let cancelled = false;
  let stopRequested = false;
  let settle: ((value: Blob) => void) | undefined;
  let fail: ((error: Error) => void) | undefined;
  let stopped: Promise<Blob> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const release = () => stream.getTracks().forEach((track) => track.stop());
  recorder.ondataavailable = (event) => {
    if (!cancelled && event.data.size) chunks.push(event.data);
  };
  recorder.onstop = () => {
    clearTimeout(timer);
    release();
    if (!cancelled) {
      if (stopRequested)
        settle?.(new Blob(chunks, { type: recorder.mimeType }));
      else onError("The microphone stopped. Try again or type below.");
    }
  };
  recorder.onerror = () => {
    clearTimeout(timer);
    release();
    cancelled = true;
    if (fail)
      fail(
        new Error("The microphone stopped. Please try again or type below."),
      );
    else onError("The microphone stopped. Try again or type below.");
  };
  try {
    recorder.start();
  } catch (error) {
    release();
    throw error;
  }
  timer = setTimeout(onLimit, maxSeconds * 1000);
  return {
    stop() {
      stopped ??= new Promise<Blob>((resolve, reject) => {
        stopRequested = true;
        settle = resolve;
        fail = reject;
        if (recorder.state === "inactive")
          reject(new Error("The recording ended before it could be read."));
        else recorder.stop();
      });
      return stopped;
    },
    cancel() {
      cancelled = true;
      clearTimeout(timer);
      chunks.length = 0;
      if (recorder.state !== "inactive") recorder.stop();
      release();
      fail?.(new DOMException("Recording cancelled", "AbortError"));
    },
  };
}

export async function toWav(blob: Blob, maxSeconds: number): Promise<Blob> {
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    const length = Math.min(
      maxSeconds * 16000,
      Math.ceil(buffer.duration * 16000),
    );
    if (!length) throw new Error("The recording was empty.");
    const offline = new OfflineAudioContext(1, length, 16000);
    const source = offline.createBufferSource();
    source.buffer = buffer;
    source.connect(offline.destination);
    source.start();
    const pcm = (await offline.startRendering()).getChannelData(0);
    const bytes = new ArrayBuffer(44 + pcm.length * 2),
      view = new DataView(bytes);
    const ascii = (offset: number, value: string) =>
      [...value].forEach((char, i) =>
        view.setUint8(offset + i, char.charCodeAt(0)),
      );
    ascii(0, "RIFF");
    view.setUint32(4, 36 + pcm.length * 2, true);
    ascii(8, "WAVE");
    ascii(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 16000, true);
    view.setUint32(28, 32000, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    ascii(36, "data");
    view.setUint32(40, pcm.length * 2, true);
    for (let i = 0; i < pcm.length; i++)
      view.setInt16(
        44 + i * 2,
        Math.max(-1, Math.min(1, pcm[i])) * 32767,
        true,
      );
    return new Blob([bytes], { type: "audio/wav" });
  } finally {
    await context.close();
  }
}
