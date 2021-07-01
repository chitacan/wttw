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

# commands
complete -f -c wttw -n '__fish_wttw_needs_command' -a new -d "create new git worktree & tmux window"
complete -f -c wttw -n '__fish_wttw_needs_command' -a clean -d "cleanup worktree & window"
complete -f -c wttw -n '__fish_wttw_needs_command' -a open -d "open <path> on new tmux window"

# new command
complete -f -c wttw -n '__fish_wttw_using_command new; or __fish_wttw_using_command n' -a '(__fish_wttw_refs)'
complete -r -f -c wttw -n '__fish_wttw_using_command new; or __fish_wttw_using_command n' -d "base ref new branch based at" -a '(__fish_wttw_original_refs)' -s r
complete -r -f -c wttw -n '__fish_wttw_using_command new; or __fish_wttw_using_command n' -d "base ref new branch based at" -a '(__fish_wttw_original_refs)' -l base-ref
complete -r -f -c wttw -n '__fish_wttw_using_command new; or __fish_wttw_using_command n' -d "tmux session name" -s s
complete -r -f -c wttw -n '__fish_wttw_using_command new; or __fish_wttw_using_command n' -d "tmux session name" -l session
complete -r -f -c wttw -n '__fish_wttw_using_command new; or __fish_wttw_using_command n' -d "tmux pane count" -s p
complete -r -f -c wttw -n '__fish_wttw_using_command new; or __fish_wttw_using_command n' -d "tmux pane count" -l pane

# clean command
complete -f -c wttw -n '__fish_wttw_using_command clean; or __fish_wttw_using_command c'
complete -f -c wttw -n '__fish_wttw_using_command clean; or __fish_wttw_using_command c' -d "delete branch" -s b
complete -f -c wttw -n '__fish_wttw_using_command clean; or __fish_wttw_using_command c' -d "delete branch" -l delete-branch 
complete -f -c wttw -n '__fish_wttw_using_command clean; or __fish_wttw_using_command c' -d "delete worktree" -s w
complete -f -c wttw -n '__fish_wttw_using_command clean; or __fish_wttw_using_command c' -d "delete worktree" -l delete-worktree

# open command
complete -f -c wttw -n '__fish_wttw_using_command open; or __fish_wttw_using_command o' -d "auto resolve" -s a
complete -f -c wttw -n '__fish_wttw_using_command open; or __fish_wttw_using_command o' -d "auto resolve" -l auto-resolve
complete -r -f -c wttw -n '__fish_wttw_using_command open; or __fish_wttw_using_command o' -d "tmux session name" -s s
complete -r -f -c wttw -n '__fish_wttw_using_command open; or __fish_wttw_using_command o' -d "tmux session name" -l session
complete -r -f -c wttw -n '__fish_wttw_using_command open; or __fish_wttw_using_command o' -d "tmux pane count" -s p
complete -r -f -c wttw -n '__fish_wttw_using_command open; or __fish_wttw_using_command o' -d "tmux pane count" -l pane

# misc
complete -f -c wttw -n '__fish_wttw_needs_command' -l "help" -d "output usage information"
complete -f -c wttw -n '__fish_wttw_needs_command' -l "version" -d "output the version number"
complete -f -c wttw -n '__fish_wttw_needs_command' -l "dry-run" -d "dry run"
