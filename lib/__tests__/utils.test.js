const {sync} = require('command-exists');
const {command} = require('execa');
const {existsSync, readFileSync, readJsonSync, writeFileSync} = require('fs-extra');
const klawSync = require('klaw-sync');
const {parse, stringify} = require('comment-json');
const {Octokit, __mockOctokit} = require('@octokit/rest');

const utils = require('../utils');

describe('checks', () => {
  test('ok', async () => {
    await expect(utils.checks).not.toThrow();
  });

  test('without tmux', async () => {
    sync.mockReturnValueOnce(false);

    await expect(utils.checks).rejects.toThrow('"tmux" is not available on your system');
  });

  test('without git', async () => {
    sync.mockReturnValueOnce(true);
    sync.mockReturnValueOnce(false);

    await expect(utils.checks).rejects.toThrow('"git" is not available on your system');
  });

  test('not on git repo', async () => {
    command.mockRejectedValueOnce();

    await expect(utils.checks).rejects.toThrow('should run in git repo');
  });
});

describe('checks (flags)', () => {
  test('requireTmux=false skips tmux check', async () => {
    sync.mockReturnValue(true);
    await expect(utils.checks({requireTmux: false})).resolves.not.toThrow();
    expect(sync).not.toHaveBeenCalledWith('tmux');
  });
});

describe('resolveDefaultFiles', () => {
  test('default_files path', () => {
    expect(utils.resolveDefaultFiles('/Users/me/project/branch'))
      .toBe('/Users/me/project/default_files');
  });
});

describe('copyDefaultFiles', () => {
  test('without default_files', () => {
    existsSync.mockReturnValueOnce(false);

    utils.copyDefaultFiles('/path/to/default_files', 'wtd');

    expect(readFileSync).not.toHaveBeenCalled();
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  test('with default_files and no HOOK file', () => {
    existsSync.mockReturnValueOnce(true);

    const paths = utils.copyDefaultFiles('/path/to/default_files', 'wtd');

    expect(paths.length).toBe(2);
    expect(readFileSync).toHaveBeenCalled();
    expect(writeFileSync).toHaveBeenCalled();
  });

  test('with default_files and HOOK file', () => {
    existsSync.mockReturnValueOnce(true);

    utils.copyDefaultFiles('/path/to/default_files', 'wtd');

    const [[,{filter}]] = klawSync.mock.calls;

    expect(filter({path: 'HOOK.js'})).toBe(false);
    expect(readFileSync).toHaveBeenCalled();
    expect(writeFileSync).toHaveBeenCalled();
  });
});

describe('runHook', () => {
  jest.mock('HOOK.js', () => jest.fn().mockReturnValue(true), {virtual: true});
  const hook = require('HOOK.js');

  test('without default_files', () => {
    existsSync.mockReturnValueOnce(false);
    utils.runHook('./', 'window', 'wtd');
    expect(hook).not.toHaveBeenCalled();
  });

  test('without HOOK file', () => {
    existsSync.mockReturnValue(false);
    existsSync.mockReturnValueOnce(true);
    utils.runHook('./', 'window', 'wtd');
    expect(hook).not.toHaveBeenCalled();
  });

  test('with HOOK file', () => {
    existsSync.mockReturnValue(true);
    utils.runHook('./', 'window', 'wtd');
    expect(hook).toHaveBeenCalledWith('window', 'wtd');
  });
});

describe('copyWorkspaceFile', () => {
  const workspacesDir = '/workspaces';
  const mainWorktree = '/project/master';
  const newWorktree = '/project/feature';

  test('source file not exists', () => {
    existsSync.mockReturnValueOnce(false);
    const result = utils.copyWorkspaceFile(workspacesDir, mainWorktree, newWorktree);
    expect(result).toBeUndefined();
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  test('target file already exists', () => {
    existsSync.mockReturnValueOnce(true); // source exists
    existsSync.mockReturnValueOnce(true); // target exists
    const result = utils.copyWorkspaceFile(workspacesDir, mainWorktree, newWorktree);
    expect(result).toBeUndefined();
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  test('copies and transforms workspace file', () => {
    existsSync.mockReturnValueOnce(true);  // source exists
    existsSync.mockReturnValueOnce(false); // target not exists
    readFileSync.mockReturnValueOnce('{}');
    parse.mockReturnValueOnce({
      folders: [
        {path: '../project/master', name: 'main'},
        {path: '../other', name: 'other'},
      ]
    });

    const result = utils.copyWorkspaceFile(workspacesDir, mainWorktree, newWorktree);
    expect(result).toBe('/workspaces/feature.code-workspace');
    expect(stringify).toHaveBeenCalled();
    const [[workspace]] = stringify.mock.calls;
    expect(workspace.folders[0].path).toBe('../project/feature');
    expect(workspace.folders[1].path).toBe('../other');
    expect(writeFileSync).toHaveBeenCalled();
  });

  test('handles parse error', () => {
    existsSync.mockReturnValueOnce(true);
    existsSync.mockReturnValueOnce(false);
    readFileSync.mockReturnValueOnce('invalid');
    parse.mockImplementationOnce(() => { throw new Error('parse error'); });

    const result = utils.copyWorkspaceFile(workspacesDir, mainWorktree, newWorktree);
    expect(result).toBeUndefined();
    const {warn} = require('signale');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('parse error'));
  });
});

describe('buildCodeURL', () => {
  const vsConfig = {
    vscode: {baseUrl: 'https://vscode.dev', tunnelName: 'cmms'},
  };

  const mockConfig = () => {
    existsSync.mockReturnValueOnce(true);
    readJsonSync.mockReturnValueOnce(vsConfig);
  };

  test('workspace file not found', () => {
    mockConfig();
    existsSync.mockReturnValueOnce(false); // wsd
    expect(() => utils.buildCodeURL('/project/branch', 'window'))
      .toThrow('does not exist');
  });

  test('with workspace file', () => {
    mockConfig();                           // loadConfig for baseUrl
    existsSync.mockReturnValueOnce(true);   // wsd exists
    mockConfig();                           // loadConfig for tunnelName
    const url = utils.buildCodeURL('/project/branch', 'window');
    expect(url).toContain('https://vscode.dev/tunnel/cmms/');
    expect(url).toContain('window.code-workspace');
  });

  test('with profile', () => {
    mockConfig();
    existsSync.mockReturnValueOnce(true);
    mockConfig();
    const url = utils.buildCodeURL('/project/branch', 'window', 'myprofile');
    expect(url).toContain('payload=');
    expect(url).toContain('profile');
  });
});

describe('requestOpenCode', () => {
  const ghConfig = {
    github: {owner: 'owner', repo: 'repo', ref: 'master'},
    arcSpaceName: 'Spectral',
  };

  const mockConfig = () => {
    existsSync.mockReturnValueOnce(true);
    readJsonSync.mockReturnValueOnce(ghConfig);
  };

  test('workflow not found', async () => {
    mockConfig(); // github.owner
    mockConfig(); // github.repo
    command.mockResolvedValueOnce({stdout: 'ghp_token'});
    __mockOctokit.actions.listRepoWorkflows.mockResolvedValueOnce({
      data: {workflows: []}
    });

    await expect(utils.requestOpenCode('http://url', 'host'))
      .rejects.toThrow('Cannot find GitHub Actions workflow');
  });

  test('runner not found', async () => {
    mockConfig();
    mockConfig();
    command.mockResolvedValueOnce({stdout: 'ghp_token'});
    __mockOctokit.actions.listRepoWorkflows.mockResolvedValueOnce({
      data: {workflows: [{path: '.github/workflows/open-myhost.yml'}]}
    });
    __mockOctokit.actions.listSelfHostedRunnersForRepo.mockResolvedValueOnce({
      data: {runners: []}
    });

    await expect(utils.requestOpenCode('http://url', 'myhost'))
      .rejects.toThrow('Cannot find self-hosted runner');
  });

  test('dispatches workflow', async () => {
    mockConfig(); // github.owner
    mockConfig(); // github.repo
    command.mockResolvedValueOnce({stdout: 'ghp_token'});
    __mockOctokit.actions.listRepoWorkflows.mockResolvedValueOnce({
      data: {workflows: [{path: '.github/workflows/open-myhost.yml'}]}
    });
    __mockOctokit.actions.listSelfHostedRunnersForRepo.mockResolvedValueOnce({
      data: {runners: [{name: 'myhost'}]}
    });
    __mockOctokit.actions.createWorkflowDispatch.mockResolvedValueOnce({});
    mockConfig(); // github.ref
    mockConfig(); // arcSpaceName

    await utils.requestOpenCode('http://url', 'myhost');
    expect(__mockOctokit.actions.createWorkflowDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow_id: 'open-myhost.yml',
        ref: 'master',
        inputs: {url: 'http://url', space: 'Spectral'}
      })
    );
  });
});
