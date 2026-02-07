const {existsSync, readJsonSync, writeJsonSync, ensureDirSync} = require('fs-extra');
const {loadProjectConfig, getProjectConfig, setProjectConfig, saveProjectConfig} = require('../config');

describe('loadProjectConfig', () => {
  test('returns global config when worktree config not found', () => {
    existsSync.mockReturnValue(false);

    const config = loadProjectConfig('/project/master');
    expect(config).toEqual({paneCount: 1});
  });

  test('merges worktree config over global config', () => {
    // global config exists
    existsSync.mockReturnValueOnce(true);
    readJsonSync.mockReturnValueOnce({paneCount: 2});
    // worktree config exists
    existsSync.mockReturnValueOnce(true);
    readJsonSync.mockReturnValueOnce({tmux: true, cmd: 'npm start'});

    const config = loadProjectConfig('/project/master');
    expect(config).toEqual({
      paneCount: 2,
      tmux: true,
      cmd: 'npm start',
    });
  });

  test('worktree config overrides global config values', () => {
    existsSync.mockReturnValueOnce(true);
    readJsonSync.mockReturnValueOnce({paneCount: 2});
    existsSync.mockReturnValueOnce(true);
    readJsonSync.mockReturnValueOnce({paneCount: 4});

    const config = loadProjectConfig('/project/master');
    expect(config.paneCount).toBe(4);
  });

  test('deep merges nested keys', () => {
    existsSync.mockReturnValueOnce(true);
    readJsonSync.mockReturnValueOnce({
      vscode: {baseUrl: 'https://vscode.dev', tunnelName: 'cmms'},
    });
    existsSync.mockReturnValueOnce(true);
    readJsonSync.mockReturnValueOnce({
      vscode: {tunnelName: 'override'},
    });

    const config = loadProjectConfig('/project/master');
    expect(config.vscode).toEqual({
      baseUrl: 'https://vscode.dev',
      tunnelName: 'override',
    });
  });
});

describe('getProjectConfig', () => {
  test('returns full config when no key', () => {
    existsSync.mockReturnValue(false);

    const config = getProjectConfig('/project/master');
    expect(config).toEqual({paneCount: 1});
  });

  test('returns value for dotted key', () => {
    existsSync.mockReturnValueOnce(true);
    readJsonSync.mockReturnValueOnce({
      vscode: {baseUrl: 'https://vscode.dev'},
    });
    existsSync.mockReturnValueOnce(false);

    const val = getProjectConfig('/project/master', 'vscode.baseUrl');
    expect(val).toBe('https://vscode.dev');
  });

  test('returns undefined for missing key', () => {
    existsSync.mockReturnValue(false);

    const val = getProjectConfig('/project/master', 'missing.key');
    expect(val).toBeUndefined();
  });
});

describe('saveProjectConfig', () => {
  test('writes config to ../context/wttw.json', () => {
    saveProjectConfig('/project/master', {tmux: true});

    expect(ensureDirSync).toHaveBeenCalledWith(
      expect.stringContaining('context')
    );
    expect(writeJsonSync).toHaveBeenCalledWith(
      expect.stringContaining('wttw.json'),
      {tmux: true},
      {spaces: 2}
    );
  });
});

describe('setProjectConfig', () => {
  test('creates new worktree config when file does not exist', () => {
    existsSync.mockReturnValue(false);

    const config = setProjectConfig('/project/master', 'tmux', true);
    expect(config).toEqual({tmux: true});
    expect(writeJsonSync).toHaveBeenCalled();
  });

  test('updates existing worktree config', () => {
    // worktree config exists
    existsSync.mockReturnValueOnce(true);
    readJsonSync.mockReturnValueOnce({tmux: false, cmd: 'npm start'});

    const config = setProjectConfig('/project/master', 'tmux', true);
    expect(config).toEqual({tmux: true, cmd: 'npm start'});
  });

  test('sets nested key', () => {
    existsSync.mockReturnValue(false);

    const config = setProjectConfig('/project/master', 'vscode.profile', 'dev');
    expect(config).toEqual({vscode: {profile: 'dev'}});
  });
});
