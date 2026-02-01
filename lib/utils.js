const {command} = require('execa');
const {join, basename, resolve, relative, dirname} = require('path');
const {existsSync, readFileSync, writeFileSync, ensureDirSync} = require('fs-extra');
const {sync} = require('command-exists');
const klawSync = require('klaw-sync');
const {render} = require('ejs');
const {parse, stringify} = require('comment-json');
const {Octokit} = require('@octokit/rest');
const {requireConfig} = require('./config');
const {isGitRepo} = require('./git');

exports.checks = async (flags = {}) => {
  const {requireGitRepo = true, requireTmux = true} = flags;

  if (requireTmux && !sync('tmux')) {
    throw new Error('"tmux" is not available on your system');
  }

  if (!sync('git')) {
    throw new Error('"git" is not available on your system');
  }

  const git = await isGitRepo();
  if (requireGitRepo && !git) {
    throw new Error('should run in git repo');
  }
}

exports.resolveDefaultFiles = cwd => resolve(cwd, '..', 'default_files')

exports.copyDefaultFiles = (defaultFiles, wtd) => {
  if (!existsSync(defaultFiles)) {
    return;
  }

  const paths = klawSync(defaultFiles, {nodir: true, traverseAll: true, filter: (item) => {
    if (basename(item.path) === 'HOOK.js') {
      return false;
    }
    return true;
  }})
  .map(item => item.path)
  .map(path => ({from: path, to: join(wtd, relative(defaultFiles, path))}))

  paths.forEach(({from, to}) => {
    const content = readFileSync(from, 'utf8');
    ensureDirSync(dirname(to));
    const rendered = render(content, {branch: basename(wtd)});
    writeFileSync(to, rendered);
  })

  return paths.map(({to}) => to);
}

exports.runHook = (defaultFiles, window, wtd) => {
  const hook = join(defaultFiles, 'HOOK.js');
  if (!existsSync(defaultFiles)) {
    return;
  }

  if (!existsSync(hook)) {
    return;
  }

  require(hook)(window, wtd);
}

exports.copyWorkspaceFile = (workspacesDir, mainWorktree, newWorktree) => {
  const mainWorktreeName = basename(mainWorktree);
  const newWorktreeName = basename(newWorktree);

  const sourceFile = join(workspacesDir, `${mainWorktreeName}.code-workspace`);
  if (!existsSync(sourceFile)) return;

  const targetFile = join(workspacesDir, `${newWorktreeName}.code-workspace`);
  if (existsSync(targetFile)) return;

  try {
    const workspace = parse(readFileSync(sourceFile, 'utf8'));

    workspace.folders = workspace.folders.map(folder => {
      const folderAbsPath = resolve(workspacesDir, folder.path);

      if (folderAbsPath === mainWorktree) {
        const newRelPath = relative(workspacesDir, newWorktree);
        return {
          ...folder,
          path: newRelPath
        };
      }
      return folder;
    });

    writeFileSync(targetFile, stringify(workspace, null, 2));
    return targetFile;
  } catch (err) {
    const {warn} = require('signale');
    warn(`Failed to copy workspace file: ${err.message}`);
  }
}

exports.buildCodeURL = (wtd, window, profile) => {
  const wsd = resolve(wtd, '..', 'context', 'workspaces', `${window}.code-workspace`);
  const url = new URL(requireConfig('vscode.baseUrl'));

  if (!existsSync(wsd)) {
    throw new Error(`${wsd} does not exist`);
  }

  url.pathname = join('tunnel', requireConfig('vscode.tunnelName'), wsd).toLowerCase();

  if (profile) {
    url.searchParams.set('payload', JSON.stringify([['profile', profile]]));
  }

  return url.toString();
}

exports.requestOpenCode = async (url, host) => {
  const slug = {owner: requireConfig('github.owner'), repo: requireConfig('github.repo')};
  const workflowFile = `open-${host}.yml`;

  const token = await command('gh auth token')
    .then(({stdout}) => stdout.trim());

  const octokit = new Octokit({ auth: token });
  const {data: {workflows}} = await octokit.actions.listRepoWorkflows(slug)
  const workflow = workflows.find(wf => basename(wf.path) === workflowFile);
  if (!workflow) {
    throw new Error(`Cannot find GitHub Actions workflow "${workflowFile}"`);
  }

  const {data: {runners}} = await octokit.actions.listSelfHostedRunnersForRepo(slug);
  const runner = runners.find(r => r.name === host);
  if (!runner) {
    throw new Error(`Cannot find self-hosted runner "${host}"`);
  }

  await octokit.actions.createWorkflowDispatch({
    ...slug,
    workflow_id: workflowFile,
    ref: requireConfig('github.ref'),
    inputs: {
      url,
      space: requireConfig('arcSpaceName')
    }
  });
}
