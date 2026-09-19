import Capacitor

class NotebookViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(AppleSpeechPlugin())
    }
}
