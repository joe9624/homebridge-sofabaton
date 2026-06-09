'use strict';

const { REMOTE_KEY_COMMANDS, VOLUME_COMMANDS } = require('./SofabatonConst');

class SofabatonTV {
  constructor(log, config, api, mqtt) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.mqtt = mqtt;

    this.name = config.name || 'Sofabaton';
    this.activities = config.activities || [];
    this.mainActivity = config.mainActivity || (this.activities[0] || null);

    // Build override map: { REMOTE_KEY: commandString }
    this.remoteOverrides = {};
    if (Array.isArray(config.remoteOverrideCommandsList)) {
      for (const entry of config.remoteOverrideCommandsList) {
        if (entry.key && entry.command) {
          this.remoteOverrides[entry.key] = entry.command;
        }
      }
    }

    this.currentActivity = null;
    this.isOn = false;

    const { Service, Characteristic } = api.hap;
    this.Service = Service;
    this.Characteristic = Characteristic;
  }

  // Called by the platform to get the list of services for this accessory.
  getServices(accessory) {
    const services = [];

    // --- Information service ---
    const infoService = accessory.getService(this.Service.AccessoryInformation)
      || accessory.addService(this.Service.AccessoryInformation);
    infoService
      .setCharacteristic(this.Characteristic.Manufacturer, 'Sofabaton')
      .setCharacteristic(this.Characteristic.Model, 'X2 Hub')
      .setCharacteristic(this.Characteristic.SerialNumber, this.config.hubMac || 'Unknown');
    services.push(infoService);

    // --- Television service ---
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

    services.push(this.tvService);

    // --- TelevisionSpeaker service (volume) ---
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
        this.mqtt.sendCommand(cmd);
      });

    this.speakerService.getCharacteristic(this.Characteristic.Mute)
      .onGet(() => false)
      .onSet(() => {
        this.log.info('Mute toggled');
        this.mqtt.sendCommand(VOLUME_COMMANDS.MUTE);
      });

    this.tvService.addLinkedService(this.speakerService);
    services.push(this.speakerService);

    // --- InputSource services (one per activity) ---
    this.inputServices = [];
    this.activities.forEach((activityName, index) => {
      const inputService = accessory.getService(`input_${index}`)
        || accessory.addService(this.Service.InputSource, activityName, `input_${index}`);

      inputService
        .setCharacteristic(this.Characteristic.Identifier, index)
        .setCharacteristic(this.Characteristic.ConfiguredName, activityName)
        .setCharacteristic(
          this.Characteristic.IsConfigured,
          this.Characteristic.IsConfigured.CONFIGURED,
        )
        .setCharacteristic(
          this.Characteristic.InputSourceType,
          this.Characteristic.InputSourceType.APPLICATION,
        )
        .setCharacteristic(
          this.Characteristic.CurrentVisibilityState,
          this.Characteristic.CurrentVisibilityState.SHOWN,
        );

      this.tvService.addLinkedService(inputService);
      this.inputServices.push(inputService);
      services.push(inputService);
    });

    // Listen for state updates pushed from the hub
    this.mqtt.on('activityState', (data) => this._onActivityState(data));

    return services;
  }

  _getActiveIdentifier() {
    if (!this.currentActivity) return 0;
    const idx = this.activities.indexOf(this.currentActivity);
    return idx >= 0 ? idx : 0;
  }

  _handleActiveSet(value) {
    if (value === this.Characteristic.Active.ACTIVE) {
      const activity = this.mainActivity || this.activities[0];
      if (!activity) {
        this.log.warn('No mainActivity configured — cannot power on');
        return;
      }
      this.log.info(`Power ON → activating "${activity}"`);
      this.mqtt.activateActivity(activity);
    } else {
      this.log.info('Power OFF → deactivating');
      this.mqtt.deactivate();
    }
  }

  _handleInputSet(index) {
    const activity = this.activities[index];
    if (!activity) {
      this.log.warn(`No activity at index ${index}`);
      return;
    }
    this.log.info(`Switching to activity: "${activity}"`);
    this.mqtt.activateActivity(activity);
  }

  _handleRemoteKey(key) {
    const { RemoteKey } = this.Characteristic;
    const keyName = Object.keys(RemoteKey).find((k) => RemoteKey[k] === key);
    const command = this.remoteOverrides[keyName]
      || REMOTE_KEY_COMMANDS[keyName]
      || null;

    if (!command) {
      this.log.warn(`No command mapped for RemoteKey ${keyName || key}`);
      return;
    }
    this.log.info(`RemoteKey ${keyName} → "${command}"`);
    this.mqtt.sendCommand(command);
  }

  // Handle inbound state change from the hub.
  // X2 activity_control_down payload: { activity_name: "Watch TV", state: "on" }
  // or { state: "off" } when all activities are stopped.
  _onActivityState(data) {
    const activity = (data.state === 'off') ? null : (data.activity_name || null);
    this.currentActivity = activity;
    this.isOn = !!activity;

    this.log.info(`Hub state update: activity="${activity || 'none'}"`);

    this.tvService.updateCharacteristic(
      this.Characteristic.Active,
      this.isOn ? this.Characteristic.Active.ACTIVE : this.Characteristic.Active.INACTIVE,
    );

    if (activity) {
      const idx = this.activities.indexOf(activity);
      if (idx >= 0) {
        this.tvService.updateCharacteristic(this.Characteristic.ActiveIdentifier, idx);
      }
    }
  }
}

module.exports = { SofabatonTV };
