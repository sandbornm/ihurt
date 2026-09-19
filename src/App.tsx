import Notebook from "./Notebook";
import AIOptions from "./AIOptions";
import { isNativeApp } from "./platform/files";
export default function App() {
  return <Notebook Assistant={isNativeApp() ? undefined : AIOptions} />;
}
