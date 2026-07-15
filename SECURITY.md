# Security

## Supported versions

The stable `1.x` series receives security fixes. Versions `0.x` are previews and should be upgraded.

## Reporting a vulnerability

Do not open a public issue containing exploitable details. Use **Security → Report a vulnerability** in the GitHub repository to send a private report through GitHub Security Advisories.

Include the version, operating system, impact, reproduction steps, and a possible mitigation. Do not include real API keys, credentials, or personal data.

## Security boundaries

Alexus confines paths to the real workspace, runs processes without a shell, classifies commands, and stores hash-based checkpoints for undo. These controls reduce risk but do not replace reviewing changes or using version-controlled repositories.

Keys configured with `alexus provider` are stored outside projects in `~/.alexus/credentials.json`, created with `0600` permissions on POSIX systems. Never add this file to a repository or shared backup.
