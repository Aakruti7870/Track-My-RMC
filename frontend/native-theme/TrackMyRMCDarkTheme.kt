package com.trackmyrmc.theme

/**
 * TrackMyRMC native Android DARK theme palette.
 *
 * Visual source: Nearby Plants dark-glass design, October 2026.
 *
 * This file is a Kotlin companion for FUTURE native Android surfaces.
 * Expo Router / React Native Web currently render the application using
 * frontend/src/theme/tokens.ts; this file alone does not theme those screens.
 * Keep values in sync with darkColors when changing the design.
 *
 * Colours are RGB HEX, and opacity is supplied separately. Never apply
 * opacity to an entire card's view; that would also fade labels and icons.
 */
object TrackMyRMCDarkTheme {
    // Scene / surfaces
    const val canvas = "#0E1116"
    const val card = "#1A1F26"
    const val cardReferenceAlpha = 0.40f // Reference artwork: 35%-40% over blur
    const val cardFallbackAlpha = 0.78f  // No blur: opaque enough for readable text
    const val raisedCardAlpha = 0.88f
    const val cardCornerDp = 20
    const val buttonCornerDp = 12

    // Glass illumination
    const val amberEdge = "#FF9A3D"
    const val edgeAlpha = 0.28f
    const val activeEdgeAlpha = 0.46f
    const val glowAlpha = 0.15f

    // Type
    const val heading = "#FFFFFF"
    const val primaryText = "#F8FAFC"
    const val secondaryText = "#B8C1CC"

    // Brand actions
    const val orange = "#FF8A00"
    const val orangePressed = "#E67500"
    const val orangeTintAlpha = 0.18f
    const val onOrange = "#FFFFFF"

    // Source and verification chips
    const val googleMapsChip = "#2563EB"
    const val verificationPendingChip = "#64748B"
    const val chipAlpha = 0.18f
    const val verified = "#38A169" // Actual verified records only

    // Unavailable actions
    const val disabled = "#94A3B8"
    const val disabledSurfaceAlpha = 0.34f
    const val disabledLabel = "#CBD5E1"

    // Controls/accessibility
    const val minimumTouchDp = 44
    const val searchFieldMinHeightDp = 46
    const val actionMinHeightDp = 46
}
