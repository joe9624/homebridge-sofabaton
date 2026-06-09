'use strict';

// Remote key IDs as defined by the Sofabaton X2 hub firmware.
// Source: ha-sofabaton-hub integration (yomonpet/ha-sofabaton-hub)
const KEY_IDS = {
  // Navigation
  ARROW_UP:      174,
  ARROW_DOWN:    178,
  ARROW_LEFT:    175,
  ARROW_RIGHT:   177,
  SELECT:        176, // OK
  BACK:          179,
  HOME:          180,
  MENU:          181,
  EXIT:          154,

  // Volume
  VOLUME_UP:     182,
  VOLUME_DOWN:   185,
  MUTE:          184,

  // Channel
  CHANNEL_UP:    183,
  CHANNEL_DOWN:  186,

  // Media playback
  PLAY:          156,
  PAUSE:         188,
  PLAY_PAUSE:    188, // alias — hub uses same key for pause
  REWIND:        187,
  FAST_FORWARD:  189,
  GUIDE:         157,
  DVR:           155,

  // Color / function buttons
  RED:           190,
  GREEN:         191,
  YELLOW:        192,
  BLUE:          193,

  // Custom
  A:             153,
  B:             152,
  C:             151,

  // Info
  INFORMATION:   157, // maps to Guide
};

// Maps HomeKit RemoteKey characteristic values to KEY_IDs above.
const REMOTE_KEY_MAP = {
  ARROW_UP:       KEY_IDS.ARROW_UP,
  ARROW_DOWN:     KEY_IDS.ARROW_DOWN,
  ARROW_LEFT:     KEY_IDS.ARROW_LEFT,
  ARROW_RIGHT:    KEY_IDS.ARROW_RIGHT,
  SELECT:         KEY_IDS.SELECT,
  BACK:           KEY_IDS.BACK,
  EXIT:           KEY_IDS.EXIT,
  PLAY_PAUSE:     KEY_IDS.PLAY_PAUSE,
  INFORMATION:    KEY_IDS.INFORMATION,
  REWIND:         KEY_IDS.REWIND,
  FAST_FORWARD:   KEY_IDS.FAST_FORWARD,
  NEXT_TRACK:     KEY_IDS.CHANNEL_UP,
  PREVIOUS_TRACK: KEY_IDS.CHANNEL_DOWN,
};

// activity_id 255 (0xFF) is the Sofabaton protocol sentinel for "stop all activities"
const STOP_ALL_ACTIVITY_ID = 0xFF;

module.exports = { KEY_IDS, REMOTE_KEY_MAP, STOP_ALL_ACTIVITY_ID };
