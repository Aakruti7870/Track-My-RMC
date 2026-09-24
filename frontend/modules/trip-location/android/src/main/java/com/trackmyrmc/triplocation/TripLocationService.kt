package com.trackmyrmc.triplocation

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.os.Build
import android.os.IBinder
import android.os.Looper
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class TripLocationService : Service() {
  companion object {
    const val ACTION_START = "com.trackmyrmc.triplocation.START"
    private const val NOTIFICATION_CHANNEL_ID = "tmrmc_trip_location"
    private const val NOTIFICATION_ID = 7401
    private const val UPDATE_INTERVAL_MS = 15_000L
    private const val MIN_DISTANCE_METERS = 25f
  }

  private lateinit var fusedLocationClient: FusedLocationProviderClient
  private var requestingUpdates = false
  private var deliveryExecutor: ExecutorService = Executors.newSingleThreadExecutor()

  private val locationCallback = object : LocationCallback() {
    override fun onLocationResult(result: LocationResult) {
      val location = result.lastLocation ?: return
      val payload = locationPayload(location)
      if (deliveryExecutor.isShutdown) return
      deliveryExecutor.execute {
        deliverWithQueue(payload)
      }
    }
  }

  override fun onCreate() {
    super.onCreate()
    fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (TripLocationState.snapshot(this) == null) {
      stopSelf()
      return START_NOT_STICKY
    }

    startAsForegroundService()
    startLocationUpdates()
    return START_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onDestroy() {
    stopLocationUpdates()
    deliveryExecutor.shutdownNow()
    super.onDestroy()
  }

  private fun startLocationUpdates() {
    if (requestingUpdates) return

    val fineGranted = checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
    val coarseGranted = checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
    if (!fineGranted && !coarseGranted) {
      stopSelf()
      return
    }

    val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, UPDATE_INTERVAL_MS)
      .setMinUpdateIntervalMillis(UPDATE_INTERVAL_MS)
      .setMinUpdateDistanceMeters(MIN_DISTANCE_METERS)
      .build()

    try {
      fusedLocationClient.requestLocationUpdates(request, locationCallback, Looper.getMainLooper())
      requestingUpdates = true
    } catch (_: SecurityException) {
      stopSelf()
    }
  }

  private fun stopLocationUpdates() {
    if (!requestingUpdates) return
    runCatching { fusedLocationClient.removeLocationUpdates(locationCallback) }
    requestingUpdates = false
  }

  private fun startAsForegroundService() {
    val manager = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(
        NotificationChannel(
          NOTIFICATION_CHANNEL_ID,
          "Active delivery location",
          NotificationManager.IMPORTANCE_LOW,
        ).apply {
          description = "Live mixer location while an assigned delivery is active"
          setShowBadge(false)
        },
      )
    }

    val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
    val contentIntent = launchIntent?.let {
      PendingIntent.getActivity(
        this,
        0,
        it,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }

    val notification = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      android.app.Notification.Builder(this, NOTIFICATION_CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      android.app.Notification.Builder(this)
    }
      .setSmallIcon(android.R.drawable.ic_menu_mylocation)
      .setContentTitle("TrackMyRMC delivery tracking")
      .setContentText("Mixer location is shared only while your delivery trip is active.")
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .apply {
        if (contentIntent != null) setContentIntent(contentIntent)
      }
      .build()

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION,
      )
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  private fun locationPayload(location: Location): String =
    JSONObject()
      .put("lat", location.latitude)
      .put("lng", location.longitude)
      .put("accuracy", location.accuracy.toDouble())
      .toString()

  private fun deliverWithQueue(currentPayload: String) {
    if (TripLocationState.snapshot(this) == null) return

    val queued = TripLocationState.readQueue(this)
    if (queued.isNotEmpty()) {
      val remaining = mutableListOf<String>()
      var blocked = false

      for (payload in queued) {
        if (blocked || !postPayload(payload)) {
          blocked = true
          remaining.add(payload)
        }
      }

      if (TripLocationState.snapshot(this) == null) return
      TripLocationState.writeQueue(this, remaining)

      if (blocked) {
        TripLocationState.enqueue(this, currentPayload)
        return
      }
    }

    if (!postPayload(currentPayload) && TripLocationState.snapshot(this) != null) {
      TripLocationState.enqueue(this, currentPayload)
    }
  }

  private fun postPayload(payload: String): Boolean {
    val snapshot = TripLocationState.snapshot(this) ?: return false
    val encodedTripId = URLEncoder.encode(snapshot.tripId, Charsets.UTF_8.name())
    val endpoint = "${snapshot.backendUrl}/api/driver/trips/$encodedTripId/location"

    val connection = (URL(endpoint).openConnection() as HttpURLConnection).apply {
      requestMethod = "POST"
      connectTimeout = 10_000
      readTimeout = 10_000
      doOutput = true
      setRequestProperty("Content-Type", "application/json")
      setRequestProperty("Authorization", "Bearer ${snapshot.token}")
    }

    return try {
      connection.outputStream.use { stream ->
        stream.write(payload.toByteArray(Charsets.UTF_8))
      }
      connection.responseCode in 200..299
    } catch (_: Exception) {
      false
    } finally {
      connection.disconnect()
    }
  }
}
