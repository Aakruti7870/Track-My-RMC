const { withAndroidManifest, withGradleProperties } = require('@expo/config-plugins');

const ANDROID_BUILD_PROPERTIES = {
  'android.minSdkVersion': '24',
  'android.compileSdkVersion': '36',
  'android.targetSdkVersion': '36',
  'android.buildToolsVersion': '36.0.0',
  'android.ndkVersion': '27.1.12297006',
};

const BLOCKED_MEDIA_PERMISSIONS = [
  'android.permission.READ_MEDIA_IMAGES',
  'android.permission.READ_MEDIA_VIDEO',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
];

const BLOCKED_MEDIA_PERMISSION_SET = new Set(BLOCKED_MEDIA_PERMISSIONS);

const OPTIONAL_HARDWARE_FEATURES = [
  'android.hardware.camera',
  'android.hardware.camera.autofocus',
  'android.hardware.camera.flash',
  'android.hardware.location',
  'android.hardware.location.gps',
  'android.hardware.location.network',
  'android.hardware.screen.portrait',
];

function upsertGradleProperty(properties, key, value) {
  const next = properties.filter(
    (entry) => !(entry && entry.type === 'property' && entry.key === key),
  );
  next.push({ type: 'property', key, value });
  return next;
}

module.exports = function withPlayStoreCompatibility(config) {
  config = withGradleProperties(config, (modConfig) => {
    let properties = Array.isArray(modConfig.modResults) ? modConfig.modResults : [];
    for (const [key, value] of Object.entries(ANDROID_BUILD_PROPERTIES)) {
      properties = upsertGradleProperty(properties, key, value);
    }
    modConfig.modResults = properties;
    return modConfig;
  });

  return withAndroidManifest(config, (modConfig) => {
    const manifest = modConfig.modResults.manifest;
    manifest.$ = manifest.$ || {};
    manifest.$['xmlns:tools'] =
      manifest.$['xmlns:tools'] || 'http://schemas.android.com/tools';

    const permissions = Array.isArray(manifest['uses-permission'])
      ? manifest['uses-permission']
      : [];

    const cleanedPermissions = permissions.filter((entry) => {
      const attrs = (entry && entry.$) || {};
      const name = attrs['android:name'];
      if (!BLOCKED_MEDIA_PERMISSION_SET.has(name)) return true;
      return attrs['tools:node'] === 'remove';
    });

    for (const name of BLOCKED_MEDIA_PERMISSIONS) {
      const hasRemovalMarker = cleanedPermissions.some((entry) => {
        const attrs = (entry && entry.$) || {};
        return attrs['android:name'] === name && attrs['tools:node'] === 'remove';
      });

      if (!hasRemovalMarker) {
        cleanedPermissions.push({
          $: {
            'android:name': name,
            'tools:node': 'remove',
          },
        });
      }
    }

    manifest['uses-permission'] = cleanedPermissions;

    const features = Array.isArray(manifest['uses-feature'])
      ? manifest['uses-feature']
      : [];

    for (const name of OPTIONAL_HARDWARE_FEATURES) {
      const existing = features.find(
        (entry) => entry && entry.$ && entry.$['android:name'] === name,
      );

      if (existing) {
        existing.$['android:required'] = 'false';
      } else {
        features.push({
          $: {
            'android:name': name,
            'android:required': 'false',
          },
        });
      }
    }

    manifest['uses-feature'] = features;
    return modConfig;
  });
};