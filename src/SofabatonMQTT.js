'use strict';

const mqtt = require('mqtt');
const { Bonjour } = require('bonjour-service');
const { EventEmitter } = require('events');

const MDNS_SERVICE_TYPE = 'sofabaton_hub';
const MDNS_PROTOCOL = 'udp';
const MQTT_PORT = 1883;
const DISCOVERY_TIMEOUT_MS = 10000;
const ACTIVITY_LIST_TIMEOUT_MS = 5000;

class SofabatonMQTT extends EventEmitter {
  constructor(log, config) {
    super();
    this.log = log;
    this.hubIP = config.hubIP || null;
    this.hubMac = config.hubMac || null;
    this.client = null;
  }

  // Discover hub via mDNS, then connect MQTT. Returns a Promise.
  async connect() {
    if (!this.hubIP) {
      this.log.info('No hubIP configured — starting mDNS discovery for Sofabaton X2 hub...');
      try {
        const { ip, mac } = await this._discoverHub();
        this.hubIP = ip;
        if (!this.hubMac && mac) {
          this.hubMac = mac;
        }
      } catch (err) {
        this.log.error('mDNS discovery failed:', err.message);
        throw err;
      }
    }

    return new Promise((resolve, reject) => {
      const brokerUrl = `mqtt://${this.hubIP}:${MQTT_PORT}`;
      this.log.info(`Connecting to Sofabaton X2 MQTT broker at ${brokerUrl}`);

      this.client = mqtt.connect(brokerUrl, {
        reconnectPeriod: 5000,
        connectTimeout: 10000,
      });

      this.client.once('connect', () => {
        this.log.info('Connected to Sofabaton X2 MQTT broker');
        this._subscribe();
        resolve();
      });

      this.client.once('error', (err) => {
        this.log.error('MQTT connection error:', err.message);
        reject(err);
      });

      this.client.on('reconnect', () => {
        this.log.info('Reconnecting to Sofabaton X2 MQTT broker...');
      });

      this.client.on('message', (topic, message) => {
        this._handleMessage(topic, message.toString());
      });
    });
  }

  // Request the activity list from the hub and return it as an array of
  // { activity_id, activity_name, state } objects. Resolves once the hub
  // responds on activity/{mac}/list, or rejects after a timeout.
  getActivities() {
    const mac = this.hubMac || '+';
    const listTopic = `activity/${mac}/list`;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeListener('_activityList', handler);
        reject(new Error(`No activity list response from hub after ${ACTIVITY_LIST_TIMEOUT_MS}ms`));
      }, ACTIVITY_LIST_TIMEOUT_MS);

      const handler = (activities) => {
        clearTimeout(timer);
        resolve(activities);
      };

      this.once('_activityList', handler);

      // Subscribe to the response topic, then publish the request
      this.client.subscribe(listTopic, () => {
        this.log.info('Requesting activity list from Sofabaton X2 hub...');
        this.client.publish(
          `activity/${mac}/list_request`,
          JSON.stringify({ data: 'activity_list' }),
        );
      });
    });
  }

  _subscribe() {
    const mac = this.hubMac || '+';
    // activity_control_down carries live state-change notifications from the hub
    this.client.subscribe(`activity/${mac}/activity_control_down`);
  }

  _handleMessage(topic, payload) {
    this.log.debug(`MQTT message: ${topic} → ${payload}`);

    let data;
    try {
      data = JSON.parse(payload);
    } catch {
      data = { raw: payload };
    }

    // Activity list response: activity/{mac}/list
    if (/^activity\/[^/]+\/list$/.test(topic)) {
      // Payload: { data: [ { activity_id, activity_name, state }, ... ] }
      const activities = Array.isArray(data.data) ? data.data : [];
      this.emit('_activityList', activities);
      return;
    }

    // Live state-change notification: activity/{mac}/activity_control_down
    // Payload: { activity_id, activity_name, state } or { state: "off" }
    if (/^activity\/[^/]+\/activity_control_down$/.test(topic)) {
      this.emit('activityState', data);
      return;
    }
  }

  // Activate a named activity on the hub.
  // Uses activity_control_up topic per the X2 MQTT protocol.
  activateActivity(activityName) {
    const mac = this.hubMac || '+';
    const topic = `activity/${mac}/activity_control_up`;
    const payload = JSON.stringify({ activity_name: activityName });
    this.log.debug(`Publishing activity start: ${topic} → ${payload}`);
    this.client.publish(topic, payload);
  }

  // Stop all activities (power off).
  deactivate() {
    const mac = this.hubMac || '+';
    const topic = `activity/${mac}/activity_control_up`;
    const payload = JSON.stringify({ activity_name: null });
    this.log.debug(`Deactivating: ${topic} → ${payload}`);
    this.client.publish(topic, payload);
  }

  // Send a named command (e.g. "cursor_up", "volume_up") to the current activity's device.
  sendCommand(command, deviceId) {
    const mac = this.hubMac || '+';
    const topic = `device/${mac}/command`;
    const payload = JSON.stringify({ command, deviceId: deviceId || undefined });
    this.log.debug(`Sending command: ${topic} → ${payload}`);
    this.client.publish(topic, payload);
  }

  // Discover Sofabaton X2 hub via mDNS. Resolves with { ip, mac }.
  _discoverHub() {
    return new Promise((resolve, reject) => {
      const bonjour = new Bonjour();
      const timer = setTimeout(() => {
        browser.stop();
        bonjour.destroy();
        reject(new Error(`Sofabaton X2 hub not found via mDNS after ${DISCOVERY_TIMEOUT_MS}ms`));
      }, DISCOVERY_TIMEOUT_MS);

      const browser = bonjour.find({ type: MDNS_SERVICE_TYPE, protocol: MDNS_PROTOCOL }, (service) => {
        clearTimeout(timer);
        browser.stop();
        bonjour.destroy();

        const ip = service.addresses && service.addresses[0];
        const mac = service.txt && (service.txt.mac || service.txt.id || null);

        if (!ip) {
          reject(new Error('mDNS service found but no IP address in record'));
          return;
        }

        this.log.info(`Discovered Sofabaton X2 hub at ${ip} (MAC: ${mac || 'unknown'})`);
        resolve({ ip, mac });
      });
    });
  }
}

module.exports = { SofabatonMQTT };
