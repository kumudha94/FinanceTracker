const { withAndroidManifest, AndroidConfig } = require('@expo/config-plugins');

// Targeting Android 16 (API 36) turns on predictive back by default, which stops Android from
// calling onBackPressed(). React Native 0.73 only listens there, so the back button skipped
// React Navigation and closed the whole app. Opting out restores normal back-to-previous-screen.
// Remove once React Native is upgraded to a version that supports predictive back.
function withLegacyBackButton(config) {
  return withAndroidManifest(config, (config) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);
    application.$['android:enableOnBackInvokedCallback'] = 'false';
    return config;
  });
}

module.exports = withLegacyBackButton;
