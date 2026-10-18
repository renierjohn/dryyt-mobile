package expo.modules.facecamera

import android.content.Context
import android.graphics.Rect
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureRequest
import android.hardware.camera2.CaptureResult
import android.hardware.camera2.TotalCaptureResult
import android.net.Uri
import android.os.SystemClock
import androidx.annotation.OptIn
import androidx.camera.camera2.interop.Camera2CameraInfo
import androidx.camera.camera2.interop.Camera2Interop
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.Promise
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.io.File

/** Faces are sent to JS at most this often (ms); the camera reports them every frame. */
private const val EMIT_MS = 100L

/**
 * Front camera preview that reports the faces found by the camera's own face detection
 * (Camera2 STATISTICS_FACE_DETECT_MODE_SIMPLE), as boxes in view space normalized to 0..1.
 */
@OptIn(markerClass = [ExperimentalCamera2Interop::class])
class FaceCameraView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  override val shouldUseAndroidLayout = true

  private val onReady by EventDispatcher()
  private val onFaces by EventDispatcher()
  private val onCameraError by EventDispatcher()

  private val previewView = PreviewView(context).apply {
    implementationMode = PreviewView.ImplementationMode.COMPATIBLE
    scaleType = PreviewView.ScaleType.FILL_CENTER
    layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
  }

  private var provider: ProcessCameraProvider? = null
  private var preview: Preview? = null
  private var imageCapture: ImageCapture? = null
  private var sensorOrientation = 270
  private var activeArray = Rect()
  private var lastEmit = 0L

  init {
    addView(previewView)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    bind()
  }

  override fun onDetachedFromWindow() {
    provider?.unbindAll()
    super.onDetachedFromWindow()
  }

  private fun bind() {
    val future = ProcessCameraProvider.getInstance(context)
    future.addListener({
      try {
        val provider = future.get().also { provider = it }
        val owner = appContext.currentActivity as? LifecycleOwner ?: throw IllegalStateException("No activity for the camera")
        val manager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
        val id = manager.cameraIdList.firstOrNull {
          manager.getCameraCharacteristics(it).get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_FRONT
        } ?: throw IllegalStateException("This phone has no front camera")
        val chars = manager.getCameraCharacteristics(id)
        sensorOrientation = chars.get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 270
        activeArray = chars.get(CameraCharacteristics.SENSOR_INFO_ACTIVE_ARRAY_SIZE) ?: Rect()
        val modes = chars.get(CameraCharacteristics.STATISTICS_INFO_AVAILABLE_FACE_DETECT_MODES) ?: intArrayOf()
        val mode = when {
          CaptureRequest.STATISTICS_FACE_DETECT_MODE_SIMPLE in modes -> CaptureRequest.STATISTICS_FACE_DETECT_MODE_SIMPLE
          CaptureRequest.STATISTICS_FACE_DETECT_MODE_FULL in modes -> CaptureRequest.STATISTICS_FACE_DETECT_MODE_FULL
          else -> CaptureRequest.STATISTICS_FACE_DETECT_MODE_OFF
        }

        val ratio = ResolutionSelector.Builder()
          .setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY)
          .build()
        val previewBuilder = Preview.Builder().setResolutionSelector(ratio)
        if (mode != CaptureRequest.STATISTICS_FACE_DETECT_MODE_OFF) {
          Camera2Interop.Extender(previewBuilder)
            .setCaptureRequestOption(CaptureRequest.STATISTICS_FACE_DETECT_MODE, mode)
            .setSessionCaptureCallback(object : CameraCaptureSession.CaptureCallback() {
              override fun onCaptureCompleted(session: CameraCaptureSession, request: CaptureRequest, result: TotalCaptureResult) {
                onResult(result)
              }
            })
        }
        val preview = previewBuilder.build().also {
          it.setSurfaceProvider(previewView.surfaceProvider)
          preview = it
        }
        val capture = ImageCapture.Builder()
          .setResolutionSelector(ratio)
          .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
          .setJpegQuality(85)
          .build()
          .also { imageCapture = it }
        val selector = CameraSelector.Builder()
          .addCameraFilter { infos -> infos.filter { Camera2CameraInfo.from(it).cameraId == id } }
          .build()

        provider.unbindAll()
        provider.bindToLifecycle(owner, selector, preview, capture)
        onReady(mapOf("faceDetection" to (mode != CaptureRequest.STATISTICS_FACE_DETECT_MODE_OFF)))
      } catch (e: Exception) {
        onCameraError(mapOf("message" to (e.message ?: "The camera failed to start")))
      }
    }, ContextCompat.getMainExecutor(context))
  }

  /** Runs on the camera thread for every frame. */
  private fun onResult(result: TotalCaptureResult) {
    val faces = result.get(CaptureResult.STATISTICS_FACES) ?: return
    val now = SystemClock.uptimeMillis()
    if (now - lastEmit < EMIT_MS) return
    lastEmit = now
    val crop = result.get(CaptureResult.SCALER_CROP_REGION) ?: activeArray
    post {
      val boxes = faces.mapNotNull { toView(it.bounds, crop) }
      onFaces(mapOf("faces" to boxes))
    }
  }

  /** Maps a face from sensor coordinates to the mirrored, rotated and cropped preview, normalized to the view. */
  private fun toView(face: Rect, crop: Rect): Map<String, Float>? {
    val stream = preview?.resolutionInfo?.resolution ?: return null
    val viewW = previewView.width.toFloat()
    val viewH = previewView.height.toFloat()
    if (viewW == 0f || viewH == 0f || crop.isEmpty) return null

    // The stream is the crop region cut to the stream's aspect ratio, centered.
    val aspect = maxOf(stream.width, stream.height).toFloat() / minOf(stream.width, stream.height)
    var sx = crop.left.toFloat()
    var sy = crop.top.toFloat()
    var sw = crop.width().toFloat()
    var sh = crop.height().toFloat()
    if (sw / sh > aspect) {
      val w = sh * aspect
      sx += (sw - w) / 2
      sw = w
    } else {
      val h = sw / aspect
      sy += (sh - h) / 2
      sh = h
    }

    // Rotate to the upright frame, then mirror like the front camera preview.
    val corners = listOf(face.left to face.top, face.right to face.bottom).map { (x, y) ->
      val nx = (x - sx) / sw
      val ny = (y - sy) / sh
      val (u, v) = when (sensorOrientation) {
        90 -> (1 - ny) to nx
        180 -> (1 - nx) to (1 - ny)
        270 -> ny to (1 - nx)
        else -> nx to ny
      }
      (1 - u) to v
    }

    // PreviewView FILL_CENTER: scale the upright frame to cover the view, centered.
    val sideways = sensorOrientation % 180 != 0
    val frameW = if (sideways) 1f else aspect
    val frameH = if (sideways) aspect else 1f
    val scale = maxOf(viewW / frameW, viewH / frameH)
    val shownW = frameW * scale
    val shownH = frameH * scale
    val offX = (viewW - shownW) / 2
    val offY = (viewH - shownH) / 2

    val xs = corners.map { (offX + it.first * shownW) / viewW }
    val ys = corners.map { (offY + it.second * shownH) / viewH }
    return mapOf(
      "x" to xs.min(),
      "y" to ys.min(),
      "width" to xs.max() - xs.min(),
      "height" to ys.max() - ys.min(),
    )
  }

  fun takePhoto(promise: Promise) {
    val capture = imageCapture ?: return promise.reject("ERR_NOT_READY", "The camera isn't ready yet", null)
    val file = File(context.cacheDir, "face-${System.currentTimeMillis()}.jpg")
    capture.takePicture(
      ImageCapture.OutputFileOptions.Builder(file).build(),
      ContextCompat.getMainExecutor(context),
      object : ImageCapture.OnImageSavedCallback {
        override fun onImageSaved(output: ImageCapture.OutputFileResults) {
          promise.resolve(Uri.fromFile(file).toString())
        }

        override fun onError(exception: ImageCaptureException) {
          promise.reject("ERR_CAPTURE", exception.message ?: "Couldn't take the photo", exception)
        }
      },
    )
  }
}
