'use strict';

const { SofabatonMQTT } = require('./SofabatonMQTT');
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

    this.api.on('didFinishLaunching', () => this._init());
  }

  // Called by Homebridge when it restores cached accessories from disk.
  configureAccessory(accessory) {
    this.accessories.push(accessory);
  }

  async _init() {
    const mqttClient = new SofabatonMQTT(this.log, this.config);

    try {
      await mqttClient.connect();
    } catch (err) {
      this.log.error('Failed to connect to Sofabaton X2 hub:', err.message);
      this.log.error('Check hubIP / hubMac in config, or ensure the hub is on the network.');
      return;
    }

    // Auto-discover activities from the hub; fall back to config list if provided.
    let activities = [];
    try {
      const discovered = await mqttClient.getActivities();
      activities = discovered.map((a) => a.activity_name).filter(Boolean);
      this.log.info(`Discovered ${activities.length} activities: ${activities.join(', ')}`);
    } catch (err) {
      this.log.warn(`Activity auto-discovery failed (${err.message})`);
      if (Array.isArray(this.config.activities) && this.config.activities.length > 0) {
        activities = this.config.activities;
        this.log.info(`Using ${activities.length} activities from config as fallback`);
      } else {
        this.log.error('No activities available — check hub connection or add activities to config');
        return;
      }
    }

    // Merge discovered list with config: config provides mainActivity and overrides.
    const mergedConfig = Object.assign({}, this.config, { activities });

    const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:${this.config.name || 'sofabaton'}`);
    let accessory = this.accessories.find((a) => a.UUID === uuid);

    if (!accessory) {
      this.log.info('Creating new TV accessory for Sofabaton hub');
      accessory = new this.api.platformAccessory(
        this.config.name || 'Sofabaton',
        uuid,
        this.api.hap.Categories.TELEVISION,
      );
      this.api.publishExternalAccessories(PLUGIN_NAME, [accessory]);
    }

    const tv = new SofabatonTV(this.log, mergedConfig, this.api, mqttClient);
    tv.getServices(accessory);
  }
}

module.exports = { SofabatonPlatform };
