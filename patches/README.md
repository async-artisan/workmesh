# Local dependency patches

`deepmerge@4.3.1.patch` mitigates GHSA-gcqx-w48m-w2h4 in the source, CommonJS and UMD entry points. The three writes into the result now define own enumerable, writable, configurable data properties instead of invoking inherited setters. This preserves ordinary merge/array/symbol/clone behavior and permits an own `__proto__` data property without changing the result prototype. It does not change the package version or suppress the version-based audit advisory. Keep the upstream MIT license in the installed package.

Run `node --test patches/deepmerge.test.mjs` after frozen installation. Tests resolve the actual Nest CLI → fork-ts-checker-webpack-plugin → deepmerge installation, exercise both distributed runtime entry points, and cover target/source/nested prototype poisoning plus supported configuration merges. The installed source entry uses the same patch; its development-only `is-mergeable-object` dependency is not installed at runtime. Patch bytes are protected from automatic line ending conversion by `.gitattributes`.

The patch is repository-maintained mitigation pending an upstream fixed release. It is not an upstream security release, legal approval, or an audit exemption. Reassess and remove it when an upstream fix can be adopted with equivalent regression evidence.
