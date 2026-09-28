const { withAndroidManifest, withDangerousMod, withAppBuildGradle, withStringsXml, AndroidConfig } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const RECEIVERS = [
  {
    className: 'BalanceWidgetReceiver',
    infoXml: 'balance_widget_info',
    label: 'Bank balance',
    descriptionKey: 'balance_widget_description',
    description: 'Balance of each bank account, plus the total',
  },
  {
    className: 'RecentTransactionsWidgetReceiver',
    infoXml: 'recent_transactions_widget_info',
    label: 'Recent transactions',
    descriptionKey: 'recent_transactions_widget_description',
    description: 'Your latest 4 transactions',
  },
];

function withWidgetsManifest(config) {
  return withAndroidManifest(config, (config) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);

    if (!application.receiver) application.receiver = [];

    for (const { className, infoXml, label } of RECEIVERS) {
      const name = `.widgets.${className}`;
      const existing = application.receiver.find((r) => r.$['android:name'] === name);
      // A non-clean prebuild keeps receivers added before the label existed, so update in place.
      if (existing) existing.$['android:label'] = label;
      if (!existing) {
        application.receiver.push({
          $: {
            'android:name': name,
            'android:exported': 'false',
            'android:label': label,
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

// Widget picker descriptions must be string resources (referenced from the widget info xml).
function withWidgetsStrings(config) {
  return withStringsXml(config, (config) => {
    for (const { descriptionKey, description } of RECEIVERS) {
      config.modResults = AndroidConfig.Strings.setStringItem(
        [{ $: { name: descriptionKey }, _: description }],
        config.modResults
      );
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

      const apiBaseUrl = process.env.EXPO_PUBLIC_API_URL;
      if (!apiBaseUrl) {
        throw new Error(
          'EXPO_PUBLIC_API_URL must be set to build the widgets (mobile/plugins/withWidgets.js)'
        );
      }

      const nativeSrcDir = path.join(__dirname, 'native', 'widgets');
      const kotlinFiles = ['WidgetUi.kt', 'WidgetRepository.kt', 'WidgetUpdateWorker.kt', 'BalanceWidget.kt', 'RecentTransactionsWidget.kt'];
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

    if (!config.modResults.contents.includes('compose true')) {
      config.modResults.contents = config.modResults.contents.replace(
        /android\s*\{/,
        `android {\n    buildFeatures {\n        compose true\n    }\n    composeOptions {\n        kotlinCompilerExtensionVersion "1.4.0"\n    }`
      );
    }

    return config;
  });
}

module.exports = function withWidgets(config) {
  config = withWidgetsManifest(config);
  config = withWidgetsStrings(config);
  config = withWidgetsNativeFiles(config);
  config = withWidgetsAppBuildGradle(config);
  return config;
};
