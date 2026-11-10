# CycloneDX 1.7 schemas

These files are unmodified upstream resources from the CycloneDX specification repository, tag `1.7`, commit `4b3f59453366e27c8073fd24e98bf21ef8892c8e`. The GitHub tag reference was checked against that commit. All four schemas declare JSON Schema draft-07.

Source base: <https://raw.githubusercontent.com/CycloneDX/specification/4b3f59453366e27c8073fd24e98bf21ef8892c8e/>. Schema files are under `schema/`; `LICENSE` is at the repository root. The upstream Apache License 2.0 is included verbatim.

| File                            | SHA-256                                                            |
| ------------------------------- | ------------------------------------------------------------------ |
| `bom-1.7.schema.json`           | `df472ef4aaf593904c479293723a1a5c191d6672715c93b3c0b5c318f3914221` |
| `spdx.schema.json`              | `54a6288292bc6c90b0d3952f5f939f17436fa76704ffe68a46e5b78539c7cc1b` |
| `jsf-0.82.schema.json`          | `8bae002c25e723db7ee1f26afde680ae1a2b1a8f6b4b4b0fd65dc3becb090aae` |
| `cryptography-defs.schema.json` | `018ea7f78b5208ec647cfd10f669cc9c26aba6aceb79c4da7f9c0ef4c99b60de` |
| `LICENSE`                       | `6c29f22a4a7385285c6f579ec9f33c5e989f00739d6b257243a0b082ec9447ae` |

`scripts/validate-cyclonedx.mjs` resolves Ajv 8 and ajv-formats through the declared dependencies of `packages/shared/package.json`. It registers these local resources explicitly, resolves all external references without network access, and rejects missing references, unknown formats, malformed schemas, or unsupported document versions. Schema identifiers are URI names for local resources and do not cause downloads. Only CycloneDX 1.7 is supported; 1.6 documents fail explicitly.

The official `meta:enum` keyword is registered as a documentation annotation; the corresponding `enum` constraints remain enforced. Ajv strict schema checking and format validation are enabled. Date, date-time, and URI validation use ajv-formats in full mode. The IRI-reference supplement checks RFC 3987 generic reference syntax, Unicode ranges, escapes, authority, and IP literals. The international email supplement checks mailbox syntax, quoted/UTF8 local parts, address literals, and domains using Node IDNA conversion. These checks do not establish DNS availability, mailbox existence, URL reachability, or the semantics of individual URI schemes. Regression cases cover accepted and rejected syntax.

Usage from the repository root:

```sh
node scripts/validate-cyclonedx.mjs path/to/box.cdx.json path/to/cli.cdx.json
node --test scripts/validate-cyclonedx.test.mjs
```

Exit status is 0 for all documents passing, 1 for any unreadable/invalid document, and 2 for usage or schema setup failure. Errors include the input filename and JSON Pointer location. Passing demonstrates JSON schema and format conformance only. It does not establish complete component coverage, binary provenance, correct component versions, vulnerability disposition, or legal/license completeness.

When updating, obtain every resource from a single fixed upstream commit, review its reference closure and formats, update these hashes and the byte-integrity test, and run the regression suite and actual artifact SBOM validation. Preserve the upstream JSON bytes and LICENSE.
