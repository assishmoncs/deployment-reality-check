# Beta implementation plan

Baseline is `main` at `c199dde`. Use the `beta` branch to validate changes before considering a separate promotion to `main`.

## First beta commits

| Area               | Finding on main                                                                                                                                                     | Beta change and acceptance check                                                                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub Actions     | Push validation runs on main only.                                                                                                                                  | Run CI and Security for beta pushes and PRs targeting beta. Check all six OS and Node combinations, the dependency audit, and CodeQL.                                                                   |
| Railway config     | The TOML parser strips quoted hashes, accepts malformed values, and can write into inherited object state. Command checks miss TOML and some incorrect JSON values. | Use a TOML parser, report syntax errors without source excerpts, and check base build and start command fields in JSON and TOML. Cover quoted hashes, arrays, malformed values, and mixed config types. |
| Platform selection | Fix and verify can fall back to Vercel when the deployment target is unknown. Conflicting config files can be resolved by a framework guess.                        | Prompt in an interactive terminal. In CI and other non-interactive runs, require an explicit platform when the signals conflict or are insufficient.                                                    |
| Verification       | A nested lockfile can select the package manager for a root command. The health probe always requests the root URL.                                                 | Select the root declaration, then the root lockfile, then npm. Accept `--health-path` and verify an app whose root returns 404 while its health endpoint succeeds.                                      |
| Vercel Express     | The listen rule warns on the supported Express port listener pattern.                                                                                               | Recognize Express listeners in documented entry files and keep Railway fixed-port checks. [Vercel Express documentation](https://vercel.com/docs/frameworks/backend/express#using-a-port-listener)      |

## Follow-up milestones

1. **Service-scoped verification and configuration.** Add an explicit service selector, resolve that service's deploy config and environment files, and run its build and start commands in the service directory. Test a frontend/backend workspace with conflicting commands and environment keys.
2. **More transparent scan coverage.** Report file and depth limits in terminal, JSON, and SARIF, and add an opt-in CI setting to fail when relevant files are skipped.
3. **Better patch targeting.** Use source locations to edit individual expressions, group edits to the same file, and test overlapping changes and rejected patches.
4. **Rules for another host.** Add a Render adapter once service selection is stable, starting with representative build/start, port, and disk fixtures. Validate published CLI behavior with an installed tarball and make the supported Node versions explicit.

Run build, type checking, lint, formatting, tests with coverage thresholds, and a package dry run before pushing. A beta change is ready for review when CI and Security pass on the beta commit.
