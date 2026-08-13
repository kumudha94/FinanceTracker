const { withAndroidManifest, withDangerousMod, AndroidConfig } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const SERVICE_NAME = 'NotificationListener';
const HEADLESS_SERVICE_NAME = 'NotificationHeadlessTaskService';

function withNotificationListenerManifest(config) {
  return withAndroidManifest(config, (config) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);

    if (!application.service) application.service = [];
    if (!application.service.some((s) => s.$['android:name'] === `.${SERVICE_NAME}`)) {
      application.service.push({
        $: {
          'android:name': `.${SERVICE_NAME}`,
          'android:exported': 'true',
          'android:permission': 'android.permission.BIND_NOTIFICATION_LISTENER_SERVICE',
        },
        'intent-filter': [
          {
            action: [
              { $: { 'android:name': 'android.service.notification.NotificationListenerService' } },
            ],
          },
        ],
      });
    }

    if (!application.service.some((s) => s.$['android:name'] === `.${HEADLESS_SERVICE_NAME}`)) {
      application.service.push({
        $: {
          'android:name': `.${HEADLESS_SERVICE_NAME}`,
          'android:exported': 'false',
        },
      });
    }

    return config;
  });
}

function withNotificationListenerNativeFiles(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const packageName = config.android.package;
      const packagePath = packageName.split('.').join(path.sep);
      const javaDir = path.join(
        config.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'java',
        packagePath
      );

      fs.mkdirSync(javaDir, { recursive: true });

      const nativeSrcDir = path.join(__dirname, 'native');
      for (const fileName of ['NotificationListener.kt', 'NotificationHeadlessTaskService.kt']) {
        const source = fs.readFileSync(path.join(nativeSrcDir, fileName), 'utf8');
        const rewritten = source.replace(/^package .+$/m, `package ${packageName}`);
        fs.writeFileSync(path.join(javaDir, fileName), rewritten);
      }

      return config;
    },
  ]);
}

module.exports = function withNotificationListener(config) {
  config = withNotificationListenerManifest(config);
  config = withNotificationListenerNativeFiles(config);
  return config;
};
