const { withAndroidManifest, withDangerousMod, AndroidConfig } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const RECEIVER_NAME = 'SmsReceiver';
const SERVICE_NAME = 'SmsHeadlessTaskService';

function withSmsReceiverManifest(config) {
  return withAndroidManifest(config, (config) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);

    if (!application.receiver) application.receiver = [];
    if (!application.receiver.some((r) => r.$['android:name'] === `.${RECEIVER_NAME}`)) {
      application.receiver.push({
        $: {
          'android:name': `.${RECEIVER_NAME}`,
          'android:exported': 'true',
          'android:permission': 'android.permission.BROADCAST_SMS',
        },
        'intent-filter': [
          {
            action: [
              { $: { 'android:name': 'android.provider.Telephony.SMS_RECEIVED' } },
            ],
          },
        ],
      });
    }

    if (!application.service) application.service = [];
    if (!application.service.some((s) => s.$['android:name'] === `.${SERVICE_NAME}`)) {
      application.service.push({
        $: {
          'android:name': `.${SERVICE_NAME}`,
          'android:exported': 'false',
        },
      });
    }

    return config;
  });
}

function withSmsReceiverNativeFiles(config) {
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
      for (const fileName of ['SmsReceiver.kt', 'SmsHeadlessTaskService.kt']) {
        const source = fs.readFileSync(path.join(nativeSrcDir, fileName), 'utf8');
        const rewritten = source.replace(/^package .+$/m, `package ${packageName}`);
        fs.writeFileSync(path.join(javaDir, fileName), rewritten);
      }

      return config;
    },
  ]);
}

module.exports = function withSmsReceiver(config) {
  config = withSmsReceiverManifest(config);
  config = withSmsReceiverNativeFiles(config);
  return config;
};
