'use strict';

const https = require('https');

const BASE_URL = 'https://app1.sofabaton.com/app/keypress2';

class SofabatonAPI {
  constructor(log, nodeId) {
    this.log = log;
    this.nodeId = nodeId;
  }

  // Activate a named activity (type=1).
  activateActivity(activityName) {
    return this._call(activityName, 1);
  }

  // Deactivate a named activity (type=0).
  deactivateActivity(activityName) {
    return this._call(activityName, 0);
  }

  _call(activityName, type) {
    const encoded = encodeURIComponent(activityName);
    const url = `${BASE_URL}?node_id=${this.nodeId}&id=${encoded}&type=${type}`;
    this.log.debug(`Sofabaton API: ${url}`);

    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
        this.log.debug(`Sofabaton API response: ${res.statusCode}`);
        resolve(res.statusCode);
      }).on('error', (err) => {
        this.log.error(`Sofabaton API error: ${err.message}`);
        reject(err);
      });
    });
  }
}

module.exports = { SofabatonAPI };
