# 旧 Box 制品 UNKNOWN 分类核查（2026-11-07）

本记录仅适用于 SHA256 为 `ff80618f58e2eb2c6f7b592a4abd0d01e06603c6f9d07802f2efa011b28b10bf` 的旧 Windows Box ZIP。其 Syft 清单中的 **23 条 UNKNOWN 已逐项核查：18 条为缺少独立版本字段的 npm 子路径描述，能够关联到同制品内两个已知版本的父包；5 条为缺少可用版本资源的 PE 二进制，精确二进制版本继续未知。** 这是附加分类记录，原 Syft/CycloneDX 和 manifest 未改写；原始 UNKNOWN 数仍为 23，SBOM 状态仍为 `DRAFT_PARTIAL_COVERAGE`。

后续重新构建的 ZIP 必须按新 SHA 重新核查，不能沿用本记录作为新包验收。这里没有完成制品整体许可审查、完整组件覆盖、漏洞判定或发布验收。

## 输入绑定与核查方法

本机验证根目录为 `G:/workmesh-login-validation-20261107-r1/`，以下是本次重新计算的 SHA256：

| 输入                         | 本地相对路径                                      | SHA256                                                             |
| ---------------------------- | ------------------------------------------------- | ------------------------------------------------------------------ |
| 旧 Box ZIP，197,721,487 字节 | `package2/workmesh-box-win-x64.zip`               | `ff80618f58e2eb2c6f7b592a4abd0d01e06603c6f9d07802f2efa011b28b10bf` |
| Syft 1.57.0 的归一化 JSON    | `artifact-scan/evidence/workmesh-box.syft.json`   | `40a2e2cd8f325d2f560e3ebcc09c6e8e116b3cab91a57d0cd2df83732b4b56de` |
| 原有扫描 manifest            | `artifact-scan/evidence/artifact-sbom-draft.json` | `7f8ec6872d939c09617130417a5a81fd9d3d7653f82109ba7310f1d8c0381c3d` |

从上述 Syft JSON 筛选 `artifacts[].version == "UNKNOWN"`，得到 18 条 `npm`、5 条 `binary`；全部 23 条只有一个主证据位置，`licenses` 均为空。npm 来自 `javascript-package-cataloger`，binary 来自 `pe-binary-package-cataloger`。

实际解压根目录为 `G:/workmesh-login-validation-20261107-r1/artifact-scan/box/`。对 23 个主证据文件及下列 11 个父包/许可/说明文件，分别读取实际解压文件和旧 ZIP 对应的精确 entry，核对长度与 SHA256；**34 个选定文件均匹配**。这里核查的是选定文件，没有重新声明全 ZIP 12,484 个文件的完整核对；全量扫描的既有证据另见[制品 SBOM 验证](artifact-sbom-validation-2026-11-07.md)。

核查使用 `Get-FileHash -Algorithm SHA256`、`.NET ZipFile.OpenRead`/entry stream、JSON 字段及文本读取，未运行制品内 EXE/DLL，未访问远程包注册表或下载供应商资料，未启动服务。源 manifest 的提交号是调用者声明且工作树为 dirty，文件哈希只证明本次输入字节绑定，不证明可复现构建、上游来源或签名真实性。

为缩短表格，以下路径前缀均以制品根目录为起点；每个表中的路径相对于其对应前缀：

| 前缀 | 制品内完整目录                                                                         | 父包身份（读取实际 package.json） | Syft 父记录 ID     |
| ---- | -------------------------------------------------------------------------------------- | --------------------------------- | ------------------ |
| L    | `app/api/node_modules/.pnpm/libphonenumber-js@1.13.15/node_modules/libphonenumber-js/` | `libphonenumber-js` / `1.13.15`   | `97bb2ade2ac0f864` |
| R    | `app/api/node_modules/.pnpm/rxjs@7.8.2/node_modules/rxjs/`                             | `rxjs` / `7.8.2`                  | `37ef635265a60419` |
| P    | `app/api/node_modules/.pnpm/@prisma+engines@5.22.0/node_modules/@prisma/engines/`      | `@prisma/engines` / `5.22.0`      | `a98515d40f1bd212` |

## 18 条 npm 子路径描述

这些子 `package.json` 实际包含 `name` 及模块格式、入口或 exports 等字段，均没有自己的 `version` 或 `license`。L 下 13 条均声明 `private: true`；R 下 5 条未声明 `private`，不能因其位于子目录就补写该字段。版本关联来自同制品中的真实父 `package.json`，并非仅根据 `.pnpm` 目录名推断。

L 的根 exports 明确声明 core/min/max/mobile、对应 es6 入口以及 metadata/examples 子路径；`build/package.json` 是 `type: commonjs` 的内部目录描述。R 的根 exports 明确声明 ajax/fetch/operators/testing/webSocket，子描述的入口也指向同父目录 `dist/`。这些证据支持记录“属于父包版本的子路径入口”，不支持把每个子路径改写成一个独立发布且版本已确定的 npm 包，也不能据此直接删除扫描组件或改写组件总数。

下列 18 条的扫描版本全部保留为 `UNKNOWN`。L 组附加 `parent = libphonenumber-js@1.13.15`；R 组附加 `parent = rxjs@7.8.2`。SHA256 为表中实际子 manifest 的内容哈希，并已与 ZIP entry 匹配。

| 前缀/实际子 manifest             | Syft 记录 ID       | 字节数 | SHA256                                                             |
| -------------------------------- | ------------------ | ------ | ------------------------------------------------------------------ |
| L `build/package.json`           | `e95791da1510c948` | 80     | `1ff5dc28b3a1e140f3bbae2c61397f1d6d8c566b10f57ca3291eb152591637fc` |
| L `core/package.json`            | `11a76c78b55f4b3c` | 247    | `ce91bc6510390966d40f33b554dca4e71b4aa8a47b2462ea91d12a63af5474cf` |
| L `core/es6/package.json`        | `7eef0437e9da8323` | 203    | `fe9c6e4409d711a1a35a4024a4f4e26359c117fce2dda4884d333959e3303693` |
| L `max/package.json`             | `b27eedcbe4a9096f` | 246    | `26693ea054cf36ca22f0b66be447f5b619c625a369ea8a4268a54d1e803602b6` |
| L `max/es6/package.json`         | `465c80b03085b594` | 202    | `8c093f6e3c0ba64021181ea43408673f47e8c7eaa879c5dac5eafc0ca62617c7` |
| L `max/metadata/package.json`    | `d1c2c76232ed860b` | 381    | `0e84c354cfa5ab71cf3b79fb26cddd62010bf90726406c9e9514c308ec341f33` |
| L `min/package.json`             | `40185436f9582ca2` | 246    | `2fe05de9bf31512bfacc06c8dff0f154eeb67aa3ad7cb18522e1862f08d5c54b` |
| L `min/es6/package.json`         | `bad3cc81ecbd424f` | 202    | `3d2ce80c1f6ff48b350ef3dcafaebd92271bcf7af841b6020aa64f3997c2aa99` |
| L `min/metadata/package.json`    | `8d8f794bd07f2406` | 381    | `621ce4a940d9a2137b13b313576efef735683d828102f3446aff0f44f63c3989` |
| L `mobile/package.json`          | `aa7000d02e0a5203` | 249    | `e115dccceaeb5397c8eda90f6fb349a925b3bbb6c75ccdea9e2fde0c6f02c92e` |
| L `mobile/es6/package.json`      | `c80038a1782afe2c` | 205    | `563399c08fb46696dd77565367bfcc1563fe7d3f5f5151a98fb81a60cad25f6d` |
| L `mobile/examples/package.json` | `23d13c2a4fbd86d4` | 402    | `b3ebfba9bb5d0e97e269904676b54b935e77b77f3cd09b2cebe0733ff8454b3d` |
| L `mobile/metadata/package.json` | `323ee3e945c827a1` | 402    | `493383783f1448f8e5d3428b45fc80a324db41a77130d61281d6e9feb411d94b` |
| R `ajax/package.json`            | `2a8e4b7072c8f67b` | 216    | `a1d5789b3326db9d728c41641bc68c645198384f59c814bd0d7c0f2096e73913` |
| R `fetch/package.json`           | `5105dbb609587764` | 221    | `37a7e1a0956e8e3c2df2e995e5529da5d3257ed5f2ba40048417ddee866f2591` |
| R `operators/package.json`       | `fb87720b43e8774b` | 241    | `a91d2f973f8f500a81d385d6c92b68b1ffe22a37b87e24fdb0c9bfb85e63d14c` |
| R `testing/package.json`         | `fcdd4b2e16b78db4` | 231    | `4a14182ff4d487fa27a49ee302e03ff4a6ce63a399ce63812d83f6157ff772f6` |
| R `webSocket/package.json`       | `e122c488d9932d7a` | 241    | `ee53a1fd12d7bf02ffc81bbf1b7a80b252e7081a6b13c119c2f764d393dc734c` |

## 5 条 PE 二进制

以下 5 条 Syft `metadata.VersionResources` 均为 null。对实际文件只读检查也没有可用的 `FileVersion`、`ProductVersion`、`CompanyName` 或 `FileDescription`。文件名、同目录产品版本、父 npm 版本、PostgreSQL 扩展 schema 版本均不能替代二进制自身的版本证据。

| Syft 名称 / ID                               | 制品内路径                              | 字节数     | SHA256                                                             |
| -------------------------------------------- | --------------------------------------- | ---------- | ------------------------------------------------------------------ |
| `icutu67` / `0d96e7895ca6dc9a`               | `runtime/pgsql/bin/icutu67.dll`         | 220,672    | `371c4784b5510b8e80a6b5896567b17bc70e231ea47ee8f614a7ebd3d510960f` |
| `libxslt` / `fef66625a2205095`               | `runtime/pgsql/bin/libxslt.dll`         | 414,208    | `8226fad0fc6e9b79b14203d4f5263ddec5764c0108aa7c17622dd77f311669a6` |
| `plugin_debugger` / `0b989bccc068216e`       | `runtime/pgsql/lib/plugin_debugger.dll` | 61,440     | `cc7c184bd7a4d8f4c58a3c3c59716bfb63ff41e3845e1e27288dab96b6ca9d02` |
| `schema-engine-windows` / `e9e00b4806731f67` | P `schema-engine-windows.exe`           | 18,145,792 | `a7d949e16cc5937aa77d67888c8993118ef16c764e536e9ed7c17cfe61bb65ad` |
| `system_stats` / `a83e12abb7b3a031`          | `runtime/pgsql/lib/system_stats.dll`    | 38,912     | `b7dac1d0506fb51d33a756f2f4d7be4b7b8e232ac790ef59ac2c6f363901bc6b` |

可追加的归属证据及其边界：

- `schema-engine-windows.exe` 位于真实 `@prisma/engines@5.22.0` 包内。P `README.md` 明确说明 postinstall 下载 Query/Schema Engine，下载版本取决于 `@prisma/engines-version` 依赖。该父包声明的依赖为 `5.22.0-44.605197351a3c8bdd595af2d2a9bc3025bca48ea2`；这是父包声明，未执行 EXE、核对供应商二进制构建或远程校验，不能据此填入该 EXE 的版本。
- `plugin_debugger.dll` 有同制品 `runtime/pgsql/share/extension/pldbgapi--1.1.sql` 的明确 `$libdir/plugin_debugger` 函数引用，可关联到该调试扩展。相邻 `pldbgapi.control` 描述 pldebugger，`default_version = '1.1'`，但 `module_pathname` 是 `$libdir/pldbgapi`；真正指向本 DLL 的证据是 SQL 引用。`1.1` 是扩展 schema 版本，不能当作 DLL 构建版本。SQL 头部声明 EnterpriseDB copyright 及 Artistic License v2.0，可保留为关联 SQL 的许可证据。
- `icutu67.dll`、`libxslt.dll`、`system_stats.dll` 目前只有其随此 PostgreSQL runtime 分发的路径归属。该 runtime 根仅有 bin/lib/share；对相关 share 文件名的限定核查未得到能将精确二进制 SHA 映射到供应商版本或许可证的配套说明。三者的精确身份/版本/许可映射继续未知，不从 `67` 或库名推断版本，不把 PostgreSQL 总许可自动套用到这些文件。

## 可以补充的父包与许可证据

以下 11 个支持文件同样已逐一核对实际解压文件和旧 ZIP entry 的长度与 SHA256。它们支持附加父级声明或关联文本，未把 23 个原始空 `licenses` 字段改写为已验证结论。

| 文件                                              | 字节数  | SHA256                                                             | 可支持的事实                                                                       |
| ------------------------------------------------- | ------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| L `package.json`                                  | 12,332  | `e39f5c557a8907ed21bdd4891862b5a46f2f5e09468d720192aa382339f0c36d` | 父 name/version 为 libphonenumber-js/1.13.15；声明 MIT；包含上述 exports           |
| L `LICENSE`                                       | 1,108   | `ea6fc5fe0f905c5fdedd8f160f1dd73ce739004fc5f35656b35258aea126dbde` | 实际随包分发的 MIT 文本                                                            |
| L `LICENSE.Apache`                                | 10,172  | `59899c6091b540582ed617e8eeaac4919dc985ccfc35459ee9752b699be5205b` | 同包另有 Apache 2.0 文本                                                           |
| L `README.md`                                     | 110,493 | `2ff6eb3083e2ce9c4802b2c27b80ba095091c048e9497c1889b8297e41ba523e` | 原文件 2104–2110 行 License 段说明 Google libphonenumber 为 Apache 2、本库为 MIT   |
| R `package.json`                                  | 8,116   | `2399f5d968d1d693ecd206e7972fd26cb7e3daa45931ecc12202b3a924be38b7` | 父 name/version 为 rxjs/7.8.2；声明 Apache-2.0；包含上述 exports                   |
| R `LICENSE.txt`                                   | 11,064  | `81c407ac717813b0e3795402960e04003c7bba8ba59b621624707028531c9ade` | 实际随包分发的 Apache 2.0 文本                                                     |
| P `package.json`                                  | 1,088   | `eaa81442c1a545b8fb22720a6b50fb4d7e354608590ef0c9384f18755fdfc465` | 父 name/version 为 @prisma/engines/5.22.0；声明 Apache-2.0 及 engines-version 依赖 |
| P `LICENSE`                                       | 11,357  | `c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4` | 实际随父包分发的 Apache 2.0 文本                                                   |
| P `README.md`                                     | 740     | `aba404ddff047bce44cecb3349f78155832d70a327e7b33b974c29d671c0099b` | 父包下载 engine 的说明及版本来源声明                                               |
| `runtime/pgsql/share/extension/pldbgapi.control`  | 186     | `9971a08cfff4a1e2b7934989238a0dc432ecf45250543b1faf47b0fd85348c58` | pldebugger 描述与 schema default_version=1.1                                       |
| `runtime/pgsql/share/extension/pldbgapi--1.1.sql` | 7,623   | `52a1b3715770cf22496c832525e3fca18faf338499a0dd80c08d1d6bfc97ba46` | plugin_debugger 的明确函数引用及 SQL 头部 Artistic License v2.0 声明               |

因此，可为 L/R 的 18 条子路径记录补充父组件关联、父组件声明的版本/许可、实际随包分发的许可文本及其哈希；可为 Prisma EXE 补充父包归属和父许可文本。应将这些字段标记为父级证据，保留扫描器的原始版本与空许可字段。不能由此宣称已经验证所有子文件的许可适用范围、Apache NOTICE/归属义务、第三方代码或电话元数据来源；也不能将 SQL 的 Artistic 声明直接外推为 DLL 的完整许可。

## 后续完成条件

1. 对每个重新构建的实际 ZIP 重新扫描并绑定 SHA；确认这 23 个记录的路径/文件哈希是否仍相同，保留新旧分类差异。
2. 将已核实的父子关联作为有来源的附加证据纳入后续清单，不静默替换 UNKNOWN、伪造独立 npm 版本或从文件名生成二进制版本/PURL/CPE。
3. 对 5 个二进制补供应商 SBOM、发布档案、源构建信息或可验证的二进制摘要映射；在证据不足时继续保留 UNKNOWN。供应商文档能关联到某组件，不等于已关联到本 ZIP 的精确二进制哈希。
4. 完成制品级许可/NOTICE/第三方来源审查、CLI/Web bundle 组件覆盖、依赖关系和完整 CycloneDX schema 校验后，再评估完整 SBOM 门禁。当前分类记录不改变上述未完成状态。

## 新 Box 制品的独立复核（029bbab，2026-11-07）

本段追加核查新 ZIP，保留前述旧包证据及当时的完成条件。新包验证根目录为 `G:/workmesh-shared-ip-validation-20261107-r1/`，实际解压根目录为该目录的 `artifact-scan/box/`。本轮重新计算的三个输入哈希均与指定值一致：

| 输入                         | 本地相对路径                                            | SHA256                                                             |
| ---------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------ |
| 新 Box ZIP，197,865,504 字节 | `package/workmesh-box-win-x64.zip`                      | `029bbab62a26a4e168d96bb23d4a1525e015972942f5f4f252d7a3a0213e102d` |
| 新 Syft JSON                 | `artifact-scan/evidence-final/workmesh-box.syft.json`   | `a99301bfb32f1ccd4ac11e65ddd468851b7a695e3d08eb7650db13dceba1c132` |
| 新扫描 manifest              | `artifact-scan/evidence-final/artifact-sbom-draft.json` | `82b2466f2631b67b135782255a007d28f9fc2d5fa04b57253cd39264fc06a631` |

本次直接读取新 Syft JSON，重新筛选 `artifacts[].version == "UNKNOWN"`，没有从旧记录复制条目集合。得到 23 条 UNKNOWN，其中 18 条 npm、5 条 binary；每条只有一个主证据位置，23 条的 `licenses` 均为空，5 条 binary 的 `metadata.VersionResources` 均为 null。

对新筛出的 23 个主证据路径，加上前文明确列出的 11 个支持文件，重新打开新 ZIP 和旧 ZIP 的精确 entry，分别计算内容 SHA256，并与各自实际解压文件的 SHA256、长度核对。新旧 UNKNOWN 记录按名称、类型和主证据路径关联，再比较 ID；未假设新 ID 必然稳定。结果如下：

| 核查项目                                | 实际结果                                  |
| --------------------------------------- | ----------------------------------------- |
| 新 ZIP 与新解压主证据文件               | 23/23 个文件长度和 SHA256 一致            |
| 新 ZIP 与新解压父包/许可/说明文件       | 11/11 个文件长度和 SHA256 一致            |
| 旧 ZIP 与旧解压对应文件的重新核对       | 34/34 个文件长度和 SHA256 一致            |
| 新旧 ZIP 中这些选定文件的内容比较       | 34/34 个文件长度和 SHA256 相同，变化 0 个 |
| 新旧 UNKNOWN 名称、类型、主证据路径集合 | 23/23 条一一匹配，没有增删                |
| 匹配后的新旧 UNKNOWN 记录 ID            | 23/23 条相同                              |
| 三个父组件的名称、版本、记录 ID         | L/R/P 与前文相同                          |

因此，前文两张 UNKNOWN 明细表中的 23 个 ID、制品内路径、字节数和 SHA256，以及支持文件表中的 11 个哈希，也已在新 ZIP 上逐项重新证实；表中 L/R/P 路径前缀仍适用。这是对选定文件的实际字节比较，不能解释为新旧 ZIP 整体内容相同，也没有重新声明所有归档文件均已完成本轮核对。

新包分类结论保持为：L 下 13 个无独立版本字段的子 manifest 可关联父包 `libphonenumber-js@1.13.15`；R 下 5 个可关联 `rxjs@7.8.2`。Prisma EXE 可关联父包 `@prisma/engines@5.22.0`，debugger DLL 有相同 SQL 的明确引用；5 个二进制的精确版本继续 UNKNOWN。三个父包 manifest、许可文本、README 和扩展 SQL 均与旧包字节相同，父级及关联 SQL 的许可证据可按前述边界补充。

**新扫描的 23 条 UNKNOWN 及其空许可字段全部保留，未改写扫描文件或将其宣称为许可审查完成。** MIT/Apache 父级声明不能代替每个子文件或电话元数据的适用性审查，SQL 的 Artistic 声明不能直接外推为 DLL 的完整许可，父包版本与扩展 schema 版本也不能填入二进制版本。完整 SBOM、许可/NOTICE 及供应商二进制来源证据仍需分别完成；本段只确认上述分类在精确 SHA 为 `029bbab62a26a4e168d96bb23d4a1525e015972942f5f4f252d7a3a0213e102d` 的新包上经过独立复核。

## 质量门禁修正后新 Box 的三轮复核（96d555，2026-11-07）

本段只追加对最新实际 ZIP 的独立复核，不改写前两轮记录。新验证根为本机 `G:/workmesh-quality-validation-20261107-r2/`，新解压根为其 `artifact-scan/box/`；重新计算并读取的输入如下：

| 新输入                    | 本地相对路径                                      | SHA256                                                             |
| ------------------------- | ------------------------------------------------- | ------------------------------------------------------------------ |
| Box ZIP，197,865,930 字节 | `package/workmesh-box-win-x64.zip`                | `96d555cd90526eee9b3ad6aaf541fdb2d1bbb604d6b155c26f3e1a70b24ec49e` |
| 新 Syft JSON              | `artifact-scan/evidence/workmesh-box.syft.json`   | `1e07ed75ec2f56e0b6c23a99b39dbe01551e8d46ff2b57c796eea336b7110f8d` |
| 新扫描 manifest           | `artifact-scan/evidence/artifact-sbom-draft.json` | `1fa18dc4c0eb507768218589650e70b2db9acf7a8d333ef5f1c1dd3da73ad874` |

直接读取新 Syft JSON 并重新筛选 `artifacts[].version == "UNKNOWN"`，得到 **23 条 = 18 条 npm + 5 条 binary**，每条均只有一个主证据位置，23 条 `licenses` 仍为空，5 条 binary 的 `metadata.VersionResources` 仍为 null。新 UNKNOWN 名称、类型和主证据路径集合分别与 `ff80618f…`、`029bbab6…` 两份真实 Syft 清单比较；随后独立比较匹配记录的 ID，没有假设记录 ID 必然稳定。

本轮同时重新打开三份实际 ZIP：原 `G:/workmesh-login-validation-20261107-r1/package2/workmesh-box-win-x64.zip`、前轮 `G:/workmesh-shared-ip-validation-20261107-r1/package/workmesh-box-win-x64.zip` 和本轮新 ZIP。针对新筛选得到的 23 个主证据路径及前文明确列出的 11 个支持路径，逐一读取每份 ZIP 的精确 entry，并与各自 `artifact-scan/box/` 下实际文件比较长度与 SHA256。

| 三轮复核项目                            | 实际结果                            |
| --------------------------------------- | ----------------------------------- |
| 各轮主证据文件的 ZIP-to-extracted 核对  | 每轮 23/23，通过 69 次              |
| 各轮支持文件的 ZIP-to-extracted 核对    | 每轮 11/11，通过 33 次              |
| 合计长度和 SHA256 比较                  | 34 文件 × 3 个输入 = 102 次，全通过 |
| 34 个选定文件跨三份 ZIP 比较            | 全部长度/SHA256 相同，变化 0 个     |
| 新旧 UNKNOWN 名称、类型、主证据路径集合 | 各 23/23 一一匹配，无增删           |
| 匹配后的 UNKNOWN 记录 ID                | 三轮 23/23 相同                     |

因此，前文 23 条 UNKNOWN 明细及 11 个支持文件的 ID、路径、字节数和哈希已在本轮 ZIP 上重新证实，L/R/P 路径前缀仍适用。L 下 13 个子 manifest 可关联父包 `libphonenumber-js@1.13.15`，R 下 5 个可关联 `rxjs@7.8.2`；Prisma EXE 的父包仍为 `@prisma/engines@5.22.0`，debugger DLL 仍有相同扩展 SQL 的明确引用。这里验证了选定文件的字节一致性，不能解释为三轮 ZIP 整体相同，也不自动形成二进制版本或上游来源证明。

本轮另将核对结果写入新验证根的两个本地 JSON，便于再次复核，不改写原扫描输出：

| 本地核对证据                   | SHA256                                                             |
| ------------------------------ | ------------------------------------------------------------------ |
| `unknown-recheck-summary.json` | `fb79496e81ad13754ea8f5c32ea50d5b21e5ead530e1b7ecdb8673168198886d` |
| `unknown-selected-files.json`  | `72287df4e8f6d1a77a24ef0a0a7597b1ec1087cb2e5c17b2e3807c3f2c0a3dfb` |

这些路径仅是本机复核位置，不是公开下载地址。没有运行未知 EXE/DLL、访问远程包注册表或新增供应方发布/源码证据。**23 条 UNKNOWN、空许可字段和 5 个未知二进制版本全部保留，整体仍为 `DRAFT_PARTIAL_COVERAGE`。** 三轮文件一致不关闭许可适用范围、Apache NOTICE/归属、电话元数据或 DLL 的许可证义务；父包版本与扩展 schema 版本仍不能代替二进制版本。新包的整体扫描与 schema 结果另见[制品 SBOM 新包记录](artifact-sbom-validation-2026-11-07.md#质量门禁修正后新-zip-的独立扫描96d5552026-11-07)，模块图仍为 `PARTIAL_MODULE_EVIDENCE`。
