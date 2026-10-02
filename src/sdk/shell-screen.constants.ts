import type { ShellPatternRule } from './shell-tool.types';

/** The start of a command: line start, or after `; & | ( ` or `$(`. */
const AT_COMMAND = '(?:^|[;&|(\\n`]|\\$\\()\\s*';
/** Not part of a longer word, a path or an option name. */
const WORD_START = '(?:^|[^a-z0-9_./-])';
const WORD_END = '(?![a-z0-9_-])';
/** The rest of the same command: up to the next separator. */
const SAME_COMMAND = '[^;&|\\n]*';
const SHELLS = '(?:ba|z|k|c|da|fi)?sh|pwsh|powershell|cmd';
const INTERPRETERS = `${SHELLS}|python[0-9.]*|node|perl|ruby|php|iex|invoke-expression`;
const DOWNLOADERS = '(?:curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod|fetch)';
/** A home directory, however a shell spells it. */
const HOME = '(?:~|\\$\\{?home\\}?|%userprofile%|%homepath%|\\$env:(?:userprofile|home)|\\$home)';

/**
 * What a script may not do, as patterns over the lower-cased, quote-stripped
 * view. This is a screen for the obvious, not a sandbox: a script can still
 * build any of these from pieces. It exists to stop the careless and the
 * injected, say why, and leave the rest to the operator's approval.
 */
export const SHELL_PATTERN_RULES: readonly ShellPatternRule[] = [
  {
    id: 'privilege-escalation',
    reason: 'it asks for administrator rights (sudo, doas, su, runas)',
    pattern: new RegExp(
      `${WORD_START}(?:sudo|doas|pkexec)${WORD_END}|\\brunas\\b|${AT_COMMAND}su(?:\\s+(?:-\\S*|root))?\\s*(?:$|[;&|])`,
      'u',
    ),
  },
  {
    id: 'download-and-run',
    reason: 'it downloads code and runs it in one step (curl | sh, iex (iwr ...))',
    pattern: new RegExp(
      [
        `${DOWNLOADERS}\\b${SAME_COMMAND}\\|\\s*(?:sudo\\s+)?(?:${INTERPRETERS})\\b`,
        `\\|\\s*(?:iex|invoke-expression)\\b`,
        `\\b(?:iex|invoke-expression)\\b[^\\n]*(?:iwr|irm|invoke-webrequest|invoke-restmethod|downloadstring|webclient)`,
        `(?:${SHELLS}|source|eval|\\.)\\s+<?\\(?\\s*\\$\\(\\s*${DOWNLOADERS}\\b`,
        `(?:${SHELLS})\\s+<\\(\\s*${DOWNLOADERS}\\b`,
        `(?:${SHELLS})\\s+(?:-[a-z]+\\s+)+\\$\\(\\s*${DOWNLOADERS}\\b`,
        `base64\\s+(?:-d|--decode|-di)\\b${SAME_COMMAND}\\|\\s*(?:${INTERPRETERS})\\b`,
      ].join('|'),
      'u',
    ),
  },
  {
    id: 'encoded-command',
    reason: 'an encoded command hides what it runs from the operator who approves it',
    pattern: new RegExp(
      `(?:powershell|pwsh)(?:\\.exe)?\\b${SAME_COMMAND}\\s-e(?:n|nc|nco|ncod|ncodedcommand)?\\s`,
      'u',
    ),
  },
  {
    id: 'credential-store',
    reason:
      'it reads or writes a credential store (ssh keys, cloud credentials, tokens, keychains)',
    pattern: new RegExp(
      [
        '(?:^|[\\s/=:"\'~])\\.ssh(?:/|\\s|$)',
        '\\bid_(?:rsa|dsa|ecdsa|ed25519)\\b',
        '\\.aws/(?:credentials|config)',
        '\\.gnupg\\b',
        '(?:^|[\\s/])\\.netrc\\b',
        '\\.git-credentials',
        `${HOME}/\\.npmrc`,
        '\\.docker/config\\.json',
        '\\.kube/config',
        'github cli/hosts\\.yml|\\.config/gh/hosts',
        '/etc/shadow',
        '\\b(?:login data|cookies\\.sqlite|key[34]\\.db|logins\\.json)\\b',
        `${WORD_START}security\\s+(?:find|dump|export|add)-?\\S*`,
        `${WORD_START}(?:cmdkey|vaultcmd|ssh-add|ssh-keygen|gpg\\s+--export-secret)${WORD_END}`,
        `${WORD_START}gh\\s+(?:auth|secret|ssh-key|gpg-key)\\b`,
        `${WORD_START}git\\s+credential\\b`,
        `${WORD_START}(?:npm|yarn|pnpm)\\s+(?:login|adduser|token|owner|access)\\b`,
        '/proc/[^\\s]*/environ',
      ].join('|'),
      'u',
    ),
  },
  {
    id: 'force-push',
    reason: 'it rewrites or deletes remote history (git push --force, --mirror, --delete)',
    pattern: new RegExp(
      `${WORD_START}git\\b${SAME_COMMAND}\\bpush\\b${SAME_COMMAND}(?:--force\\b|--force-with-lease|--mirror\\b|--delete\\b|\\s-[a-z]*f[a-z]*(?:\\s|$)|\\s\\+\\S|\\s:\\S)`,
      'u',
    ),
  },
  {
    id: 'git-config',
    reason:
      'it changes git configuration (git config, git remote add/set-url, git -c on a hook or program key)',
    pattern: new RegExp(
      [
        `${WORD_START}git\\b${SAME_COMMAND}\\bconfig\\b`,
        `${WORD_START}git\\b${SAME_COMMAND}\\bremote\\s+(?:add|set-url|set-head|rename|remove|rm)\\b`,
        `\\s-c\\s*[a-z.]*(?:core\\.hookspath|core\\.sshcommand|core\\.fsmonitor|core\\.pager|core\\.editor|core\\.askpass|credential\\.|alias\\.|protocol\\.|url\\.)`,
        '--config-env\\b',
        'core\\.hookspath',
      ].join('|'),
      'u',
    ),
  },
  {
    id: 'skip-hooks',
    reason: 'it skips the repository hooks (--no-verify)',
    pattern: /(?:^|\s)--no-verify\b|(?:^|\s)--no-gpg-sign\b/u,
  },
  {
    id: 'environment-dump',
    reason:
      'it dumps the environment (printenv, env, export -p, set, Get-ChildItem env:), where secrets live',
    pattern: new RegExp(
      [
        `${WORD_START}printenv${WORD_END}`,
        `${WORD_START}cmd(?:\\.exe)?(?:\\s+/[a-z])+\\s+set\\s*(?:$|[;&|>)\\n])`,
        `${AT_COMMAND}(?:/usr/bin/)?env\\s*(?:-0\\s*)?(?:$|[;&|>)\\n])`,
        `${AT_COMMAND}(?:export\\s+-p|export|declare\\s+-[a-z]*[xp][a-z]*|typeset\\s+-[a-z]*x|compgen\\s+-e|set)\\s*(?:$|[;&|>)\\n])`,
        `${WORD_START}(?:gci|get-childitem|dir|ls|get-item|gi)\\s+(?:-path\\s+)?env:`,
        '\\[environment\\]::getenvironmentvariables',
        '(?:process\\.env|os\\.environ)(?![.\\[\\w?])',
        '(?:^|\\s)(?:wmic\\s+environment|reg\\s+query\\s+hk[a-z_]*\\\\environment)',
      ].join('|'),
      'u',
    ),
  },
  {
    id: 'exfiltration',
    reason: 'it sends files or data to another machine (curl upload, nc, scp, ftp)',
    pattern: new RegExp(
      [
        `${WORD_START}(?:curl|wget)\\b${SAME_COMMAND}(?:\\s-t\\s|--upload-file|--post-file|--body-file|--data-binary\\s+@|--data(?:-raw|-urlencode)?\\s+@|\\s-d\\s*@|\\s-f\\s+\\S*=@|--form\\s+\\S*=@)`,
        `${WORD_START}(?:iwr|irm|invoke-webrequest|invoke-restmethod)\\b${SAME_COMMAND}(?:-infile|-method\\s+(?:post|put|patch|delete))`,
        `${WORD_START}(?:nc|ncat|netcat|socat|telnet)\\s`,
        '/dev/(?:tcp|udp)/',
        `${WORD_START}(?:scp|sftp|ftp|tftp)\\s`,
        `${WORD_START}rsync\\b${SAME_COMMAND}(?:\\S+@\\S+:|::)`,
        `${WORD_START}(?:npm|yarn|pnpm)\\s+publish\\b`,
        `${WORD_START}twine\\s+upload\\b`,
      ].join('|'),
      'u',
    ),
  },
  {
    id: 'system-change',
    reason:
      'it changes the machine rather than the project (cron, services, registry, startup files, disks, power)',
    pattern: new RegExp(
      [
        `${WORD_START}(?:crontab|schtasks|setx|launchctl|diskpart|mkfs[a-z.0-9]*|fdisk|parted|shutdown|reboot|poweroff|halt)${WORD_END}`,
        `${WORD_START}reg\\s+(?:add|delete|import)\\b`,
        `${WORD_START}systemctl\\s+(?:enable|disable|mask|start|stop|restart)\\b`,
        `${WORD_START}(?:set-executionpolicy|set-itemproperty\\s+hk|new-service|sc\\s+(?:create|delete|config))`,
        `${WORD_START}format(?:\\.com)?\\s+[a-z]:`,
        `${WORD_START}dd\\b${SAME_COMMAND}\\bof=/dev/`,
        '>\\s*/dev/(?:sd|nvme|hd|disk)',
        ':\\(\\)\\s*\\{',
        `${WORD_START}chmod\\s+(?:-r\\s+)?[0-7]*(?:777|\\+s)\\s+/`,
        `(?:>>?|tee(?:\\s+-a)?|add-content|set-content|out-file|sed\\s+-i|\\bcp|\\bmv)\\s${SAME_COMMAND}(?:\\.bashrc|\\.zshrc|\\.profile|\\.bash_profile|\\.zprofile|\\.bash_login|profile\\.ps1)`,
      ].join('|'),
      'u',
    ),
  },
  {
    id: 'kill-processes',
    reason: 'it kills processes it did not start (killall, pkill, taskkill)',
    pattern: new RegExp(
      `${WORD_START}(?:killall|pkill|taskkill|stop-process\\s+-name|kill\\s+-9\\s+-1)${WORD_END}`,
      'u',
    ),
  },
];
