package com.trackmyrmc.theme

/**
 * TrackMyRMC light-mode design contract.
 *
 * Expo React Native / web renders src/theme/tokens.ts at runtime.
 * This portable Kotlin contract is for future native Android surfaces.
 * Adding this file does NOT register a Kotlin Android module or change Expo UI.
 *
 * Reference: light-theme colour-chart screenshot supplied 2026-10-18.
 */
object TrackMyRmcLightTheme {
    const val CARD_BACKGROUND = "#FFFFFF"
    const val CARD_BORDER = "#FFE2C7"
    const val TITLE_TEXT = "#1F2937"
    const val SECONDARY_TEXT = "#4B5563"
    const val DISTANCE_CHIP = "#FFF3E0"
    const val GOOGLE_MAPS_CHIP = "#E0F0FF"
    const val VERIFICATION_CHIP = "#E8F5E9"
    const val PRIMARY_BUTTON = "#FF8A00"
    const val BUTTON_BORDER = "#FFA94D"
    const val DISABLED_BUTTON = "#E2E8F0"

    // Background wallpaper opacity is independent from the glass card alpha.
    const val WALLPAPER_OPACITY = 0.35f
    const val GLASS_CARD_OPACITY = 0.86f

    // Additional accessibility and interaction colours, derived from the design.
    const val PRIMARY_BUTTON_TEXT = TITLE_TEXT
    const val PRESSED_BUTTON = "#D97706"
    const val OUTLINE_BUTTON_TEXT = "#92400E"
    const val GOOGLE_MAPS_TEXT = "#1565C0"
    const val VERIFIED_TEXT = "#276749"

    /**
     * Converts a six-digit CSS-style hex colour into a signed Android ARGB Int,
     * with configurable opacity. Does not require android.graphics.Color.
     */
    fun toArgb(hex: String, opacity: Float = 1f): Int {
        require(Regex("^#[0-9A-Fa-f]{6}$").matches(hex)) { "Expected #RRGGBB" }
        require(opacity in 0f..1f) { "Opacity must be between 0 and 1" }
        val rgb = hex.substring(1).toLong(16).toInt()
        val alpha = (opacity * 255f + 0.5f).toInt()
        return (alpha shl 24) or rgb
    }
}
