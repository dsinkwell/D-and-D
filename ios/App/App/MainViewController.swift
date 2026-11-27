import Capacitor
import UIKit

/// The app's web view controller: registers the app's own native plugins.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(WriterPlugin())
        bridge?.registerPluginInstance(LocalWriterPlugin())
    }
}
