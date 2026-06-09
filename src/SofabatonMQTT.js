'use strict';

const mqtt = require('mqtt');
const { EventEmitter } = require('events');

const MQTT_PORT = 1883;
const ACTIVITY_LIST_TIMEOUT_MS = 15000;
const PUBLISH_DELAY_MS = 200; // hub is single-threaded; throttle publishes

class SofabatonMQTT extends EventEmitter {
  constructor(log, config) {
    super();
    this.log = log;
    this.mac = config.mac.replace(/[^a-fA-F0-9]/g, '').toUpperCase();
    this.host = config.host;
    this.port = config.port || MQTT_PORT;
    this.username = config.username || null;
    this.password = config.password || null;
    this.client = null;
    this._publishQueue = Promise.resolve();
    this._seenMessages = new Map(); // dedup cache: hash → expiry
  }

  // Connect to the MQTT broker and subscribe to all hub response topics.
  connect() {
    return new Promise((resolve, reject) => {
      const brokerUrl = `mqtt://${this.host}:${this.port}`;
      this.log.info(`Connecting to MQTT broker at ${brokerUrl} (hub MAC: ${this.mac})`);

      const opts = { reconnectPeriod: 5000, connectTimeout: 10000 };
      if (this.username) opts.username = this.username;
      if (this.password) opts.password = this.password;

      this.client = mqtt.connect(brokerUrl, opts);

      this.client.once('connect', () => {
        this.log.info('Connected to MQTT broker');
        this._subscribeToTopics();
        resolve();
      });

      this.client.once('error', (err) => {
        this.log.error('MQTT connection error:', err.message);
        reject(err);
      });

      this.client.on('reconnect', () => {
        this.log.info('Reconnecting to MQTT broker...');
      });

      this.client.on('message', (topic, message) => {
        this._handleMessage(topic, message.toString());
      });
    });
  }

  _subscribeToTopics() {
    const m = this.mac;
    const topics = [
      `activity/${m}/list`,               // activity list response
      `activity/${m}/activity_control_up`, // real-time state from hub/remote
      `activity/${m}/keys_list`,           // assigned keys response
      `activity/${m}/macro_keys_list`,     // macro keys response
      `activity/${m}/favorites_keys_list`, // favorite keys response
    ];
    topics.forEach((t) => this.client.subscribe(t));
    this.log.debug(`Subscribed to ${topics.length} topics for MAC ${this.mac}`);
  }

  _handleMessage(topic, payload) {
    // Dedup: skip if we've seen this exact topic+payload within 5 seconds
    const key = `${topic}|${payload}`;
    const now = Date.now();
    if (this._seenMessages.has(key) && this._seenMessages.get(key) > now) return;
    this._seenMessages.set(key, now + 5000);

    // Prune expired entries
    for (const [k, exp] of this._seenMessages) {
      if (exp < now) this._seenMessages.delete(k);
    }

    this.log.debug(`MQTT ← ${topic}: ${payload}`);

    let data;
    try {
      data = JSON.parse(payload);
    } catch {
      this.log.warn(`Failed to parse MQTT payload on ${topic}: ${payload}`);
      return;
    }

    const m = this.mac;

    if (topic === `activity/${m}/list`) {
      // { data: [ { activity_id, activity_name, state }, ... ] }
      this.emit('activityList', Array.isArray(data.data) ? data.data : []);

    } else if (topic === `activity/${m}/activity_control_up`) {
      // { activity_id: <int>, state: "on"|"off" }
      this.emit('activityState', data);

    } else if (topic === `activity/${m}/keys_list`) {
      this.emit('keysList', data);

    } else if (topic === `activity/${m}/macro_keys_list`) {
      this.emit('macroKeysList', data);

    } else if (topic === `activity/${m}/favorites_keys_list`) {
      this.emit('favoritesKeysList', data);
    }
  }

  // Request the full activity list from the hub. Resolves with activity array.
  getActivities() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeListener('activityList', handler);
        reject(new Error(`No activity list response after ${ACTIVITY_LIST_TIMEOUT_MS}ms`));
      }, ACTIVITY_LIST_TIMEOUT_MS);

      const handler = (activities) => {
        clearTimeout(timer);
        resolve(activities);
      };

      this.once('activityList', handler);
      this._publish(`activity/${this.mac}/list_request`, { data: 'activity_list' });
    });
  }

  // Activate or deactivate an activity by ID.
  // state: "on" | "off"
  // Use activity_id 255 (0xFF) to stop all activities.
  controlActivity(activityId, state) {
    this._publish(`activity/${this.mac}/activity_control_down`, {
      data: { activity_id: activityId, state },
    });
  }

  // Send an assigned key press for the current activity.
  sendKey(activityId, keyId) {
    this._publish(`activity/${this.mac}/keys_control`, {
      data: { activity_id: activityId, key_id: keyId },
    });
  }

  // Send a macro key press for the current activity.
  sendMacroKey(activityId, keyId) {
    this._publish(`activity/${this.mac}/macro_keys_control`, {
      data: { activity_id: activityId, key_id: keyId },
    });
  }

  // Send a favorite key press for the current activity.
  sendFavoriteKey(activityId, keyId) {
    this._publish(`activity/${this.mac}/favorites_keys_control`, {
      data: { activity_id: activityId, key_id: keyId },
    });
  }

  // Serialise all publishes through a queue with 200ms spacing so the hub's
  // single-threaded processor is not overwhelmed.
  _publish(topic, payload) {
    this._publishQueue = this._publishQueue.then(() => new Promise((resolve) => {
      const msg = JSON.stringify(payload);
      this.log.debug(`MQTT → ${topic}: ${msg}`);
      this.client.publish(topic, msg);
      setTimeout(resolve, PUBLISH_DELAY_MS);
    }));
  }
}

module.exports = { SofabatonMQTT };
