module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Reanimated 4：worklets 插件已从 reanimated 拆出，需放在插件列表最后
      'react-native-worklets/plugin',
    ],
    env: {
      // jest 的 node 环境不认原生 import()（math.ts 懒加载 MathJax 用），
      // 仅测试时降级成 CJS；Metro 打包不走这个分支。
      test: {
        plugins: ['@babel/plugin-transform-dynamic-import'],
      },
    },
  };
};
