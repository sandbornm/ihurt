import { Capacitor, registerPlugin } from "@capacitor/core";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { configureNativeExports } from "./files";
import { configureNativeSpeech } from "./speech";
import { createAppleSpeech, type AppleSpeechBridge } from "./apple-speech";

// Only the standalone app entry imports native packages. Website consumers of
// Notebook keep the browser adapter without depending on Capacitor.
export function initializeNativeApp() {
  if (Capacitor.getPlatform() !== "ios") return;
  configureNativeSpeech(
    createAppleSpeech(registerPlugin<AppleSpeechBridge>("AppleSpeech")),
  );
  configureNativeExports({
    async write(file, path) {
      const result = await Filesystem.writeFile({
        directory: Directory.Documents,
        path,
        data: file.content,
        ...(file.base64 ? {} : { encoding: Encoding.UTF8 }),
        recursive: true,
      });
      return result.uri;
    },
    async share(uri) {
      await Share.share({ title: "iHurt report", files: [uri] });
    },
  });
}
