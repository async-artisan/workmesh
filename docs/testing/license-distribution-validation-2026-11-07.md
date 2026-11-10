# License distribution validation — 2026-11-07

This evidence records the retained r1 packaging run, a separate r2 archive, and the later r13 artifacts described at the end of this page. Each section preserves its own source and archive boundaries. These runs do not approve a release, establish clean-SHA or remote CI provenance, or establish complete license compliance. The retained archives and their evidence are separate immutable records.

## Inputs and boundaries

- Evidence directory: `G:/workmesh-license-package-validation-20261107-r1`.
- Packaging script SHA-256: `a887444f893728bbdad57ea4254dc87cc7f5edc2c37edd8a5737e45d7fff3f60`.
- License collector SHA-256: `5b8d153028de6f6dd909146b59cd0355d2caad669f4b8a2e73f921464e53e033`.
- Packaged Node: `v24.22.1`; executable SHA-256 `a20f46c2084bb1775275d867370f8f785aec8c9677f8d8aeb5cae4caa2c08a81`.
- Host Node: `v20.19.0`; pnpm: `10.28.2`.
- PostgreSQL was copied from the retained r2 runtime directory; `postgres.exe` SHA-256 `4125c1e963072d929f6468a449ad184b26d3be7d97cae3181c3d613dace49c8d`. Runtime notices were absent in the supplied inputs. No service was started or stopped and no database was opened or modified.
- `package-box.ps1 -SkipBuild` reused the source snapshot's successful uncached workspace builds. This package does not prove the later browser or coverage stages passed.
- 787 package/build input file hashes were recorded before and after packaging. Both JSON files are byte-identical, SHA-256 `a7eae717cd37c4118e8a5af0937bc1dbb596ba8e6b94f49e8d4297ce04ba9852`. This list covers packaging scripts, selected manifests/licenses, and all files in six dist directories. It is not a hash inventory of every source file or every deployed dependency.
- The snapshot contains the QA fixture used for that verifier run. Later changes to the root QA fixture and role-package license metadata are outside these r1 archives.

## Actual archives

| Item                       |       Box | Standalone CLI |
| -------------------------- | --------: | -------------: |
| Archive bytes              | 198182149 |       36728907 |
| ZIP file entries           |     12649 |             85 |
| Expanded bytes             | 494373661 |       96111881 |
| License records            |       159 |              9 |
| Copied text references     |       155 |              8 |
| Unique copied text files   |       142 |              8 |
| Bound bundle output checks |        51 |              2 |

- Box SHA-256: `8b81127ea43d69129c3940133ed22124fde73dbeec0f7e6830085eb4ad8c2019`.
- Standalone CLI SHA-256: `1cbd79c5d56a06a5bc02d64c64bab04db3964aac367fb6cad1d220ff17226a53`.
- The Box's embedded CLI ZIP equals the standalone CLI ZIP byte-for-byte by SHA-256. The outer Box ZIP and its local download copy also have the same SHA-256.

The verifier opened the actual ZIPs and checked the root `LICENSE`, `licenses/index.json`, `THIRD-PARTY-NOTICES.txt`, every referenced text's hash and length, the exact set of copied license text paths, and all sidecar-bound bundle output hashes. The CLI, Web, and shared rendered component records contain MIT texts equal to the root license, SHA-256 `17b2f8cb74534fd3a306e72034dc5014501e2a61d37905008c0fc15154324e0d`.

The packaging smoke also found all six built-in roles and 55 role resources and resolved packaged CLI setup from an unrelated directory. The run exited with code 0. No application lifecycle, new-machine install, upgrade, rollback, or production behavior was tested by this packaging run.

## Coverage remains partial

Both archives explicitly report `PARTIAL_COVERAGE`. Rendered packages and conservative prebundle candidates keep separate labels. Candidate texts are included to avoid dropping potentially required notices; their presence does not prove final inclusion of every candidate package. Native embedded components and virtual/generated modules remain outside complete attribution.

The actual r1 Box has six missing-text records:

- `@napi-rs/canvas-win32-x64-msvc@0.1.80`, physically deployed npm package.
- `@tokenizer/token@0.3.0`, physically deployed npm package.
- `@workmesh/role-packages@1.0.0`, two physical deployment copies. This is a known own-package gap in r1; later fixes require a new archive.
- Supplied Node runtime notices.
- Supplied PostgreSQL runtime notices.

The actual r1 standalone CLI has one missing-text record: supplied Node runtime notices. The runtime collector searches direct notice files in the supplied root and its `doc`, `docs`, and `share` directories; an absent record does not establish that the vendor never supplies a license elsewhere. The remaining npm and native gaps require actual matching vendor/source evidence. These archives are not approved for publication.

## Evidence and negative checks

The stable evidence directory contains:

- `package.log`, SHA-256 `5fb5d331bbb1635a982dc1dba0089bddb5e37786f9a34d9b7f45972dcc8d9113`.
- `zip-license-verification.json`, SHA-256 `1f6f1257e60a3e8a4926d291aabc66cf3584b8a9c6085d570d4e416bdae109ff`.
- `package-inputs-before.json` and `package-inputs-after.json`.
- `runtime-inputs.json`, `run-package.ps1`, and `verify-zip-licenses.ps1`.
- `package/workmesh-box-win-x64.zip`.
- `package/workmesh-box-win-x64/downloads/workmesh-cli-win-x64.zip`.

Verifier selftests are kept separately in `verifier-selftest/`. They rejected the historical archive lacking `licenses/index.json`, a mismatched inner CLI archive, and changed license bytes. Those fixture ZIPs are verifier tests, not release artifacts. Seven focused Node tests also passed, including changed license/manifest/bundle rejection, stage traversal and junction rejection, and deterministic metadata/text output from equivalent stages.

Reruns must use a newly named output directory and a fresh source freeze. The retained runner refuses an existing package output. Do not rerun against r1 or imply that later source edits changed its recorded contents.

## Subsequent provenance investigation and source fixes

The following evidence was gathered after r1 packaging in `G:/workmesh-runtime-license-validation-20261107-r1`. It does not change the r1 archive contents or their missing-text records. A new package and new archive-content validation are required to prove distribution of these texts.

- The official [Node.js v24.22.1 Windows x64 ZIP](https://nodejs.org/dist/v24.22.1/node-v24.22.1-win-x64.zip) hashes to `d2046d28c2c3dcd211ac5145c0bf30e2047ef9dfb306693c8c6e2eccd8b95fa5`, matching the exact official `SHASUMS256.txt`. Its unchanged `node.exe` hashes to `d702daa815eabbff763c7d3808e235cf031cf2ca70211b56847bc72f51e240e5`; its complete distribution `LICENSE` is 160555 bytes, SHA-256 `ed34dd8e3f0a78dbaf00d0444ce8e285b015b765379c2e17880455f70370f8e9`. They are retained together under `official-node-distribution/`. This executable differs from r1's supplied executable, which has another valid signer. Equivalence of those executable payloads was not established. A future package can use the checksum-verified official executable directly.
- The retained original `G:/yesgoo/workmesh/.tmp/pgclient/pg17.zip` hashes to `6eabdf00d2893713b75db4336a23c3fdf505f056e217ec6e2e95d901750cfea3`. All 1512 files in the supplied trimmed PostgreSQL runtime match entries in that archive by hash and length. Its `pg_config.h` declares PostgreSQL 17.11. The same archive contains `server_license.txt` (1388 bytes, SHA-256 `39294f3f5b41533b307e118ee37c356f32cbc7746fc97e8b91f1b49a9068a24e`) and `commandlinetools_3rd_party_licenses.txt` (64981 bytes, SHA-256 `72aee4dccdecefede32f1268e1ba638a7424a30f8e6de1b10bc22ba27426f177`). This proves the local distribution association; the original download URL or vendor signature of that retained archive was not recovered. The collector now explicitly recognizes those two vendor basenames when given the full original PostgreSQL root.
- The exact registry tarball for `@napi-rs/canvas-win32-x64-msvc@0.1.80` matches its registry SHA-512 integrity and SHA-1, and all four installed files match tarball contents. The registry's git revision is `dda1b258dac667b4c66b94bbd4d70aa79ea4503a`; the [platform package manifest at that revision](https://raw.githubusercontent.com/Brooooooklyn/canvas/dda1b258dac667b4c66b94bbd4d70aa79ea4503a/npm/win32-x64-msvc/package.json) exactly matches the installed manifest. The [project LICENSE at that same revision](https://raw.githubusercontent.com/Brooooooklyn/canvas/dda1b258dac667b4c66b94bbd4d70aa79ea4503a/LICENSE) is retained unchanged with SHA-256 `8802fecf9da4367bc23bcf20b21cc143785fc6c92b152f3fa7fbe6ce08d344d6`. Source integration copies it only for the matching package name, version, manifest hash and declared license and emits its exact source URL/revision. This project license does not enumerate embedded Skia, ICU, or other native notices.
- The exact registry tarball for `@tokenizer/token@0.3.0` also matches registry integrity and all three installed files. Its existing `README.md` contains the complete MIT license text; the exact file is 1451 bytes, SHA-256 `a88c936c259cc261d5b37a2433735e9819e01f824bdc26e644d46ccd3055c8d7`. The source collector now copies that installed file unchanged only after package identity, manifest hash, file hash/length and the license-section structure match. No license was borrowed from another package or version.

The integrated supplemental records use stable relative paths, exact public source URLs and hashes in `scripts/vendor/license-texts/provenance.json`. They do not modify installed `node_modules`. Eleven focused tests passed, including changed supplemental bytes, mismatched manifests, non-exact upstream revisions, missing license sections, PostgreSQL vendor notices, existing bundle guards, traversal guards and deterministic output. ESLint and formatting also passed. The output status remains `PARTIAL_COVERAGE` even if a future package has zero missing-text rows: complete native attribution and compliance are separate unresolved requirements.

## R2 actual archive and lifecycle supplement

The separate evidence directory is `G:/workmesh-license-package-validation-20261107-r2`. This run used the official Node executable and matching distribution `LICENSE` identified above, and the full retained PostgreSQL root with its two matching supplier notice files. Host Node was `v20.19.0`, pnpm was `10.28.2`, and packaged Node was `v24.22.1`. `package-box.ps1 -SkipBuild` reused the built source snapshot. This supplement does not rewrite the r1 hashes, input inventories, missing-text records or packaging-only scope. It is a later document update and is not retroactively bound to a prior source-freeze manifest.

The actual r2 ZIP verifier completed with `PASSED`:

| Item                       |       Box | Standalone CLI |
| -------------------------- | --------: | -------------: |
| Archive bytes              | 198284290 |       36764850 |
| ZIP file entries           |     12657 |             86 |
| Expanded bytes             | 494846773 |       96474384 |
| License records            |       159 |              9 |
| Copied text references     |       162 |              9 |
| Unique copied text files   |       148 |              9 |
| Bound bundle output checks |        51 |              2 |
| Runtime notice checks      |         2 |              1 |
| Missing-text records       |         0 |              0 |

- Box: `package/workmesh-box-win-x64.zip`, SHA-256 `239abf9b446ae04823a362f17088fe42699d61300c627704f73752046ef2d9aa`.
- Standalone CLI: `package/workmesh-box-win-x64/downloads/workmesh-cli-win-x64.zip`, SHA-256 `d0ccfeaa4f0f50e91f8bab33f7bb4fbbe5ad793ba8db7ebe509a3e74d06df7ed`. The Box's embedded CLI ZIP has the same hash.
- `zip-license-verification.json`: SHA-256 `a0c9e35919cfbe459953bfe7bf513fa95cd9fdf7f5f3257c7acb4c90acd1a7cc`. Its direct archive checks cover project MIT, referenced text bytes and file sets, bound bundle outputs, deployed shared/role-package MIT texts, runtime notices and the two supplemental package texts.
- All 925 selected packaging/build input records were unchanged before and after packaging; both JSON inventories hash to `9a0166b1440403628ad6161c51304c6d422d7fb218e9efb28d5cdcde55c2beda`. All 1567 recorded runtime inputs were also unchanged; both runtime inventories hash to `69c6cd159387d558b2030d6253d6c3c4ed0e59b9a67be41ecab22f51c6fbac3b`. These are selected input inventories, not a complete source/dependency provenance claim.

The isolated local Windows lifecycle run used this same Box hash and passed first start, cold start, idempotent start and restored-database health checks. Each phase reported API/proxy `ok` and Web HTTP 200. It applied 20 migrations, backed up 55 tables, restored a marker with an exact match, removed its verification database, and stopped the services it owned. `lifecycle/summary.json` has status `PASSED` and SHA-256 `478bc0f806251567270864061ba5f0cd9b63bf871ff3495af74cb596ff564cc9`. This is existing evidence from the lifecycle runner; the document update did not repeat database or service operations. The run does not establish clean-machine installation, prior-version upgrades, uninstall, production-data safety, capacity or cross-platform behavior.

## R2 corrected artifact-inventory scan

The first scan's `artifact-sbom/` and `scan.log` remain retained as failed evidence: the CLI bundle merge rejected its archive-relative bundle directory. The corrected run used a separate `artifact-sbom-r2/` output and exited 0. Both corrected CycloneDX files passed the offline CycloneDX 1.7 JSON schema and format checks. The corrected manifest, `artifact-sbom-r2/artifact-sbom-draft.json`, hashes to `614380e0d44c2387c609cebf09f38c8167421b84210b60a3aea69c6f19a8ec4b` and explicitly remains `DRAFT_PARTIAL_COVERAGE`. The scan invocation records source commit `739367a714097a825b96ca7ecf6bce3372855a77` with source-tree state `dirty`; those are caller-declared metadata, not verified clean-checkout or build provenance.

The retained corrected inventory reports:

| Evidence                                       |   Box | Standalone CLI |
| ---------------------------------------------- | ----: | -------------: |
| Syft native inventory component records        |   276 |              1 |
| npm records within that native inventory       |   160 |              0 |
| Records with `UNKNOWN` versions                |    23 |              0 |
| Rendered bundle modules represented by merger  |   155 |             35 |
| Rendered component identities used by merger   |    10 |              3 |
| Components added by conservative bundle merger |     8 |              3 |
| Existing components matched by merger          |     3 |              0 |
| Final CycloneDX `file` components              | 12657 |             86 |
| Final CycloneDX `application` components       |   116 |              1 |
| Final CycloneDX `library` components           |   168 |              3 |

File components represent archive files and must not be counted as software packages. The native scanner's counts and the final merged CycloneDX counts describe different stages. Directly rendered bundle identities add bounded evidence; prebundle candidates, generated/virtual modules and complete native dependency relationships remain unresolved.

Both r2 license indexes still declare `PARTIAL_COVERAGE` despite zero missing-text rows. The canvas text is the exact revision's project MIT license and does not enumerate embedded Skia, ICU or other native notices. Node/PostgreSQL PE records and copied supplier notices do not establish a complete embedded-component SBOM or license review. The 23 `UNKNOWN` version records, complete native attribution, dependency relationships and license completeness still need review. PostgreSQL's retained archive remains locally hash-bound to its supplied files and notices, but its original download URL and vendor signature are unverified. Schema validation, local lifecycle success and zero missing-text rows do not close those gates or approve publication.

## R13 frozen-source artifacts — 2026-11-10

The new evidence root is `G:/yesgoo/workmesh-validation/20261109-r13/`. `package-r1/` was generated with `-SkipBuild` from the successful full-verification production outputs of the 915-file r13 source freeze at `G:/workmesh-verify-validation-20261109-r13/source`. Its source-manifest SHA-256 is `d5f9c6c7afd9e73fd9a2fa85a2cacb1cf07a5c932b22d4921c4cdc7308aa596b`; the selected 807 production-output/runtime input records are bound by `package-inputs.json`, SHA-256 `63e94f9dc3e3545115e5373fc4070f0bfb9675d4eb3670d958abacf18067ac2e`. Source and selected-input postchecks after packaging and lifecycle exited 0. The declared source is still `739367a714097a825b96ca7ecf6bce3372855a77` plus a dirty snapshot, version `1.0.0`. Later live-workspace edits and this document update are outside that freeze.

| Actual archive evidence                                             |               Box | Standalone CLI |
| ------------------------------------------------------------------- | ----------------: | -------------: |
| Archive bytes                                                       |         182814742 |       29047254 |
| ZIP file entries                                                    |             12679 |             86 |
| Expanded bytes                                                      |         463718674 |       73582027 |
| License-index records                                               |               159 |              9 |
| Deployed npm / rendered bundle / candidate / runtime notice records | 136 / 11 / 10 / 2 |  0 / 3 / 5 / 1 |
| Missing-text records                                                |                 0 |              0 |
| Text references checked, excluding root project LICENSE             |               162 |              9 |
| Unique text files checked, excluding root project LICENSE           |               148 |              9 |

The Box SHA-256 is `09d0d2baf4175a96970be9db3c48879b4ad0887cb480420829f1b53eb6a6c3d3`; the independent CLI SHA-256 is `7c06512dbc1264e46570e6992bd73a75aa7cc85d72862daae2348b27bd840337`. They are located at `package-r1/workmesh-box-win-x64.zip` and `package-r1/workmesh-box-win-x64/downloads/workmesh-cli-win-x64.zip`. The Box's embedded CLI ZIP has the same hash as the independent input. Fresh extractions under `scan-inputs-r1/` were fully compared to their archive file sets, lengths and SHA-256 before and after the fixed-Syft scan. These extractions are independent of the mutable packaging stage and lifecycle installation.

The post-scan review recomputed every license-index text reference's bytes and SHA-256, including the root project LICENSE: Box 163 references / 149 unique paths and CLI 10 / 10, all matching. These counts include one root project LICENSE beyond the table above; they are text-reference checks, not counts of unique software dependencies. The actual license-index hashes are `e7acde417356221ea7c1fcba180be3b974ba51961d762a775781e351812c2e99` (Box) and `26bae0aef2f619c5431741422d1467141c415087c956ebeffc2e521426bee8e6` (CLI). The review is retained as `scan-r1-review-summary.json`, SHA-256 `d8f53bd9c68ad7619ceb097b9c82a6064a1a9aa87a445c08852caa5c54368d22`.

Host and packaged Node are now both 20.19.0. The packaged executable is from the fixed official Windows x64 distribution, SHA-256 `6e3a39787e667d50487f7335c85636c2823a53e636d73c2c841d45da4e57906c`; its matching 115480-byte LICENSE is `3716cab1c1ca53b1be9481b6d20bd8e00a4b9561d1b77427fd95e17aad6fc17e`. This does not retroactively change r1/r2's Node 24 evidence. PostgreSQL 17.11's supplier notice hashes remain `39294f3f5b41533b307e118ee37c356f32cbc7746fc97e8b91f1b49a9068a24e` and `72aee4dccdecefede32f1268e1ba638a7424a30f8e6de1b10bc22ba27426f177`; this run did not independently recover or verify the PostgreSQL original download URL or vendor signature.

The fixed Syft 1.57.0 scan exited 0 and both merged CycloneDX 1.7 documents passed offline schema/format validation. Box still contains 23 `UNKNOWN` version records; CLI contains none. Conservative rendered-bundle merging adds 8 Box and 3 CLI components. File components must be excluded when counting software: final Box has 284 non-file components plus 12679 files; CLI has 4 plus 86 files. The non-file components without machine-readable license data number 145 and 4 respectively, even though the packaged text indexes have zero missing-text records. These are different evidence formats; neither count alone establishes compliance. Exact scan hashes are recorded in [the r13 artifact scan](artifact-sbom-validation-2026-11-07.md#r13-同源完整验证后新制品2026-11-10).

The same Box hash passed the isolated Windows lifecycle: 20 migrations, first/cold/idempotent/restored-database health, 55 backup tables including the validation marker, exact restored-marker match, verification database removed, and owned services stopped. `lifecycle-r1/summary.json` is `PASSED`, SHA-256 `1883acfca14bef015d2fe07fea0d3255a4c47c334d3c372d75a340966943cf0b`. This document update only read that result; it did not repeat database operations. It is not clean-machine, prior-version upgrade, uninstall, production-capacity, cross-platform, final clean-SHA or remote-CI evidence.

Both license indexes remain `PARTIAL_COVERAGE`; artifact inventories remain `DRAFT_PARTIAL_COVERAGE`, and module sidecars remain `PARTIAL_MODULE_EVIDENCE`. Native embedded components, canvas/Skia/ICU notices, generated/virtual attribution, prebundle final inclusion, exact unknown binary versions and full license obligations remain open. Scan logs and lifecycle data/logs are private diagnostics, not approved public-release assets. No release was published by this validation.
