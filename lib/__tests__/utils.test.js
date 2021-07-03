const {join} = require('path');
const {sync} = require('command-exists');
const {command, commandSync} = require('execa');
const {existsSync, copySync} = require('fs-extra');

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
      .toHaveBeenNthCalledWith(2, `tmux new-window -t ${session} -n ${window} -c ${wtd}`);
    expect(command)
      .toHaveBeenNthCalledWith(3, `tmux select-window -t ${session}:${window}`);
  });

  test("window exists error", async () => {
    command.mockRejectedValueOnce();

    await utils.createTmuxWindow(session, window, wtd);
    expect(command)
      .toHaveBeenNthCalledWith(1, `tmux list-windows -t ${session} -F #W`);
    expect(command)
      .toHaveBeenNthCalledWith(2, `tmux new-window -t ${session} -n ${window} -c ${wtd}`);
    expect(command)
      .toHaveBeenNthCalledWith(3, `tmux select-window -t ${session}:${window}`);
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
      .toBe('/Users/me/project/.default_files');
  });
});

describe('copyDefaultFiles', () => {
  test('without default_files', () => {
    existsSync.mockReturnValueOnce(false);
    utils.copyDefaultFiles('/path/to/default_files', 'wtd');
    expect(copySync).not.toHaveBeenCalled();
  });

  test('with default_files and no HOOK file', () => {
    existsSync.mockReturnValueOnce(true);
    utils.copyDefaultFiles('/path/to/default_files', 'wtd');
    expect(copySync).toHaveBeenCalled();

    const [[,,{filter}]] = copySync.mock.calls;
    expect(filter('file.js')).toBe(true);
  });

  test('with default_files and HOOK file', () => {
    existsSync.mockReturnValueOnce(true);
    utils.copyDefaultFiles('/path/to/default_files', 'wtd');
    expect(copySync).toHaveBeenCalled();

    const [[,,{filter}]] = copySync.mock.calls;
    expect(filter('HOOK.js')).toBe(false);
  });
});

describe('updateDefaultFiles', () => {
  test('without default_files', () => {
    existsSync.mockReturnValueOnce(false);
    utils.updateDefaultFiles('/path/to/default_files', 'wtd');
    expect(copySync).not.toHaveBeenCalled();
  });

  test('with default_files', () => {
    existsSync.mockReturnValueOnce(true);
    utils.updateDefaultFiles('/path/to/default_files', 'wtd');
    expect(copySync).toHaveBeenCalled();

    const [[,,{filter}]] = copySync.mock.calls;
    existsSync.mockReturnValueOnce(true);
    expect(filter('HOOK.js', 'HOOK.js')).toBe(true);
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
