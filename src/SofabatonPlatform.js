'use strict';

const { SofabatonAPI } = require('./SofabatonAPI');
const { SofabatonTV } = require('./SofabatonTV');

const PLATFORM_NAME = 'SofabatonPlatform';
const PLUGIN_NAME = 'homebridge-sofabaton';

class SofabatonPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.accessories = [];

    if (!config) {
      this.log.warn('homebridge-sofabaton: No config found — plugin disabled');
      return;
    }

    if (!config.nodeId) {
      this.log.error('homebridge-sofabaton: nodeId is required. Copy it from the Sofabaton app API Interface screen.');
      return;
    }

    if (!Array.isArray(config.activities) || config.activities.length === 0) {
      this.log.error('homebridge-sofabaton: At least one activity must be configured.');
      return;
    }

    this.api.on('didFinishLaunching', () => this._init());
  }

  // Called by Homebridge when it restores cached accessories from disk.
  configureAccessory(accessory) {
    this.accessories.push(accessory);
  }

  _init() {
    const sofabatonAPI = new SofabatonAPI(this.log, this.config.nodeId);

    const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:${this.config.nodeId}`);
    let accessory = this.accessories.find((a) => a.UUID === uuid);

    if (!accessory) {
      this.log.info('Creating new Sofabaton TV accessory');
      accessory = new this.api.platformAccessory(
        this.config.name || 'Sofabaton',
        uuid,
        this.api.hap.Categories.TELEVISION,
      );
      this.api.publishExternalAccessories(PLUGIN_NAME, [accessory]);
    }

    const tv = new SofabatonTV(this.log, this.config, this.api, sofabatonAPI);
    tv.getServices(accessory);

    this.log.info(`Sofabaton ready with ${this.config.activities.length} activities: ${this.config.activities.join(', ')}`);
  }
}

module.exports = { SofabatonPlatform };
