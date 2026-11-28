import Capacitor

class NotebookViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(AppleSpeechPlugin())
        bridge?.registerPluginInstance(AppleIntelligencePlugin())
        bridge?.registerPluginInstance(AppleSignInPlugin())
    }
}
