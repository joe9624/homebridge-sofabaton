'use strict';

const { REMOTE_KEY_MAP, STOP_ALL_ACTIVITY_ID } = require('./SofabatonConst');

class SofabatonTV {
  constructor(log, config, api, mqtt) {
    this.log = log;
    this.config = config;
    this.hapApi = api;
    this.mqtt = mqtt;

    this.name = config.name || 'Sofabaton';
    this.mainActivityName = config.mainActivity || null;

    // Populated after activity list is fetched: [ { activity_id, activity_name, state } ]
    this.activities = [];
    this.activityById = new Map();   // id  → activity object
    this.activityByName = new Map(); // name → activity object

    // Current state — kept in sync by activity_control_up pushes from hub
    this.currentActivityId = null;
    this.isOn = false;

    const { Service, Characteristic } = api.hap;
    this.Service = Service;
    this.Characteristic = Characteristic;

    // Input services created dynamically once activities are known
    this.inputServices = [];
  }

  // Called by the platform once the activity list has been fetched.
  // Stores activities and wires up all HomeKit services.
  setupWithActivities(accessory, activities) {
    this.activities = activities;
    activities.forEach((a) => {
      this.activityById.set(a.activity_id, a);
      this.activityByName.set(a.activity_name, a);
    });

    // Seed current state from what the hub reports
    const active = activities.find((a) => a.state === 'on');
    if (active) {
      this.currentActivityId = active.activity_id;
      this.isOn = true;
    }

    this._buildServices(accessory);

    // Listen for real-time state pushes from the hub (physical remote presses)
    this.mqtt.on('activityState', (data) => this._onActivityState(data));
  }

  _buildServices(accessory) {
    // --- Accessory Information ---
    const info = accessory.getService(this.Service.AccessoryInformation)
      || accessory.addService(this.Service.AccessoryInformation);
    info
      .setCharacteristic(this.Characteristic.Manufacturer, 'Sofabaton')
      .setCharacteristic(this.Characteristic.Model, 'X2')
      .setCharacteristic(this.Characteristic.SerialNumber, this.config.mac || 'Unknown');

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
      .onSet((value) => this._handleInputSet(value))
      .updateValue(this._getActiveIdentifier());

    this.tvService.getCharacteristic(this.Characteristic.RemoteKey)
      .onSet((value) => this._handleRemoteKey(value));

    // --- Speaker ---
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
        const keyName = value === this.Characteristic.VolumeSelector.INCREMENT
          ? 'VOLUME_UP' : 'VOLUME_DOWN';
        this._sendKey(keyName);
      });

    this.speakerService.getCharacteristic(this.Characteristic.Mute)
      .onGet(() => false)
      .onSet(() => this._sendKey('MUTE'));

    this.tvService.addLinkedService(this.speakerService);

    // --- InputSource — one per activity ---
    this.activities.forEach((activity, index) => {
      const subtype = `input_${activity.activity_id}`;
      const inputService = accessory.getService(subtype)
        || accessory.addService(this.Service.InputSource, activity.activity_name, subtype);

      inputService
        .setCharacteristic(this.Characteristic.Identifier, index)
        .setCharacteristic(this.Characteristic.ConfiguredName, activity.activity_name)
        .setCharacteristic(this.Characteristic.IsConfigured, this.Characteristic.IsConfigured.CONFIGURED)
        .setCharacteristic(this.Characteristic.InputSourceType, this.Characteristic.InputSourceType.APPLICATION)
        .setCharacteristic(this.Characteristic.CurrentVisibilityState, this.Characteristic.CurrentVisibilityState.SHOWN);

      this.tvService.addLinkedService(inputService);
      this.inputServices.push(inputService);
    });

    this.log.info(`TV accessory built with ${this.activities.length} inputs`);
  }

  // ─── Characteristic handlers ─────────────────────────────────────────────

  _getActiveIdentifier() {
    if (this.currentActivityId === null) return 0;
    const idx = this.activities.findIndex((a) => a.activity_id === this.currentActivityId);
    return idx >= 0 ? idx : 0;
  }

  _handleActiveSet(value) {
    if (value === this.Characteristic.Active.ACTIVE) {
      const activity = this.mainActivityName
        ? this.activityByName.get(this.mainActivityName)
        : this.activities[0];

      if (!activity) {
        this.log.warn('Power ON: no mainActivity found');
        return;
      }
      this.log.info(`Power ON → "${activity.activity_name}" (id ${activity.activity_id})`);
      this.mqtt.controlActivity(activity.activity_id, 'on');
    } else {
      this.log.info('Power OFF → stopping all activities');
      this.mqtt.controlActivity(STOP_ALL_ACTIVITY_ID, 'off');
    }
  }

  _handleInputSet(index) {
    const activity = this.activities[index];
    if (!activity) {
      this.log.warn(`No activity at index ${index}`);
      return;
    }
    this.log.info(`Input → "${activity.activity_name}" (id ${activity.activity_id})`);

    // Just send "on" for the new activity — the hub automatically stops
    // the current activity when a new one is started. Sending an explicit
    // "off" first causes the hub to cut power to everything before switching.
    this.mqtt.controlActivity(activity.activity_id, 'on');
  }

  _handleRemoteKey(key) {
    const { RemoteKey } = this.Characteristic;
    const keyName = Object.keys(RemoteKey).find((k) => RemoteKey[k] === key);
    this._sendKey(keyName);
  }

  _sendKey(keyName) {
    if (!keyName || !(keyName in REMOTE_KEY_MAP)) {
      this.log.warn(`No key ID mapped for "${keyName}"`);
      return;
    }
    if (this.currentActivityId === null) {
      this.log.warn(`Key "${keyName}" ignored — no active activity`);
      return;
    }
    const keyId = REMOTE_KEY_MAP[keyName];
    this.log.info(`Key "${keyName}" → id ${keyId} (activity ${this.currentActivityId})`);
    this.mqtt.sendKey(this.currentActivityId, keyId);
  }

  // ─── Real-time state from hub ─────────────────────────────────────────────

  // Called when the hub pushes an activity_control_up message.
  // This fires both when commands are confirmed AND when the physical remote is used.
  _onActivityState(data) {
    const { activity_id, state } = data;

    if (state === 'off' || activity_id === STOP_ALL_ACTIVITY_ID) {
      if (this.currentActivityId !== null) {
        this.log.info(`Hub: activity ${this.currentActivityId} stopped`);
      }
      this.currentActivityId = null;
      this.isOn = false;
      this.tvService.updateCharacteristic(this.Characteristic.Active, this.Characteristic.Active.INACTIVE);
      return;
    }

    if (state === 'on') {
      const activity = this.activityById.get(activity_id);
      const name = activity ? activity.activity_name : `id:${activity_id}`;
      this.log.info(`Hub: activity "${name}" is now ON`);

      this.currentActivityId = activity_id;
      this.isOn = true;

      const idx = this.activities.findIndex((a) => a.activity_id === activity_id);
      this.tvService.updateCharacteristic(this.Characteristic.Active, this.Characteristic.Active.ACTIVE);
      if (idx >= 0) {
        this.tvService.updateCharacteristic(this.Characteristic.ActiveIdentifier, idx);
      }
    }
  }
}

module.exports = { SofabatonTV };
