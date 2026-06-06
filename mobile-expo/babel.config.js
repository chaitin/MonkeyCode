module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Reanimated 4：worklets 插件已从 reanimated 拆出，需放在插件列表最后
      'react-native-worklets/plugin',
    ],
  };
};
