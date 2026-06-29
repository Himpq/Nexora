const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// react-native-markdown-display -> markdown-it@10 requires the Node "punycode"
// built-in, which the React Native runtime doesn't ship. Map it to the
// userland polyfill so Metro can resolve it at bundle time.
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  punycode: require.resolve("punycode/"),
};

module.exports = config;
