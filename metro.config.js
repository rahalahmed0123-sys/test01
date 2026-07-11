const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Block Metro from watching non-existent temp dirs created by @react-native-cookies/cookies
const escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
config.resolver.blockList = [
  new RegExp(escapeRegExp('/@react-native-cookies/cookies_tmp')),
];

module.exports = config;
