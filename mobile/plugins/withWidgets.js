const { withAndroidManifest, withDangerousMod, withAppBuildGradle, AndroidConfig } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const RECEIVERS = [
  { className: 'BalanceWidgetReceiver', infoXml: 'balance_widget_info' },
  { className: 'RecentTransactionsWidgetReceiver', infoXml: 'recent_transactions_widget_info' },
];

function withWidgetsManifest(config) {
  return withAndroidManifest(config, (config) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);

    if (!application.receiver) application.receiver = [];

    for (const { className, infoXml } of RECEIVERS) {
      const name = `.widgets.${className}`;
      if (!application.receiver.some((r) => r.$['android:name'] === name)) {
        application.receiver.push({
          $: {
            'android:name': name,
            'android:exported': 'false',
          },
          'intent-filter': [
            {
              action: [{ $: { 'android:name': 'android.appwidget.action.APPWIDGET_UPDATE' } }],
            },
          ],
          'meta-data': [
            {
              $: {
                'android:name': 'android.appwidget.provider',
                'android:resource': `@xml/${infoXml}`,
              },
            },
          ],
        });
      }
    }

    return config;
  });
}

function withWidgetsNativeFiles(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const packageName = config.android.package;
      const packagePath = packageName.split('.').join(path.sep);
      const javaDir = path.join(
        config.modRequest.platformProjectRoot,
        'app', 'src', 'main', 'java', packagePath, 'widgets'
      );
      fs.mkdirSync(javaDir, { recursive: true });

      const apiBaseUrl = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:5000';

      const nativeSrcDir = path.join(__dirname, 'native', 'widgets');
      const kotlinFiles = ['WidgetRepository.kt', 'WidgetUpdateWorker.kt', 'BalanceWidget.kt', 'RecentTransactionsWidget.kt'];
      for (const fileName of kotlinFiles) {
        let source = fs.readFileSync(path.join(nativeSrcDir, fileName), 'utf8');
        source = source
          .replace(/__PACKAGE__/g, packageName)
          .replace(/__API_BASE_URL__/g, apiBaseUrl)
          .replace(/__DEEP_LINK_SCHEME__/g, packageName);
        fs.writeFileSync(path.join(javaDir, fileName), source);
      }

      const resXmlDir = path.join(config.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml');
      fs.mkdirSync(resXmlDir, { recursive: true });
      const resSrcDir = path.join(nativeSrcDir, 'res-xml');
      for (const fileName of ['balance_widget_info.xml', 'recent_transactions_widget_info.xml']) {
        fs.copyFileSync(path.join(resSrcDir, fileName), path.join(resXmlDir, fileName));
      }

      return config;
    },
  ]);
}

function withWidgetsAppBuildGradle(config) {
  return withAppBuildGradle(config, (config) => {
    if (!config.modResults.contents.includes('androidx.glance:glance-appwidget')) {
      config.modResults.contents = config.modResults.contents.replace(
        /dependencies\s*\{/,
        `dependencies {\n    implementation("androidx.glance:glance-appwidget:1.0.0")\n    implementation("androidx.work:work-runtime-ktx:2.9.0")\n    implementation("com.squareup.okhttp3:okhttp:4.12.0")`
      );
    }

    if (!config.modResults.contents.includes('buildFeatures')) {
      config.modResults.contents = config.modResults.contents.replace(
        /android\s*\{/,
        `android {\n    buildFeatures {\n        compose true\n    }\n    composeOptions {\n        kotlinCompilerExtensionVersion "1.4.3"\n    }`
      );
    }

    return config;
  });
}

module.exports = function withWidgets(config) {
  config = withWidgetsManifest(config);
  config = withWidgetsNativeFiles(config);
  config = withWidgetsAppBuildGradle(config);
  return config;
};
