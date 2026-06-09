'use strict';

const { REMOTE_KEY_COMMANDS, VOLUME_COMMANDS } = require('./SofabatonConst');

class SofabatonTV {
  constructor(log, config, api, sofabatonAPI) {
    this.log = log;
    this.config = config;
    this.api = sofabatonAPI;
    this.sofabatonAPI = sofabatonAPI;

    this.name = config.name || 'Sofabaton';
    this.activities = config.activities || [];
    this.mainActivity = config.mainActivity || this.activities[0] || null;

    // Build override map: { REMOTE_KEY: commandString }
    this.remoteOverrides = {};
    if (Array.isArray(config.remoteOverrideCommandsList)) {
      for (const entry of config.remoteOverrideCommandsList) {
        if (entry.key && entry.command) {
          this.remoteOverrides[entry.key] = entry.command;
        }
      }
    }

    // Optimistic state — tracked locally since the cloud API has no push notifications
    this.currentActivity = null;
    this.isOn = false;

    const { Service, Characteristic } = api.hap;
    this.Service = Service;
    this.Characteristic = Characteristic;
    this.hapApi = api;
  }

  // Called by the platform to wire up all HomeKit services on the accessory.
  getServices(accessory) {
    // --- Accessory Information ---
    const infoService = accessory.getService(this.Service.AccessoryInformation)
      || accessory.addService(this.Service.AccessoryInformation);
    infoService
      .setCharacteristic(this.Characteristic.Manufacturer, 'Sofabaton')
      .setCharacteristic(this.Characteristic.Model, 'X2')
      .setCharacteristic(this.Characteristic.SerialNumber, this.config.nodeId || 'Unknown');

    // --- Television ---
    this.tvService = accessory.getService(this.Service.Television)
      || accessory.addService(this.Service.Television, this.name, 'television');

    this.tvService.setCharacteristic(this.Characteristic.ConfiguredName, this.name);
    this.tvService.setCharacteristic(
      this.Characteristic.SleepDiscoveryMode,
      this.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE,
    );

    this.tvService.getCharacteristic(this.Characteristic.Active)
      .onGet(() => this.isOn
        ? this.Characteristic.Active.ACTIVE
        : this.Characteristic.Active.INACTIVE)
      .onSet((value) => this._handleActiveSet(value));

    this.tvService.getCharacteristic(this.Characteristic.ActiveIdentifier)
      .onGet(() => this._getActiveIdentifier())
      .onSet((value) => this._handleInputSet(value));

    this.tvService.getCharacteristic(this.Characteristic.RemoteKey)
      .onSet((value) => this._handleRemoteKey(value));

    // --- Speaker (volume) ---
    this.speakerService = accessory.getService(this.Service.TelevisionSpeaker)
      || accessory.addService(this.Service.TelevisionSpeaker, `${this.name} Speaker`, 'speaker');

    this.speakerService
      .setCharacteristic(this.Characteristic.Active, this.Characteristic.Active.ACTIVE)
      .setCharacteristic(
        this.Characteristic.VolumeControlType,
        this.Characteristic.VolumeControlType.RELATIVE,
      );

    this.speakerService.getCharacteristic(this.Characteristic.VolumeSelector)
      .onSet((value) => {
        const cmd = value === this.Characteristic.VolumeSelector.INCREMENT
          ? VOLUME_COMMANDS.UP
          : VOLUME_COMMANDS.DOWN;
        this.log.info(`Volume: ${cmd}`);
        // Volume commands are not supported by the Sofabaton cloud API —
        // they require a local connection. Log for now.
        this.log.warn('Volume control is not supported by the Sofabaton cloud API');
      });

    this.speakerService.getCharacteristic(this.Characteristic.Mute)
      .onGet(() => false)
      .onSet(() => {
        this.log.warn('Mute is not supported by the Sofabaton cloud API');
      });

    this.tvService.addLinkedService(this.speakerService);

    // --- InputSource (one per activity) ---
    this.inputServices = [];
    this.activities.forEach((activityName, index) => {
      const inputService = accessory.getService(`input_${index}`)
        || accessory.addService(this.Service.InputSource, activityName, `input_${index}`);

      inputService
        .setCharacteristic(this.Characteristic.Identifier, index)
        .setCharacteristic(this.Characteristic.ConfiguredName, activityName)
        .setCharacteristic(this.Characteristic.IsConfigured, this.Characteristic.IsConfigured.CONFIGURED)
        .setCharacteristic(this.Characteristic.InputSourceType, this.Characteristic.InputSourceType.APPLICATION)
        .setCharacteristic(this.Characteristic.CurrentVisibilityState, this.Characteristic.CurrentVisibilityState.SHOWN);

      this.tvService.addLinkedService(inputService);
      this.inputServices.push(inputService);
    });
  }

  _getActiveIdentifier() {
    if (!this.currentActivity) return 0;
    const idx = this.activities.indexOf(this.currentActivity);
    return idx >= 0 ? idx : 0;
  }

  async _handleActiveSet(value) {
    if (value === this.Characteristic.Active.ACTIVE) {
      const activity = this.mainActivity;
      if (!activity) {
        this.log.warn('No mainActivity configured — cannot power on');
        return;
      }
      this.log.info(`Power ON → activating "${activity}"`);
      await this.sofabatonAPI.activateActivity(activity);
      this.currentActivity = activity;
      this.isOn = true;
      const idx = this.activities.indexOf(activity);
      if (idx >= 0) {
        this.tvService.updateCharacteristic(this.Characteristic.ActiveIdentifier, idx);
      }
    } else {
      if (this.currentActivity) {
        this.log.info(`Power OFF → deactivating "${this.currentActivity}"`);
        await this.sofabatonAPI.deactivateActivity(this.currentActivity);
      }
      this.currentActivity = null;
      this.isOn = false;
    }
  }

  async _handleInputSet(index) {
    const activity = this.activities[index];
    if (!activity) {
      this.log.warn(`No activity at index ${index}`);
      return;
    }
    this.log.info(`Switching to activity: "${activity}"`);

    // Turn off the current activity first if one is running
    if (this.currentActivity && this.currentActivity !== activity) {
      await this.sofabatonAPI.deactivateActivity(this.currentActivity);
    }

    await this.sofabatonAPI.activateActivity(activity);
    this.currentActivity = activity;
    this.isOn = true;

    this.tvService.updateCharacteristic(this.Characteristic.Active, this.Characteristic.Active.ACTIVE);
  }

  _handleRemoteKey(key) {
    const { RemoteKey } = this.Characteristic;
    const keyName = Object.keys(RemoteKey).find((k) => RemoteKey[k] === key);
    const command = this.remoteOverrides[keyName] || REMOTE_KEY_COMMANDS[keyName] || null;

    if (!command) {
      this.log.warn(`No command mapped for RemoteKey ${keyName || key}`);
      return;
    }

    // Remote key commands (cursor, back, etc.) are not supported by the cloud API.
    // This is a limitation of the Sofabaton cloud API — it only supports activity on/off.
    this.log.warn(`RemoteKey "${keyName}" → command "${command}" is not supported by the Sofabaton cloud API`);
  }
}

module.exports = { SofabatonTV };
