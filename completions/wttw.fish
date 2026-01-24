function __fish_wttw_needs_command
    set -l cmd (commandline -opc)
    if test (count $cmd) -eq 1
        return 0
    end
    return 1
end

function __fish_wttw_using_command -a current_command
    set -l cmd (commandline -opc)
    if test (count $cmd) -gt 1
        if test $current_command = $cmd[2]
            return 0
        end
    end
    return 1
end

function __fish_wttw_original_refs
    git for-each-ref --format="%(refname)" refs/ | sed -E "s/refs\/(heads|remotes)\///g" | sort -u
end

function __fish_wttw_refs
  git for-each-ref --format="%(refname)" refs/ | sed -E "s/refs\/(heads|remotes)\/(origin\/)?//g" | sort -u
end

function __fish_wttw_worktrees
  git worktree list --porcelain | grep '^branch' | sed -E "s/branch refs\/heads\///g"
end

# commands
complete -f -c wttw -n '__fish_wttw_needs_command' -a new -d "create new git worktree"
complete -f -c wttw -n '__fish_wttw_needs_command' -a clean -d "cleanup worktree"
complete -f -c wttw -n '__fish_wttw_needs_command' -a default-files -d "copy default_files to current directory"
complete -f -c wttw -n '__fish_wttw_needs_command' -a tmux -d "open path in tmux window"
complete -f -c wttw -n '__fish_wttw_needs_command' -a open -d "open worktree in browser"

# new command
complete -f -c wttw -n '__fish_wttw_using_command new; or __fish_wttw_using_command n' -a '(__fish_wttw_refs)'
complete -f -c wttw -n '__fish_wttw_using_command new; or __fish_wttw_using_command n' -d "open tmux window" -s t -l tmux
complete -f -c wttw -n '__fish_wttw_using_command new; or __fish_wttw_using_command n' -d "open vscode" -s c -l code
complete -r -f -c wttw -n '__fish_wttw_using_command new; or __fish_wttw_using_command n' -d "base ref new branch based at" -a '(__fish_wttw_original_refs)' -s r -l base-ref
complete -r -f -c wttw -n '__fish_wttw_using_command new; or __fish_wttw_using_command n' -d "tmux session name" -s s -l session
complete -r -f -c wttw -n '__fish_wttw_using_command new; or __fish_wttw_using_command n' -d "tmux pane count" -s p -l pane
complete -f -c wttw -n '__fish_wttw_using_command new; or __fish_wttw_using_command n' -d "create detached worktree" -s d -l detach
complete -f -c wttw -n '__fish_wttw_using_command new; or __fish_wttw_using_command n' -d "skip copying code-workspace file" -s W -l no-workspace

# clean command
complete -f -c wttw -n '__fish_wttw_using_command clean; or __fish_wttw_using_command c' -a '(__fish_wttw_worktrees)'
complete -f -c wttw -n '__fish_wttw_using_command clean; or __fish_wttw_using_command c' -d "clean tmux window" -s t -l tmux
complete -f -c wttw -n '__fish_wttw_using_command clean; or __fish_wttw_using_command c' -d "keep branch" -s b -l keep-branch
complete -f -c wttw -n '__fish_wttw_using_command clean; or __fish_wttw_using_command c' -d "keep worktree" -s w -l keep-worktree

# tmux command
complete -f -c wttw -n '__fish_wttw_using_command tmux; or __fish_wttw_using_command t' -a '(__fish_complete_directories)'
complete -r -f -c wttw -n '__fish_wttw_using_command tmux; or __fish_wttw_using_command t' -d "tmux pane count" -s p -l pane
complete -r -f -c wttw -n '__fish_wttw_using_command tmux; or __fish_wttw_using_command t' -d "tmux session name" -s s -l session

# open command
complete -f -c wttw -n '__fish_wttw_using_command open; or __fish_wttw_using_command o' -a '(__fish_wttw_worktrees)'
complete -r -f -c wttw -n '__fish_wttw_using_command open; or __fish_wttw_using_command o' -d "machine to open worktree" -s h -l host
complete -r -f -c wttw -n '__fish_wttw_using_command open; or __fish_wttw_using_command o' -d "vscode profile" -s p -l profile

# misc
complete -f -c wttw -n '__fish_wttw_needs_command' -l "help" -d "output usage information"
complete -f -c wttw -n '__fish_wttw_needs_command' -l "version" -d "output the version number"
complete -f -c wttw -n '__fish_wttw_needs_command' -s D -l "dry-run" -d "dry run"
