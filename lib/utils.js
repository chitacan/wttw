const {EOL} = require('os');
const {shell, shellSync} = require('execa');
const {info, error} = require('signale');
const {resolve} = require('path');
const {existsSync, copySync} = require('fs-extra');
const {sync} = require('command-exists');

const isGitRepo = async () => {
  await shell('git rev-parse --show-toplevel')
    .then(() => true)
    .catch(() => false);
}

exports.checks = async (flags = {}) => {
  const {requireGitRepo = true} = flags;

  if (!sync('tmux')) {
    throw new Error('"tmux" is not available on your system');
  }

  if (!sync('git')) {
    throw new Error('"git" is not available on your system');
  }

  const git = await isGitRepo();
  if (requireGitRepo && git) {
    throw new Error('should run in git repo');
  }
}

exports.tmuxRunning = () => {
  try {
    shellSync('tmux info &> /dev/null');
    return true;
  } catch (err) {
    return false;
  }
}

exports.createWorktree = async (wtd, branch, baseRef) => {
  if (existsSync(wtd)) {
    return;
  }
  await shell(`git worktree add -B ${branch} ${wtd} ${baseRef}`);
}

exports.createTmuxWindow = async (window, wtd) => {
  await shell(`tmux new-window -n ${window} -c ${wtd}`);
  await shell(`tmux select-window -t ${window}`).catch(() => {});
}

exports.splitTmuxWindow = async (wtd, pane) => {
  if (pane === 4) {
    await shell(`tmux splitw -v -p 50 -t 0 -c ${wtd} && \
                tmux splitw -h -p 50 -t 0 -c ${wtd} && \
                tmux splitw -h -p 50 -t 2 -c ${wtd} && \
                tmux selectp -t 0`)
  } else {
    await shell(`tmux splitw -v -p 50 -t 0 -c ${wtd} && \
                tmux splitw -h -p 33 -t 0 -c ${wtd} && \
                tmux splitw -h -p 50 -t 0 -c ${wtd} && \
                tmux splitw -h -p 33 -t 3 -c ${wtd} && \
                tmux splitw -h -p 50 -t 3 -c ${wtd} && \
                tmux selectp -t 0`)
  }
}

exports.branchExists = async (branch) => {
  return await shell(`git show-branch ${branch}`)
    .then(() => true)
    .catch(() => false)
}

exports.getTmuxWindowId = async (name) => {
  try {
    const windows = await shell('tmux list-windows -F "#W:#{window_id}"')
      .then(({stdout}) => stdout);
    const window = windows.split(EOL)
      .map(line => line.split(':'))
      .map(([name, id]) => ({name, id}))
      .find(w => w.name === name);
    return window.id;
  } catch (err) {
    throw new Error(`cannot find window name ${name} on tmux`);
  }
};

exports.getWindowNameFromBranch = branch => {
  if (branch.indexOf('/') > 0) {
    // for branch style '<TYPE>/<DESCRIPTION>'
    const [, window] = branch.split('/');
    return window;
  }
  return branch;
}

exports.copyDefaultFiles = (defaultFiles, wtd) => {
  if (!existsSync(defaultFiles)) {
    return;
  }

  copySync(defaultFiles, wtd);
}
