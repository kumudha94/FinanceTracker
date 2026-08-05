import { AppRegistry, Platform } from 'react-native';
import registerRootComponent from 'expo/build/launch/registerRootComponent';

import App from './App';
import smsAutoParseTask from './src/tasks/smsHeadlessTask';

// react-native-web's AppRegistry has no registerHeadlessTask — calling it unconditionally
// throws at module load and blanks the whole web bundle before React ever mounts.
if (Platform.OS === 'android') {
  AppRegistry.registerHeadlessTask('SmsAutoParseTask', () => smsAutoParseTask);
}

registerRootComponent(App);
