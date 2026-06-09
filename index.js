'use strict';

const { SofabatonPlatform } = require('./src/SofabatonPlatform');

const PLATFORM_NAME = 'SofabatonPlatform';
const PLUGIN_NAME = 'homebridge-sofabaton';

module.exports = (api) => {
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, SofabatonPlatform);
};
