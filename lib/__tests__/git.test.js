const {command} = require('execa');
const {existsSync} = require('fs-extra');

const git = require('../git');

describe('getWindowNameFromBranch', () => {
  test('branch without /', () => {
    const branch = 'some-branch';
    expect(git.getWindowNameFromBranch(branch)).toBe(branch);
  });

  test('branch with /', () => {
    const type = 'type';
    const desc = 'description';
    const branch = `${type}/${desc}`;
    expect(git.getWindowNameFromBranch(branch)).toBe(desc);
  });

  test('branch from clickup', () => {
    const branch = 'CU-cj2lct_Random-Task-Title_user';
    expect(git.getWindowNameFromBranch(branch)).toBe('CU-cj2lct');
  });

  test('branch from linear', () => {
    const branch = 'spe-1234-Random-Task-Title_user';
    expect(git.getWindowNameFromBranch(branch)).toBe('spe-1234');
  })

  test('branch from long text', () => {
    const branch = 'Random-Task-with-very-very-long-title_user';
    expect(git.getWindowNameFromBranch(branch)).toBe('Random-Task-with-ver');
  })

  test('branch from text with trailing special characters', () => {
    const branch = 'Random-Task-title-----//';
    expect(git.getWindowNameFromBranch(branch)).toBe('Random-Task-title');
  })
});

describe('getWindowNameFromBranch (edge cases)', () => {
  test('branch with empty window after split throws', () => {
    expect(() => git.getWindowNameFromBranch('type//desc')).toThrow('invalid');
  });
});

describe('createWorktree', () => {
  const wtd = 'worktree';
  const branch = 'branch';
  const baseRef = 'origin/branch';

  test('worktree path exists', () => {
    existsSync.mockReturnValueOnce(true);
    git.createWorktree('/Users');
    expect(command).not.toHaveBeenCalled();
  });

  test('worktree path not exists', async () => {
    await git.createWorktree(wtd, branch, baseRef);
    expect(command).toHaveBeenCalledWith(`git worktree add -B ${branch} ${wtd} ${baseRef}`);
  });

  test('worktree command error with already checked out', async () => {
    command.mockImplementationOnce(async () => {
      const err = new Error();
      err.stderr = "fatal: 'branch' is already checked out at";
      throw err;
    });

    await expect(git.createWorktree(wtd, branch, baseRef)).rejects.toThrow('');
  });

  test('worktree command error', async () => {
    command.mockImplementationOnce(async () => {
      throw new Error();
    });

    await expect(git.createWorktree(wtd, branch, baseRef)).rejects.toThrow('');
  });
});

describe('createWorktree (detach)', () => {
  test('detach mode', async () => {
    existsSync.mockReturnValueOnce(false);
    await git.createWorktree('wtd', 'branch', 'origin/main', true);
    expect(command).toHaveBeenCalledWith('git worktree add --detach wtd origin/main');
  });
});

describe('branchExists', () => {
  test('ok', async () => {
    command.mockResolvedValueOnce();
    await expect(git.branchExists('branch')).resolves.toBeTruthy();
  });

  test('error', async () => {
    command.mockRejectedValueOnce();
    await expect(git.branchExists('branch')).resolves.toBeFalsy();
  });
});

describe('rootDir', () => {
  test('ok', async () => {
    command.mockResolvedValueOnce({stdout: '/root'});
    await expect(git.rootDir()).resolves.toBe('/root');
  });

  test('not git repo', async () => {
    command.mockRejectedValueOnce();
    await expect(git.rootDir()).resolves.toBe(process.cwd());
  });
});

describe('resolveProjectName', () => {
  test('ok', async () => {
    command.mockResolvedValueOnce({stdout: '/home/user/project/master'});
    await expect(git.resolveProjectName()).resolves.toBe('project');
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
    await expect(git.resolveMainWorktree()).resolves.toBe('/master');
  });
});

describe('listWorktrees', () => {
  test('ok', async () => {
    command.mockResolvedValueOnce({
      stdout: `/master  e2e8b14 [master]\n/branch-1  90b4555 [branch-1]`
    });
    const result = await git.listWorktrees();
    expect(result).toEqual([
      {path: '/master', hash: 'e2e8b14', branch: 'master'},
      {path: '/branch-1', hash: '90b4555', branch: 'branch-1'},
    ]);
  });

  test('detached worktree', async () => {
    command.mockResolvedValueOnce({
      stdout: `/detached  abc1234 (detached HEAD)`
    });
    const result = await git.listWorktrees();
    expect(result[0].path).toBe('/detached');
    expect(result[0].branch).toBe('(detached');
  });
});
