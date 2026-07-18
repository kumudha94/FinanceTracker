import { AppRegistry } from 'react-native';
import registerRootComponent from 'expo/build/launch/registerRootComponent';

import App from './App';
import smsAutoParseTask from './src/tasks/smsHeadlessTask';

AppRegistry.registerHeadlessTask('SmsAutoParseTask', () => smsAutoParseTask);

registerRootComponent(App);
