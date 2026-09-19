import Notebook from "./Notebook";
import AIOptions from "./AIOptions";
import { isNativeApp } from "./platform/files";
import VoiceDraft from "./voice/VoiceDraft";
export default function App() {
  return (
    <Notebook
      Assistant={isNativeApp() ? undefined : AIOptions}
      VoiceInput={VoiceDraft}
    />
  );
}
