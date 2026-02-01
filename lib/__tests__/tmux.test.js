const {command, commandSync} = require('execa');
const {existsSync} = require('fs-extra');

const tmux = require('../tmux');

describe('tmuxRunning', () => {
  test('ok', () => {
    commandSync.mockReturnValueOnce(true);

    expect(tmux.tmuxRunning()).toBe(true);
  });

  test('error', () => {
    commandSync.mockImplementationOnce(() => {
      throw new Error('error')
    });

    expect(tmux.tmuxRunning()).toBe(false);
  });
});

describe('createTmuxWindow', () => {
  const session = 'session';
  const window = 'window';
  const wtd = 'worktree';

  test('window exists', async () => {
    command.mockResolvedValueOnce({
      stdout: `
        window1
        window2
        window
      `
    });

    await tmux.createTmuxWindow(session, window, wtd);
    expect(command)
      .toHaveBeenNthCalledWith(1, `tmux list-windows -t ${session} -F #W`);
    expect(command)
      .toHaveBeenNthCalledWith(2, `tmux select-window -t ${session}:${window}`);
  });

  test('invalid session name', async () => {
    command.mockResolvedValueOnce({
      stdout: `
        window1
        window2
        window
      `
    });

    await tmux.createTmuxWindow('', window, wtd);
    expect(command)
      .toHaveBeenNthCalledWith(1, `tmux list-windows -F #W`);
    expect(command)
      .toHaveBeenNthCalledWith(2, `tmux select-window -t ${window}`);
  });

  test('window not exists', async () => {
    command.mockResolvedValueOnce({
      stdout: `
        window1
        window2
        window3
      `
    });

    await tmux.createTmuxWindow(session, window, wtd);
    expect(command)
      .toHaveBeenNthCalledWith(1, `tmux list-windows -t ${session} -F #W`);
    expect(command)
      .toHaveBeenNthCalledWith(2, `tmux new-window -d -t ${session} -n ${window} -c ${wtd}`);
    expect(command).toHaveBeenCalledTimes(2);
  });

  test('window not exists with focus', async () => {
    command.mockResolvedValueOnce({
      stdout: `
        window1
        window2
      `
    });

    await tmux.createTmuxWindow(session, window, wtd, true);
    expect(command)
      .toHaveBeenNthCalledWith(2, `tmux new-window -t ${session} -n ${window} -c ${wtd}`);
  });

  test('window not exists with cmd', async () => {
    command.mockResolvedValueOnce({
      stdout: `
        window1
        window2
      `
    });

    await tmux.createTmuxWindow(session, window, wtd, false, 'vim');
    expect(command)
      .toHaveBeenNthCalledWith(2, `tmux new-window -d -t ${session} -n ${window} -c ${wtd} vim`);
  });

  test('window exists error', async () => {
    command.mockRejectedValueOnce();

    await tmux.createTmuxWindow(session, window, wtd);
    expect(command)
      .toHaveBeenNthCalledWith(1, `tmux list-windows -t ${session} -F #W`);
    expect(command)
      .toHaveBeenNthCalledWith(2, `tmux new-window -d -t ${session} -n ${window} -c ${wtd}`);
    expect(command).toHaveBeenCalledTimes(2);
  });
});

describe('splitTmuxWindow', () => {
  const target = 'session:window';
  const wtd = 'worktree';

  test('4 pane', async () => {
    await tmux.splitTmuxWindow(target, wtd, 4);
    const [cmds] = command.mock.calls;
    expect(cmds.length).toBe(2);
  });

  test('6 pane', async () => {
    await tmux.splitTmuxWindow(target, wtd, 6);
    const [cmds] = command.mock.calls;
    expect(cmds.length).toBe(2);
  });
});

describe('getTmuxWindowId', () => {
  test('ok', async () => {
    command.mockResolvedValueOnce({
      stdout: `
        window1:@1
        window2:@2
        window3:@3
      `
    });
    await expect(tmux.getTmuxWindowId('window2')).resolves.toBe('@2');
  });

  test('error', async () => {
    const name = 'window2';
    command.mockResolvedValueOnce({stdout: ''});
    await expect(tmux.getTmuxWindowId(name))
      .rejects
      .toThrow(`cannot find window name ${name} on tmux`);
  });
});

describe('createSession', () => {
  test('ok', async () => {
    await tmux.createSession('session', 'window', 'wtd');
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
    await tmux.switchSession('session-1', 'window', 'wtd');
    expect(command).toHaveBeenCalledWith('tmux switch -t session-1');
  });

  test('session not exists', async () => {
    command.mockResolvedValueOnce({stdout: ''});
    await tmux.switchSession('session-1', 'window', 'wtd');
    expect(command).toHaveBeenCalledWith('tmux new-session -d -c wtd -s session-1 -n window');
  });

  test('session exists error', async () => {
    command.mockRejectedValueOnce();
    await tmux.switchSession('session-1', 'window', 'wtd');
    expect(command).toHaveBeenCalledWith('tmux new-session -d -c wtd -s session-1 -n window');
  });
});

describe('showPopup', () => {
  test('no TASK.md file', async () => {
    existsSync.mockReturnValueOnce(false);
    await tmux.showPopup('/project/branch');
    expect(command).not.toHaveBeenCalled();
  });

  test('with TASK.md file', async () => {
    existsSync.mockReturnValueOnce(true);
    await tmux.showPopup('/project/branch');
    expect(command).toHaveBeenCalledWith(
      'tmux popup -d /project/branch -- /usr/local/bin/bat .context/TASK.md'
    );
  });
});
