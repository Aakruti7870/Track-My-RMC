package com.trackmyrmc.triplocation

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class TripLocationModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("TripLocation")

    Function("isAvailable") {
      true
    }

    AsyncFunction("getCurrentLocation") { promise: Promise ->
      val context = requireNotNull(appContext.reactContext) { "React context is unavailable" }
      val fineGranted =
        context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
      val coarseGranted =
        context.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

      if (!fineGranted && !coarseGranted) {
        promise.reject(
          "E_LOCATION_PERMISSION",
          "Foreground location permission is not granted",
          null,
        )
        return@AsyncFunction
      }

      val client = LocationServices.getFusedLocationProviderClient(context)
      val cancellation = CancellationTokenSource()

      try {
        client
          .getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, cancellation.token)
          .addOnSuccessListener { location ->
            if (location == null) {
              promise.reject(
                "E_LOCATION_UNAVAILABLE",
                "Current device location is unavailable",
                null,
              )
              return@addOnSuccessListener
            }

            promise.resolve(
              mapOf(
                "latitude" to location.latitude,
                "longitude" to location.longitude,
                "accuracy" to location.accuracy.toDouble(),
                "timestamp" to location.time.toDouble(),
              ),
            )
          }
          .addOnFailureListener { error ->
            promise.reject(
              "E_LOCATION_FAILED",
              error.message ?: "Unable to obtain current device location",
              error,
            )
          }
      } catch (error: SecurityException) {
        promise.reject(
          "E_LOCATION_PERMISSION",
          "Foreground location permission is not granted",
          error,
        )
      } catch (error: Exception) {
        promise.reject(
          "E_LOCATION_FAILED",
          error.message ?: "Unable to obtain current device location",
          error,
        )
      }
    }

    AsyncFunction("startTracking") { tripId: String, backendUrl: String, token: String ->
      val context = requireNotNull(appContext.reactContext) { "React context is unavailable" }
      TripLocationState.save(context, tripId, backendUrl, token)

      val intent = Intent(context, TripLocationService::class.java).apply {
        action = TripLocationService.ACTION_START
      }

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
      true
    }

    AsyncFunction("stopTracking") {
      val context = requireNotNull(appContext.reactContext) { "React context is unavailable" }
      TripLocationState.clear(context)
      context.stopService(Intent(context, TripLocationService::class.java))
      true
    }
  }
}
