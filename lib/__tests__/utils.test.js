const {sync} = require('command-exists');
const {command} = require('execa');
const {existsSync, readFileSync, readJsonSync, writeFileSync} = require('fs-extra');
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

});


describe('runHook', () => {
  const opts = {window: 'w', wtd: '/wtd', branch: 'b', configDir: '/config/dir'};

  test('no-op when hooks is undefined', async () => {
    await utils.runHook(undefined, opts);
    expect(command).not.toHaveBeenCalled();
  });

  test('no-op when hooks is empty', async () => {
    await utils.runHook([], opts);
    expect(command).not.toHaveBeenCalled();
  });

  test('shell hook executes with env vars', async () => {
    await utils.runHook(
      [{shell: 'echo hello'}],
      {window: 'my-window', wtd: '/path/to/wtd', branch: 'feat', configDir: '/cfg'}
    );
    expect(command).toHaveBeenCalledWith('echo hello', {
      cwd: '/path/to/wtd',
      env: expect.objectContaining({
        WTTW_WINDOW: 'my-window',
        WTTW_WTD: '/path/to/wtd',
        WTTW_BRANCH: 'feat',
      }),
    });
  });

  test('js hook with absolute path', async () => {
    const mockJsHook = jest.fn();
    jest.mock('/absolute/hook.js', () => mockJsHook, {virtual: true});

    await utils.runHook([{js: '/absolute/hook.js'}], opts);
    expect(mockJsHook).toHaveBeenCalledWith({window: 'w', wtd: '/wtd', branch: 'b'});
  });

  test('js hook with relative path resolves from configDir', async () => {
    const mockRelHook = jest.fn();
    jest.mock('/config/dir/hooks/setup.js', () => mockRelHook, {virtual: true});

    await utils.runHook([{js: './hooks/setup.js'}], opts);
    expect(mockRelHook).toHaveBeenCalledWith({window: 'w', wtd: '/wtd', branch: 'b'});
  });

  test('multiple hooks run sequentially', async () => {
    const mockMultiHook = jest.fn();
    jest.mock('/absolute/multi.js', () => mockMultiHook, {virtual: true});

    await utils.runHook(
      [{shell: 'echo first'}, {js: '/absolute/multi.js'}],
      opts
    );
    expect(command).toHaveBeenCalledWith('echo first', expect.any(Object));
    expect(mockMultiHook).toHaveBeenCalledWith({window: 'w', wtd: '/wtd', branch: 'b'});
  });

  test('hook error is caught and returned', async () => {
    command.mockRejectedValueOnce(new Error('shell failed'));

    const errors = await utils.runHook([{shell: 'bad-cmd'}], opts);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe('shell failed');
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
