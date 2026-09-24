module.exports = ({ config }) => {
  const googleMapsAndroidKey = (process.env.GOOGLE_MAPS_ANDROID_KEY || "").trim();

  const android = {
    ...(config.android || {}),
    adaptiveIcon: {
      ...((config.android && config.android.adaptiveIcon) || {}),
      backgroundColor: "#FFFFFF",
    },
  };

  if (googleMapsAndroidKey) {
    android.config = {
      ...(android.config || {}),
      googleMaps: {
        ...((android.config && android.config.googleMaps) || {}),
        apiKey: googleMapsAndroidKey,
      },
    };
  }

  return {
    ...config,
    android,
    extra: {
      ...(config.extra || {}),
      googleMapsAndroidConfigured: Boolean(googleMapsAndroidKey),
    },
  };
};
