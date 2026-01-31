const {join} = require('path');
const {homedir} = require('os');
const {existsSync, readJsonSync, writeJsonSync, ensureDirSync} = require('fs-extra');

const CONFIG_DIR = join(homedir(), '.config', 'wttw');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

const DEFAULTS = {
  defaultPaneCount: 1
};

const deepMerge = (target, source) => {
  const result = {...target};
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === 'object'
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
};

const loadConfig = (exports.loadConfig = () => {
  if (!existsSync(CONFIG_PATH)) {
    return {...DEFAULTS};
  }
  const userConfig = readJsonSync(CONFIG_PATH, {throws: false}) || {};
  return deepMerge(DEFAULTS, userConfig);
});

exports.saveConfig = (config) => {
  ensureDirSync(CONFIG_DIR);
  writeJsonSync(CONFIG_PATH, config, {spaces: 2});
};

const getConfig = exports.getConfig = (key) => {
  const config = loadConfig();
  if (!key) return config;
  return key.split('.').reduce((obj, k) => (obj != null ? obj[k] : undefined), config);
};

exports.requireConfig = (key) => {
  const value = getConfig(key);
  if (value === undefined) {
    throw new Error(`"${key}" is not configured. Run: wttw config ${key} <value>`);
  }
  return value;
};

exports.setConfig = (key, value) => {
  const config = loadConfig();
  const keys = key.split('.');
  let obj = config;
  for (let i = 0; i < keys.length - 1; i++) {
    if (obj[keys[i]] == null || typeof obj[keys[i]] !== 'object') {
      obj[keys[i]] = {};
    }
    obj = obj[keys[i]];
  }
  obj[keys[keys.length - 1]] = value;
  exports.saveConfig(config);
  return config;
};
