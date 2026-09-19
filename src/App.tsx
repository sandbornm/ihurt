import Notebook from "./Notebook";
import AIOptions from "./AIOptions";
import { isNativeApp } from "./platform/files";
import VoiceDraft, { type VoiceDraftProps } from "./voice/VoiceDraft";
import { localVoiceClient } from "./voice/client";
function LocalVoice(props: VoiceDraftProps) {
  return <VoiceDraft {...props} client={localVoiceClient} />;
}
export default function App() {
  return (
    <Notebook
      Assistant={isNativeApp() ? undefined : AIOptions}
      VoiceInput={LocalVoice}
    />
  );
}
