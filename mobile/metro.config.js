// 扩展 Expo 默认 Metro 配置
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// SDK 56 起 Metro 不再隐式 shim Node 内置模块。markdown-it（react-native-markdown-display
// 依赖）会 import 'punycode'，这里显式指向 userland 的 punycode 包。
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  punycode: require.resolve('punycode/'),
};

module.exports = config;
