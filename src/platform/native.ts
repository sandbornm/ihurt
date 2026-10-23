import { Capacitor, registerPlugin } from "@capacitor/core";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { configureNativeExports } from "./files";
import { setDeviceLanguages, t } from "../i18n/index.ts";
import { configureNativeSpeech } from "./speech";
import { createAppleSpeech, type AppleSpeechBridge } from "./apple-speech";
import {
  configureOnDeviceAI,
  createAppleIntelligence,
  type AppleIntelligenceBridge,
} from "./on-device-ai";

// Only the standalone app entry imports native packages. Website consumers of
// Notebook keep the browser adapter without depending on Capacitor.
export function initializeNativeApp() {
  if (Capacitor.getPlatform() !== "ios") return;
  const speech = registerPlugin<AppleSpeechBridge>("AppleSpeech");
  configureNativeSpeech(createAppleSpeech(speech));
  // The Automatic language setting follows the phone's language list.
  void speech
    .languages?.()
    .then(({ languages }) => {
      if (Array.isArray(languages))
        setDeviceLanguages(
          languages.filter((tag): tag is string => typeof tag === "string"),
        );
    })
    .catch(() => {});
  configureOnDeviceAI(
    createAppleIntelligence(
      registerPlugin<AppleIntelligenceBridge>("AppleIntelligence"),
    ),
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
      await Share.share({ title: t("native.shareTitle"), files: [uri] });
    },
  });
}
