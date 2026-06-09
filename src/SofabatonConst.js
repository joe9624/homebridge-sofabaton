'use strict';

// Maps HomeKit RemoteKey values to Sofabaton X2 MQTT command strings.
// Override any of these per-activity via remoteOverrideCommandsList in config.
const REMOTE_KEY_COMMANDS = {
  ARROW_UP: 'cursor_up',
  ARROW_DOWN: 'cursor_down',
  ARROW_LEFT: 'cursor_left',
  ARROW_RIGHT: 'cursor_right',
  SELECT: 'cursor_ok',
  BACK: 'back',
  EXIT: 'back',
  PLAY_PAUSE: 'play_pause',
  INFORMATION: 'home',
  REWIND: 'rewind',
  FAST_FORWARD: 'fast_forward',
  NEXT_TRACK: 'next',
  PREVIOUS_TRACK: 'previous',
};

const VOLUME_COMMANDS = {
  UP: 'volume_up',
  DOWN: 'volume_down',
  MUTE: 'mute',
};

module.exports = { REMOTE_KEY_COMMANDS, VOLUME_COMMANDS };
