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

    if (!config.mac) {
      this.log.error('homebridge-sofabaton: "mac" (hub MAC address) is required in config');
      return;
    }

    if (!config.host) {
      this.log.error('homebridge-sofabaton: "host" (MQTT broker IP) is required in config');
      return;
    }

    this.api.on('didFinishLaunching', () => this._init());
  }

  configureAccessory(accessory) {
    this.accessories.push(accessory);
  }

  async _init() {
    const mqttClient = new SofabatonMQTT(this.log, this.config);

    try {
      await mqttClient.connect();
    } catch (err) {
      this.log.error('Failed to connect to MQTT broker:', err.message);
      this.log.error('Ensure your MQTT broker is running and "host" is correct in config.');
      return;
    }

    // Fetch activity list from the hub
    let activities;
    try {
      activities = await mqttClient.getActivities();
      this.log.info(`Discovered ${activities.length} activities: ${activities.map((a) => a.activity_name).join(', ')}`);
    } catch (err) {
      this.log.error('Failed to fetch activity list:', err.message);
      this.log.error('Check that the hub MAC address is correct and the hub is online.');
      return;
    }

    // Create or restore the TV accessory
    const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:${this.config.mac}`);
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

    const tv = new SofabatonTV(this.log, this.config, this.api, mqttClient);
    tv.setupWithActivities(accessory, activities);
  }
}

module.exports = { SofabatonPlatform };
