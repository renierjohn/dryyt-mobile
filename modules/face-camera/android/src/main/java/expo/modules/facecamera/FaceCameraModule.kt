package expo.modules.facecamera

import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class FaceCameraModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("FaceCamera")

    View(FaceCameraView::class) {
      Events("onReady", "onFaces", "onCameraError")

      AsyncFunction("takePhoto") { view: FaceCameraView, promise: Promise ->
        view.takePhoto(promise)
      }.runOnQueue(Queues.MAIN)
    }
  }
}
