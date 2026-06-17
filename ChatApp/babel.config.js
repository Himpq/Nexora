module.exports = function (api) {
  api.cache(true);
  return {
    // babel-preset-expo (SDK 55) auto-adds react-native-worklets/plugin when the
    // package is present, which is what Reanimated 4 needs. No manual plugin entry
    // is required — adding one would register the worklets plugin twice.
    presets: ["babel-preset-expo"],
  };
};
