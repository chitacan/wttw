const {sync} = require('command-exists');
const {command, commandSync} = require('execa');
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


describe('getWindowNameFromBranch', () => {
  test('branch without /', () => {
    const branch = 'some-branch';
    expect(utils.getWindowNameFromBranch(branch)).toBe(branch);
  });

  test('branch with /', () => {
    const type = 'type';
    const desc = 'description';
    const branch = `${type}/${desc}`;
    expect(utils.getWindowNameFromBranch(branch)).toBe(desc);
  });

  test('branch from clickup', () => {
    const branch = 'CU-cj2lct_Random-Task-Title_user';
    expect(utils.getWindowNameFromBranch(branch)).toBe('CU-cj2lct');
  });

  test('branch from linear', () => {
    const branch = 'spe-1234-Random-Task-Title_user';
    expect(utils.getWindowNameFromBranch(branch)).toBe('spe-1234');
  })

  test('branch from long text', () => {
    const branch = 'Random-Task-with-very-very-long-title_user';
    expect(utils.getWindowNameFromBranch(branch)).toBe('Random-Task-with-ver');
  })

  test('branch from text with trailing special characters', () => {
    const branch = 'Random-Task-title-----//';
    expect(utils.getWindowNameFromBranch(branch)).toBe('Random-Task-title');
  })
});

describe('tmuxRunning', () => {
  test('ok', () => {
    commandSync.mockReturnValueOnce(true);

    expect(utils.tmuxRunning()).toBe(true);
  });

  test('error', () => {
    commandSync.mockImplementationOnce(() => {
      throw new Error('error')
    });

    expect(utils.tmuxRunning()).toBe(false);
  });
});

describe('createWorktree', () => {
  const wtd = 'worktree';
  const branch = 'branch';
  const baseRef = 'origin/branch';

  test('worktree path exists', () => {
    existsSync.mockReturnValueOnce(true);
    utils.createWorktree('/Users');
    expect(command).not.toHaveBeenCalled();
  });

  test('worktree path not exists', async () => {
    await utils.createWorktree(wtd, branch, baseRef);
    expect(command).toHaveBeenCalledWith(`git worktree add -B ${branch} ${wtd} ${baseRef}`);
  });

  test('worktree command error with already checked out', async () => {
    command.mockImplementationOnce(async () => {
      const err = new Error();
      err.stderr = "fatal: 'branch' is already checked out at";
      throw err;
    });

    await expect(utils.createWorktree(wtd, branch, baseRef)).rejects.toThrow('');
  });

  test('worktree command error', async () => {
    command.mockImplementationOnce(async () => {
      throw new Error();
    });

    await expect(utils.createWorktree(wtd, branch, baseRef)).rejects.toThrow('');
  });
});

describe("createTmuxWindow", () => {
  const session = 'session';
  const window = 'window';
  const wtd = 'worktree';

  test("window exists", async () => {
    command.mockResolvedValueOnce({
      stdout: `
        window1
        window2
        window
      `
    });

    await utils.createTmuxWindow(session, window, wtd);
    expect(command)
      .toHaveBeenNthCalledWith(1, `tmux list-windows -t ${session} -F #W`);
    expect(command)
      .toHaveBeenNthCalledWith(2, `tmux select-window -t ${session}:${window}`);
  });

  test("invalid session name", async () => {
    command.mockResolvedValueOnce({
      stdout: `
        window1
        window2
        window
      `
    });

    await utils.createTmuxWindow('', window, wtd);
    expect(command)
      .toHaveBeenNthCalledWith(1, `tmux list-windows -F #W`);
    expect(command)
      .toHaveBeenNthCalledWith(2, `tmux select-window -t ${window}`);
  });

  test("window not exists", async () => {
    command.mockResolvedValueOnce({
      stdout: `
        window1
        window2
        window3
      `
    });

    await utils.createTmuxWindow(session, window, wtd);
    expect(command)
      .toHaveBeenNthCalledWith(1, `tmux list-windows -t ${session} -F #W`);
    expect(command)
      .toHaveBeenNthCalledWith(2, `tmux new-window -d -t ${session} -n ${window} -c ${wtd}`);
    expect(command).toHaveBeenCalledTimes(2);
  });

  test("window not exists with focus", async () => {
    command.mockResolvedValueOnce({
      stdout: `
        window1
        window2
      `
    });

    await utils.createTmuxWindow(session, window, wtd, true);
    expect(command)
      .toHaveBeenNthCalledWith(2, `tmux new-window -t ${session} -n ${window} -c ${wtd}`);
  });

  test("window not exists with cmd", async () => {
    command.mockResolvedValueOnce({
      stdout: `
        window1
        window2
      `
    });

    await utils.createTmuxWindow(session, window, wtd, false, 'vim');
    expect(command)
      .toHaveBeenNthCalledWith(2, `tmux new-window -d -t ${session} -n ${window} -c ${wtd} vim`);
  });

  test("window exists error", async () => {
    command.mockRejectedValueOnce();

    await utils.createTmuxWindow(session, window, wtd);
    expect(command)
      .toHaveBeenNthCalledWith(1, `tmux list-windows -t ${session} -F #W`);
    expect(command)
      .toHaveBeenNthCalledWith(2, `tmux new-window -d -t ${session} -n ${window} -c ${wtd}`);
    expect(command).toHaveBeenCalledTimes(2);
  });
});

describe("splitTmuxWindow", () => {
  const target = 'session:window';
  const wtd = 'worktree';

  test("4 pane", async () => {
    await utils.splitTmuxWindow(target, wtd, 4);
    const [cmds] = command.mock.calls;
    expect(cmds.length).toBe(2);
  });

  test("6 pane", async () => {
    await utils.splitTmuxWindow(target, wtd, 6);
    const [cmds] = command.mock.calls;
    expect(cmds.length).toBe(2);
  });
});

describe("branchExists", () => {
  test("ok", async () => {
    command.mockResolvedValueOnce();
    await expect(utils.branchExists('branch')).resolves.toBeTruthy();
  });

  test("error", async () => {
    command.mockRejectedValueOnce();
    await expect(utils.branchExists('branch')).resolves.toBeFalsy();
  });
});

describe("getTmuxWindowId", () => {
  test("ok", async () => {
    command.mockResolvedValueOnce({
      stdout: `
        window1:@1
        window2:@2
        window3:@3
      `
    });
    await expect(utils.getTmuxWindowId('window2')).resolves.toBe('@2');
  });

  test("error", async () => {
    const name = 'window2';
    command.mockResolvedValueOnce({stdout: ''});
    await expect(utils.getTmuxWindowId(name))
      .rejects
      .toThrow(`cannot find window name ${name} on tmux`);
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

describe('rootDir', () => {
  test('ok', async () => {
    command.mockResolvedValueOnce({stdout: '/root'});
    await expect(utils.rootDir()).resolves.toBe('/root');
  });

  test('not git repo', async () => {
    command.mockRejectedValueOnce();
    await expect(utils.rootDir()).resolves.toBe(process.cwd());
  });
});

describe('resolveProjectName', () => {
  test('ok', async () => {
    command.mockResolvedValueOnce({stdout: '/home/user/project/master'});
    await expect(utils.resolveProjectName()).resolves.toBe('project');
  });
});

describe('resolveMainWorktree', () => {
  test('ok', async () => {
    command.mockResolvedValueOnce({
      stdout: `
        /master    e2e8b14 [master]
        /branch-1  90b4555 [branch-1]
        /branch-2  9d8762c [branch-2]
      `
    });
    await expect(utils.resolveMainWorktree()).resolves.toBe('/master');
  });
});

describe('createSession', () => {
  test('ok', async () => {
    await utils.createSession('session', 'window', 'wtd');
    expect(command).toHaveBeenCalledWith('tmux new-session -d -c wtd -s session -n window');
  });
});

describe('switchSession', () => {
  test('session exists', async () => {
    command.mockResolvedValueOnce({
      stdout: `
        session-1
        session-2
      `
    });
    await utils.switchSession('session-1', 'window', 'wtd');
    expect(command).toHaveBeenCalledWith('tmux switch -t session-1');
  });

  test('session not exists', async () => {
    command.mockResolvedValueOnce({stdout: ''});
    await utils.switchSession('session-1', 'window', 'wtd');
    expect(command).toHaveBeenCalledWith('tmux new-session -d -c wtd -s session-1 -n window');
  });

  test('session exists error', async () => {
    command.mockRejectedValueOnce();
    await utils.switchSession('session-1', 'window', 'wtd');
    expect(command).toHaveBeenCalledWith('tmux new-session -d -c wtd -s session-1 -n window');
  });
});

describe('listWorktrees', () => {
  test('ok', async () => {
    command.mockResolvedValueOnce({
      stdout: `/master  e2e8b14 [master]\n/branch-1  90b4555 [branch-1]`
    });
    const result = await utils.listWorktrees();
    expect(result).toEqual([
      {path: '/master', hash: 'e2e8b14', branch: 'master'},
      {path: '/branch-1', hash: '90b4555', branch: 'branch-1'},
    ]);
  });

  test('detached worktree', async () => {
    command.mockResolvedValueOnce({
      stdout: `/detached  abc1234 (detached HEAD)`
    });
    const result = await utils.listWorktrees();
    expect(result[0].path).toBe('/detached');
    expect(result[0].branch).toBe('(detached');
  });
});

describe('createWorktree (detach)', () => {
  test('detach mode', async () => {
    existsSync.mockReturnValueOnce(false);
    await utils.createWorktree('wtd', 'branch', 'origin/main', true);
    expect(command).toHaveBeenCalledWith('git worktree add --detach wtd origin/main');
  });
});

describe('getWindowNameFromBranch (edge cases)', () => {
  test('branch with empty window after split throws', () => {
    expect(() => utils.getWindowNameFromBranch('type//desc')).toThrow('invalid');
  });
});

describe('checks (flags)', () => {
  test('requireTmux=false skips tmux check', async () => {
    sync.mockReturnValue(true);
    await expect(utils.checks({requireTmux: false})).resolves.not.toThrow();
    expect(sync).not.toHaveBeenCalledWith('tmux');
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

describe('showPopup', () => {
  test('no TASK.md file', async () => {
    existsSync.mockReturnValueOnce(false);
    await utils.showPopup('/project/branch');
    expect(command).not.toHaveBeenCalled();
  });

  test('with TASK.md file', async () => {
    existsSync.mockReturnValueOnce(true);
    await utils.showPopup('/project/branch');
    expect(command).toHaveBeenCalledWith(
      'tmux popup -d /project/branch -- /usr/local/bin/bat .context/TASK.md'
    );
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
