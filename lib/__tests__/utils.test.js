const {sync} = require('command-exists');
const {command, commandSync} = require('execa');

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
  })

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
  test('worktree path exists', () => {
    utils.createWorktree('/Users');
    expect(command).not.toHaveBeenCalled();
  });

  test('worktree path not exists', async () => {
    const wtd = 'worktree';
    const branch = 'branch';
    const baseRef = 'origin/branch';
    await utils.createWorktree(wtd, branch, baseRef);
    const [[cmd]] = command.mock.calls;
    expect(cmd).toBe(`git worktree add -B ${branch} ${wtd} ${baseRef}`);
  });

  test('worktree command error with already checked out', async () => {
    command.mockImplementationOnce(async () => {
      const err = new Error();
      err.stderr = "fatal: 'branch' is already checked out at";
      throw err;
    });

    const wtd = 'worktree';
    const branch = 'branch';
    const baseRef = 'origin/branch';
    await expect(utils.createWorktree(wtd, branch, baseRef)).rejects.toThrow('');
  });

  test('worktree command error', async () => {
    command.mockImplementationOnce(async () => {
      throw new Error();
    });

    const wtd = 'worktree';
    const branch = 'branch';
    const baseRef = 'origin/branch';
    await expect(utils.createWorktree(wtd, branch, baseRef)).rejects.toThrow('');
  });
});
