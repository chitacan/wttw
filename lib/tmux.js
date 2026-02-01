const {EOL} = require('os');
const {command, commandSync} = require('execa');
const {join} = require('path');
const {existsSync} = require('fs-extra');

const windowExists = async (session, window) => {
  try {
    const cmd = session ?
      `tmux list-windows -t ${session} -F #W` :
      `tmux list-windows -F #W`;
    const windows = await command(cmd)
      .then(({stdout}) => stdout)

    return !!windows.split(EOL)
      .map(line => line.trim())
      .filter(line => line)
      .find(w => w === window);
  } catch (err) {
    return false;
  }
}

const sessionExists = async (name) => {
  try {
    const sessions = await command('tmux list-sessions -F #S')
      .then(({stdout}) => stdout);
    const session = sessions.split(EOL)
      .map(line => line.trim())
      .filter(line => line)
      .find(s => s === name);
    return !!session;
  } catch (err) {
    return false;
  }
}

const direnvPrefix = () => process.env.DIRENV_DIR ? 'direnv exec / ' : '';

exports.tmuxRunning = () => {
  try {
    commandSync('tmux info');
    return true;
  } catch (err) {
    return false;
  }
}

exports.createTmuxWindow = async (session, window, wtd, focus = false, cmd = '') => {
  const targetSession = session ? session + ':' : '';
  const focusFlag = focus ? '' : '-d ';

  if (!await windowExists(session, window)) {
    const cmdSuffix = cmd ? ` ${cmd}` : '';
    await command(`${direnvPrefix()}tmux new-window ${focusFlag}-t ${session} -n ${window} -c ${wtd}${cmdSuffix}`);
  } else {
    await command(`tmux select-window -t ${targetSession + window}`).catch((e) => {});
  }
}

exports.splitTmuxWindow = async (target, wtd, pane) => {
  const prefix = direnvPrefix();
  if (pane === 6) {
    await command(`${prefix}tmux splitw -v -p 50 -t ${target}.0 -c ${wtd} && \
                ${prefix}tmux splitw -h -p 33 -t ${target}.0 -c ${wtd} && \
                ${prefix}tmux splitw -h -p 50 -t ${target}.0 -c ${wtd} && \
                ${prefix}tmux splitw -h -p 33 -t ${target}.3 -c ${wtd} && \
                ${prefix}tmux splitw -h -p 50 -t ${target}.3 -c ${wtd} && \
                ${prefix}tmux selectp -t ${target}.0`, {shell: true})
  } else if (pane === 4) {
    await command(`${prefix}tmux splitw -v -p 50 -t ${target}.0 -c ${wtd} && \
                ${prefix}tmux splitw -h -p 50 -t ${target}.0 -c ${wtd} && \
                ${prefix}tmux splitw -h -p 50 -t ${target}.2 -c ${wtd} && \
                ${prefix}tmux selectp -t ${target}.0`, {shell: true})
  }
}

exports.getTmuxWindowId = async (name) => {
  try {
    const windows = await command('tmux list-windows -F #W:#{window_id}')
      .then(({stdout}) => stdout);
    const window = windows.split(EOL)
      .map(line => line.trim())
      .filter(line => line)
      .map(line => line.split(':'))
      .map(([name, id]) => ({name, id}))
      .find(w => w.name === name);
    return window.id;
  } catch (err) {
    throw new Error(`cannot find window name ${name} on tmux`);
  }
}

const createSession = exports.createSession = async (session, window, wtd) => {
  return await command(`${direnvPrefix()}tmux new-session -d -c ${wtd} -s ${session} -n ${window}`);
}

exports.switchSession = async (session, window, wtd) => {
  if (!await sessionExists(session)) {
    await createSession(session, window, wtd);
  }
  await command(`tmux switch -t ${session}`);
}

exports.showPopup = async (wtd) => {
  const taskPath = join(wtd, '.context', 'TASK.md');
  if (!existsSync(taskPath)) {
    return;
  }

  await command(`tmux popup -d ${wtd} -- /usr/local/bin/bat .context/TASK.md`);
}
