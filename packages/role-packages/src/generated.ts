// 由 scripts/build.mjs 生成，请勿手改。
// 修改 roles/<roleKey>/ 下的内容后运行：pnpm --filter @workmesh/role-packages build
import type { RolePackageManifest } from '@workmesh/shared';

export type BuiltinRolePackageResource = {
  resourceId: string;
  path: string;
  mediaType: string;
  sha256: string;
  byteLength: number;
  bodyBase64: string;
};

export type BuiltinRolePackage = {
  packageId: string;
  version: string;
  roleKey: string;
  manifest: RolePackageManifest;
  resources: BuiltinRolePackageResource[];
};

export const BUILTIN_ROLE_PACKAGES: BuiltinRolePackage[] = [
  {
    "packageId": "workmesh.role.backend",
    "version": "1.2.2",
    "roleKey": "backend",
    "manifest": {
      "packageSchemaVersion": "1.1",
      "id": "workmesh.role.backend",
      "version": "1.2.2",
      "protocolVersion": "1.0",
      "title": "后端角色包",
      "description": "把 PRD 转成可并行的接口契约，按契约实现并交付可验证证据。",
      "license": "MIT",
      "roleKey": "backend",
      "compatibility": {
        "minCliVersion": "1.0.0",
        "maxCliVersionExclusive": "2.0.0",
        "contractVersion": "1.0"
      },
      "skills": [
        {
          "key": "design-contract",
          "path": "skills/design-contract/SKILL.md",
          "description": "从 PRD 推导接口契约、数据变更与错误码，作为并行开发的共同参照。",
          "whenToUse": "PRD 就绪、开工前需要定契约时。"
        },
        {
          "key": "implement-change",
          "path": "skills/implement-change/SKILL.md",
          "description": "按已发布契约实现代码，回链需求编号并完成自测。",
          "whenToUse": "契约已发布、任务已认领时。"
        },
        {
          "key": "attach-evidence",
          "path": "skills/attach-evidence/SKILL.md",
          "description": "收集提交级证据与检查结果，组成可复核的交付。",
          "whenToUse": "实现完成、准备交付时。"
        },
        {
          "key": "plan-change",
          "path": "skills/plan-change/SKILL.md",
          "description": "调查既有实现并记录技术取舍，按验收场景拆解带文件归属的任务。",
          "whenToUse": "老项目接入、跨模块改动或复杂契约变更需要规划时。"
        },
        {
          "key": "diagnose-bug",
          "path": "skills/diagnose-bug/SKILL.md",
          "description": "保存原始复现、定位根因、限定修复并记录实际复验结果。",
          "whenToUse": "既有行为损坏，需要诊断和修复时。"
        }
      ],
      "inputs": [
        {
          "key": "context",
          "source": "TASK_SNAPSHOT",
          "kind": "CONTEXT",
          "required": true,
          "contractVersion": "1.0"
        },
        {
          "key": "prd",
          "source": "KNOWLEDGE",
          "kind": "PRD",
          "required": true,
          "contractVersion": "1.0"
        },
        {
          "key": "unit-card",
          "source": "KNOWLEDGE",
          "kind": "UNIT_CARD",
          "required": true,
          "contractVersion": "1.0"
        }
      ],
      "outputs": [
        {
          "key": "contract",
          "channel": "CANDIDATE",
          "kind": "KNOWLEDGE",
          "contractVersion": "1.0",
          "templateResourceId": "template-contract",
          "evidence": [
            "INSPECTION"
          ]
        },
        {
          "key": "impl",
          "channel": "CANDIDATE",
          "kind": "IMPL",
          "contractVersion": "1.0",
          "templateResourceId": "template-impl",
          "evidence": [
            "TEST",
            "INSPECTION"
          ]
        }
      ],
      "resources": [
        {
          "id": "template-change-plan",
          "kind": "template",
          "path": "assets/templates/change-plan.md",
          "sha256": "830b2b7d8aa03396eaf2e47ef9ad9ded9a186d3643722afcc4cf14e56ae9baca",
          "byteLength": 1528,
          "mediaType": "text/markdown"
        },
        {
          "id": "template-contract",
          "kind": "template",
          "path": "assets/templates/contract.md",
          "sha256": "5a1b86ef11d592596e2ae8f68486e7b0689e33f72a794e43d03c2986cc824afa",
          "byteLength": 1320,
          "mediaType": "text/markdown"
        },
        {
          "id": "template-impl",
          "kind": "template",
          "path": "assets/templates/impl.md",
          "sha256": "761a1be26b825b47fd7a38a7761f80172b8cbb7738a6d47956643a011cb54aee",
          "byteLength": 908,
          "mediaType": "text/markdown"
        },
        {
          "id": "checklist-contract-quality",
          "kind": "checklist",
          "path": "checklists/contract-quality.md",
          "sha256": "2c53afe598d5fb0a7e181bf5967735c36f4d1db662f0de01d0c99fdb6b16dae8",
          "byteLength": 927,
          "mediaType": "text/markdown"
        },
        {
          "id": "checklist-spec-driven",
          "kind": "checklist",
          "path": "checklists/spec-driven.md",
          "sha256": "d0f3d468bd25d3c0da8d1cd48955e25e821803ffe7e0f9117e9637f084ded542",
          "byteLength": 1253,
          "mediaType": "text/markdown"
        },
        {
          "id": "guide",
          "kind": "prompt",
          "path": "guide.md",
          "sha256": "3468003131caea11d551d566a6df72d9851b2a692e8f97da2099233e17966a7e",
          "byteLength": 3972,
          "mediaType": "text/markdown"
        },
        {
          "id": "reference-references",
          "kind": "reference",
          "path": "references/references.json",
          "sha256": "2197fd6a363e157902d3d677c09530208e06e3315445284f0cc4aeb555c718e9",
          "byteLength": 646,
          "mediaType": "application/json"
        },
        {
          "id": "skill-attach-evidence",
          "kind": "skill",
          "path": "skills/attach-evidence/SKILL.md",
          "sha256": "9fc2803fcf8da4fb57a3e4660084f7389a5a86e0ad50a3db6fc1e0c3b5597d6a",
          "byteLength": 1527,
          "mediaType": "text/markdown"
        },
        {
          "id": "skill-design-contract",
          "kind": "skill",
          "path": "skills/design-contract/SKILL.md",
          "sha256": "dc5b1da4d174f24da1e7b26b393beeeb43178078b708c63b116952826e391e99",
          "byteLength": 1793,
          "mediaType": "text/markdown"
        },
        {
          "id": "skill-diagnose-bug",
          "kind": "skill",
          "path": "skills/diagnose-bug/SKILL.md",
          "sha256": "c1a3dabbf8aaf1385f35e883ad1422d078aeeb3756e8893e7cdd8172d168f51d",
          "byteLength": 1234,
          "mediaType": "text/markdown"
        },
        {
          "id": "skill-implement-change",
          "kind": "skill",
          "path": "skills/implement-change/SKILL.md",
          "sha256": "da8e2ae73a3743e39551e515eaefca409175a2f263aaf057c40427a9e96c06ed",
          "byteLength": 1401,
          "mediaType": "text/markdown"
        },
        {
          "id": "skills-index",
          "kind": "index",
          "path": "skills/index.md",
          "sha256": "a7f8e7411e514e34ecf241a90b7e6e378c620cb9bd858f1f1b9c95d037037211",
          "byteLength": 1424,
          "mediaType": "text/markdown"
        },
        {
          "id": "skill-plan-change",
          "kind": "skill",
          "path": "skills/plan-change/SKILL.md",
          "sha256": "806d12def1507648159f14b1ab5f4c16e7af4df16e785775f9d1191a8485f853",
          "byteLength": 1942,
          "mediaType": "text/markdown"
        }
      ],
      "agentEntries": [
        {
          "host": "codex",
          "type": "AGENTS_MD_POINTER",
          "resourceId": "skills-index",
          "adapterVersion": "1.0.0"
        },
        {
          "host": "claude-code",
          "type": "SKILLS_DIRECTORY",
          "resourceId": "skills-index",
          "adapterVersion": "1.0.0"
        }
      ]
    },
    "resources": [
      {
        "resourceId": "template-change-plan",
        "path": "roles/backend/assets/templates/change-plan.md",
        "sha256": "830b2b7d8aa03396eaf2e47ef9ad9ded9a186d3643722afcc4cf14e56ae9baca",
        "byteLength": 1528,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDlrp7njrDorqHliJLvvJo86ZyA5rGC57yW5Y+35LiO5qCH6aKYPgoKPiBQUkQg5L+u6K6i77yaPGlkPiDCtyDlv6vnhafvvJo8aWQ+IMK3IOS7o+eggeWfuue6v++8mjzlrozmlbQgY29tbWl0IFNIQT4KCiMjIOeOsOeKtuS4jue6puadnwoK546w5pyJ6KGM5Li644CB55u46YK75qih5Z2X44CB5b+F6aG75L+d55WZ55qE5YW85a655oCn44CB6aG555uu6KeE6IyD54mI5pys77yb5paw6aG555uu5rOo5piO5peg5pei5pyJ5a6e546w44CCCgojIyDlop7ph4/kuqTku5jpobrluo/vvIjlpJrlnLrmma/ml7bvvIkKCuaMieeUqOaIt+S7t+WAvOaghyBQMS9QMi9QM++8jOmAieWHuuacgOWwj+WPr+eUqOS4lOerr+WIsOerr+eahOmmluS4quWIh+eJh++8iE1WUO+8ie+8jOazqOaYjuWug+eLrOeri+S6pOS7mOaXtueahOmqjOivgeajgOafpeeCueOAguiusOW9lSBQMi9QMyDlu7bmnJ/nkIbnlLHkuI7mgaLlpI3mnaHku7bvvJvln7rnoYDkvp3otZblj6/ku6XlhYjlrp7njrDvvIzkvYbkuI3lvpflm6DmraTmiornuq/mioDmnK/pk7rlnqvor6/miqXmiJDnlKjmiLfku7flgLzjgILkvJjlhYjnuqflkowgTVZQIOaYr+aWueahiOW7uuiuru+8jOeUseS4muWKoei0n+i0o+S6uuehruiupO+8m+S4jeiHquWKqOaUueWPmOW5s+WPsOiMg+WbtOOAgueugOWNleaUueWKqOWPr+ecgeeVpeOAggoKIyMg6LCD5p+l5LiO5Y+W6IiNCgp8IOmXrumimCB8IOadpea6kOS9jee9riB8IOmAieaLqeS4juWOn+WboCB8IOWkh+mAieWPiuaUvuW8g+WOn+WboCB8IOacquWGs+mhuS/lvbHlk40gfAp8IC0tLS0gfCAtLS0tLS0tLSB8IC0tLS0tLS0tLS0gfCAtLS0tLS0tLS0tLS0tLSB8IC0tLS0tLS0tLS0tIHwKfCAgICAgIHwgICAgICAgICAgfCAgICAgICAgICAgIHwgICAgICAgICAgICAgICAgfCAgICAgICAgICAgICB8CgojIyDorr7orqHkuI7pqozor4EKCuaVsOaNruOAgeaOpeWPo+OAgemUmeivr+i3r+W+hOOAgei/geenuy/mgaLlpI3jgIHmnIDlsI/ov5DooYzpqozor4HvvJvkuI3mtonlj4rnmoTpg6jliIbms6jmmI7ljp/lm6DjgIIKCiMjIOWPr+eLrOeri+mqjOaUtueahOS7u+WKoQoKfCDmnKzlnLDku7vliqEgSUQgfCDlnLrmma8v6aqM5pS2IGtleSB8IOS+nei1liB8IOi0n+i0o+aWh+S7tiB8IOWPr+W5tuihjOWPiuS+neaNriB8IOmqjOivgeaWueazlSB8CnwgLS0tLS0tLS0tLS0gfCAtLS0tLS0tLS0tLS0tIHwgLS0tLSB8IC0tLS0tLS0tIHwgLS0tLS0tLS0tLS0tIHwgLS0tLS0tLS0gfAp8IGltcGwtMDEgICAgIHwgYWMtMDEgICAgICAgICB8ICAgICAgfCAgICAgICAgICB8ICAgICAgICAgICAgICB8ICAgICAgICAgIHwKCiMjIOS6pOaOpeS4juS+i+WklgoK5o6l5pS26KeS6Imy44CB5YmN572u5p2h5Lu244CB5b6FIEhVTUFOIOWGs+WumueahOS6i+mhueOAgeWBj+emu+inhOiMg+eahOeQhueUseS4juWkjeafpeadoeS7tuOAggrmnKzorqHliJLlhoXku7vliqHkuLrmj5DmoYjvvIzmraPlvI/ku7vliqHjgIHln7rnur/kuI7mibnlh4bku6UgV29ya01lc2gg5b2T5YmN5LqL5a6e5Li65YeG44CCCg=="
      },
      {
        "resourceId": "template-contract",
        "path": "roles/backend/assets/templates/contract.md",
        "sha256": "5a1b86ef11d592596e2ae8f68486e7b0689e33f72a794e43d03c2986cc824afa",
        "byteLength": 1320,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDlpZHnuqbvvJo86ZyA5rGC5qCH6aKYPgoKPiDpnIDmsYLnvJblj7fvvJo8UFJPSkVDVF9LRVk+LTzluo/lj7c+IMK3IOeJiOacrO+8mnYxIMK3IOeKtuaAge+8muiNieeovwo+IOa2ieWPiuWNleWFg++8mjx1bml0LWtleT4gLyA8dW5pdC1rZXk+CgojIyAxLiDojIPlm7QKCuacrOasoeaWsOWinuaIluWPmOabtOWTquS6m+aOpeWPo++8jOa2ieWPiuWTquS6m+aVsOaNruOAggoKIyMgMi4g5o6l5Y+jCgojIyMgPE1FVEhPRD4gPHBhdGg+CgotIOeUqOmAlO+8mgotIOWFpeWPgu+8mgoKfCDlrZfmrrUgfCDnsbvlnosgfCDlv4XloasgfCDor7TmmI4gfAp8IC0tLS0gfCAtLS0tIHwgLS0tLSB8IC0tLS0gfAp8ICAgICAgfCAgICAgIHwgICAgICB8ICAgICAgfAoKLSDlh7rlj4LvvJoKCnwg5a2X5q61IHwg57G75Z6LIHwg6K+05piOIHwKfCAtLS0tIHwgLS0tLSB8IC0tLS0gfAp8ICAgICAgfCAgICAgIHwgICAgICB8CgotIOmUmeivr+egge+8mgoKfCDnoIEgIHwgSFRUUCB8IOWQq+S5iSB8IOinpuWPkeadoeS7tiB8CnwgLS0tIHwgLS0tLSB8IC0tLS0gfCAtLS0tLS0tLSB8CnwgICAgIHwgICAgICB8ICAgICAgfCAgICAgICAgICB8CgojIyAzLiDmlbDmja7lj5jmm7QKCnwg6KGoICB8IOWPmOabtCB8IOi/geenu+aWueW8jyB8IOWbnua7muaWueW8jyB8CnwgLS0tIHwgLS0tLSB8IC0tLS0tLS0tIHwgLS0tLS0tLS0gfAp8ICAgICB8ICAgICAgfCAgICAgICAgICB8ICAgICAgICAgIHwKCiMjIDQuIOWFvOWuueaApwoKLSDml6flrqLmiLfnq6/mmK/lkKblj5flvbHlk43vvJoKLSDmmK/lkKbpnIDopoHlubPooYzlj5jmm7TvvIhleHBhbmQgLyBtaWdyYXRlIC8gY29udHJhY3TvvInvvJoKLSDkuIvnur/ml6fniYjnmoTmnaHku7bvvJoKCiMjIDUuIOWksei0peaooeW8jwoKfCDlnLrmma8gICAgICAgfCDooYzkuLogfCDlr7nosIPnlKjmlrnnmoTlj6/op4HlvbHlk40gfAp8IC0tLS0tLS0tLS0gfCAtLS0tIHwgLS0tLS0tLS0tLS0tLS0tLS0tIHwKfCDotoXml7YgICAgICAgfCAgICAgIHwgICAgICAgICAgICAgICAgICAgIHwKfCDpmZDmtYEgICAgICAgfCAgICAgIHwgICAgICAgICAgICAgICAgICAgIHwKfCDkuIvmuLjkuI3lj6/nlKggfCAgICAgIHwgICAgICAgICAgICAgICAgICAgIHwKCiMjIDYuIOa2iOi0ueaWuQoKfCDop5LoibIgICAgIHwg55So6YCUIHwg5L2V5pe25Y+v5byA5belIHwKfCAtLS0tLS0tLSB8IC0tLS0gfCAtLS0tLS0tLS0tIHwKfCBmcm9udGVuZCB8ICAgICAgfCAgICAgICAgICAgIHwKfCBxYSAgICAgICB8ICAgICAgfCAgICAgICAgICAgIHwKfCBvcHMgICAgICB8ICAgICAgfCAgICAgICAgICAgIHwK"
      },
      {
        "resourceId": "template-impl",
        "path": "roles/backend/assets/templates/impl.md",
        "sha256": "761a1be26b825b47fd7a38a7761f80172b8cbb7738a6d47956643a011cb54aee",
        "byteLength": 908,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDlrp7njrDor7TmmI7vvJo86ZyA5rGC5qCH6aKYPgoKPiDpnIDmsYLnvJblj7fvvJo8UFJPSkVDVF9LRVk+LTzluo/lj7c+IMK3IOS7u+WKoe+8mjx0YXNrIGNvZGU+Cj4g5o+Q5Lqk77yaPGNvbW1pdCBzaGE+IMK3IOWlkee6pueJiOacrO+8mnYxCgojIyAxLiDmlLnliqjojIPlm7QKCnwg5Y2V5YWDIHwg5qih5Z2XIHwg5pS55YqoICAgICAgICAgICAgICAgfAp8IC0tLS0gfCAtLS0tIHwgLS0tLS0tLS0tLS0tLS0tLS0tIHwKfCAgICAgIHwgICAgICB8IOaWsOWiniAvIOS/ruaUuSAvIOWIoOmZpCB8CgojIyAyLiDmjqXlj6Plj5jljJYKCuS4juWlkee6puS4gOiHtOeahOmDqOWIhuS4jemHjeWkje+8m+acieWBj+W3rueahOW/hemhu+WcqOatpOivtOaYjuWOn+WboOOAggoKfCDmjqXlj6MgfCDlj5jljJYgfCDmmK/lkKblt7LmlLnlpZHnuqYgfAp8IC0tLS0gfCAtLS0tIHwgLS0tLS0tLS0tLS0tIHwKfCAgICAgIHwgICAgICB8ICAgICAgICAgICAgICB8CgojIyAzLiDmlbDmja7lj5jmm7QKCi0g6L+B56e76ISa5pys77yaCi0g5Zue5rua6ISa5pys77yaCi0g5piv5ZCm5ryU57uD77yaCgojIyA0LiDmtYvor5UKCnwg57G75Z6LIHwg6KaG55uWIHwg57uT5p6cIHwKfCAtLS0tIHwgLS0tLSB8IC0tLS0gfAp8IOWNleWFgyB8ICAgICAgfCAgICAgIHwKfCDpm4bmiJAgfCAgICAgIHwgICAgICB8Cnwg5omL5belIHwgICAgICB8ICAgICAgfAoKIyMgNS4g6aqM5pS26KaG55uWCgp8IOmqjOaUtiBrZXkgfCDor4Hmja4gfAp8IC0tLS0tLS0tIHwgLS0tLSB8CnwgYWMtMDEgICAgfCAgICAgIHwKCiMjIDYuIOW3suefpemZkOWItgoK77yI5rKh5pyJ5bCx5YaZ44CM5peg44CN77yM5LiN6KaB55WZ56m677yJCgojIyA3LiDlm57mu5oKCuinpuWPkeadoeS7tuOAgeatpemqpOOAgemqjOivgeaWueW8j+OAggo="
      },
      {
        "resourceId": "checklist-contract-quality",
        "path": "roles/backend/checklists/contract-quality.md",
        "sha256": "2c53afe598d5fb0a7e181bf5967735c36f4d1db662f0de01d0c99fdb6b16dae8",
        "byteLength": 927,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDlpZHnuqbotKjph4/muIXljZUKCi0gWyBdIOavj+S4quaOpeWPo+mDveWGmeS6hueUqOmAlOOAgeWFpeWPguOAgeWHuuWPguOAgemUmeivr+eggeOAggotIFsgXSDlh7rlj4Llj6rmmrTpnLLosIPnlKjmlrnpnIDopoHnmoTlrZfmrrXvvIzmsqHmnInlhoXpg6jnu5PmnoTms4TmvI/jgIIKLSBbIF0g6ZSZ6K+v56CB5aSN55So5LyY5YWI77yb5paw5aKe55qE5YaZ5LqG5ZCr5LmJ5LiO6Kem5Y+R5p2h5Lu244CCCi0gWyBdIOiHs+WwkeWGmeS6huS4gOadoeWksei0pei3r+W+hO+8iOi2heaXtiAvIOmZkOa1gSAvIOS4i+a4uOS4jeWPr+eUqO+8ieOAggotIFsgXSDmlbDmja7lj5jmm7TluKbov4Hnp7vkuI7lm57mu5rvvIzkuJTlm57mu5rmvJTnu4Pov4fjgIIKLSBbIF0g5YW85a655oCn57uT6K665piO56Gu77ya5pen5a6i5oi356uv5piv5ZCm5Y+X5b2x5ZON77yM5piv5ZCm6ZyA6KaB5bmz6KGM5Y+Y5pu044CCCi0gWyBdIOS4i+e6v+aXp+eJiOeahOadoeS7tuWGmea4heS6huOAggotIFsgXSDmtojotLnmlrnvvIjliY3nq6/jgIFRQeOAgei/kOe7tO+8ieS4juW8gOW3peadoeS7tuWGmea4heS6huOAggotIFsgXSDlpZHnuqbkuI4gUFJEIOeahOmqjOaUtuWvueW+l+S4iu+8jOayoeacieWkmuWBmuaIluWwkeWBmuOAggotIFsgXSDlpZHnuqbph4znmoTlrZfmrrXlkb3lkI3kuI7pobnnm67op4TojIPkuIDoh7TjgIIKCiMjIOS6pOS7mOWJjeacgOWQjuS4iemXrgoKMS4g5YmN56uv5Y+q55yL6L+Z5Lu95aWR57qm77yM6IO95LiN6IO95LiN6Zeu6Zeu6aKY5bCx5YaZ5Luj56CB77yfCjIuIOe6v+S4iuWHuumXrumimOaXtu+8jOi/meS7veWlkee6puiDveS4jeiDveino+mHiuOAjOW6lOivpeaYr+S7gOS5iOihjOS4uuOAje+8nwozLiDljYrlubTlkI7opoHkuIvnur/ml6fniYjvvIzmnaHku7blhpnlvpflpJ/muIXmpZrlkJfvvJ8K"
      },
      {
        "resourceId": "checklist-spec-driven",
        "path": "roles/backend/checklists/spec-driven.md",
        "sha256": "d0f3d468bd25d3c0da8d1cd48955e25e821803ffe7e0f9117e9637f084ded542",
        "byteLength": 1253,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDop4TmoLzkuI7kuqTku5jljY/kvZzmo4Dmn6UKCuWPquWKoOi9veacrOasoeS7u+WKoea2ieWPiueahOaooeadv+WSjOa4heWNleOAgueugOWNleaUueWKqOWGmeW/heimgeS/oeaBr++8m+WkjeadguW6puadpeiHqumjjumZqeOAgeS+nei1luWSjOmqjOaUtuiMg+WbtO+8jOS4jeaMieWbuuWumumhteaVsOaIlueroOiKguaVsOWIpOaWrei0qOmHj+OAggoKLSBbIF0g5bey6K+75pys5qyh5b+r54Wn5LiO6aG555uu6KeE6IyD77yM56Gu6K6kIFBSRC/nn6Xor4bkv67orqLvvJvogIHpobnnm67lhYjmoLjlr7nlrp7pmYXku6PnoIHjgIHlt6XlhbfphY3nva7kuI7njrDmnInooYzkuLrjgIIKLSBbIF0g5YWz6ZSu57uT6K665pyJ5p2l5rqQ77yb6LCD5p+l5pyq55+l6aG544CB5pa55qGI5Y+W6IiN44CB5L6L5aSW5LiO5bu25pyf5Z2H5pyJ55CG55Sx5ZKM6LSj5Lu75Lq644CCCi0gWyBdIOS7peW3suehruiupOmqjOaUtiBrZXkg5YWz6IGU5pys6KeS6Imy5Lqn54mp77yb5Lu75Yqh5YiX5L6d6LWW44CB6LSf6LSj5paH5Lu25LiO6aqM6K+B5pa55byP77yM5YWx55So5paH5Lu25LiN5peg5L6d5o2u5Zyw5bm26KGM5L+u5pS544CCCi0gWyBdIOWkmuWcuuaZr+iuoeWIkuaYjuehruacgOWwj+err+WIsOerryBQMS9NVlAg5YiH54mH44CB54us56uL6aqM6K+B5qOA5p+l54K55ZKM5bu25pyf5p2h5Lu277yb566A5Y2V5Lu75Yqh5LiN5by65Yi25YiG5pyf44CCCi0gWyBdIOmcgOaxgui0qOmHj+OAgeeUqOS+i+iuvuiuoeimhuebluOAgeWunumZheaJp+ihjOe7k+aenOWSjCBIVU1BTiDmraPlvI/pqozmlLbliIbliKvorrDlvZXjgIIKLSBbIF0g5omA5pyJ5pyq6L+Q6KGM44CB5aSx6LSl44CB6Zi75aGe44CB5peg5rOV5qC46aqM55qE5YaF5a655piO56Gu5qCH5Ye677ybQWdlbnQg5oql5ZGK5LiN5aOw56ew54us56uL6aqM6K+B44CCCi0gWyBdIOe8uuWPo+S7peeos+WumiBJRCDov73liqDlubblm57pk77ljp/orrDlvZXvvJvotoXlh7rpnIDmsYLojIPlm7TlhYjotbDlj5jmm7TvvIzkv67mlLnln7rnur/lkI7ph43mlrDmoLjlr7nor4Hmja7jgIIKCuinkuiJsui1hOa6kOabtOaWsO+8muW3sumUgeWumueJiOacrOS/neaMgeWOn+Wtl+iKgu+8jOaWsOaWueazleWcqOaWsOWMheeJiOacrOWuieijheWQjueUn+aViOOAguWuv+S4u+WFpeWPo+WPquaMh+WQkeinkuiJsui1hOa6kO+8m+mhueebruiHquWumuS5ieinhOiMg+maj+mhueebruefpeivhuS/ruiuou+8jOS4jeWkjeWItui/m+inkuiJsuWMheOAggo="
      },
      {
        "resourceId": "guide",
        "path": "roles/backend/guide.md",
        "sha256": "3468003131caea11d551d566a6df72d9851b2a692e8f97da2099233e17966a7e",
        "byteLength": 3972,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDlkI7nq6/op5LoibLvvIhiYWNrZW5k77yJCgrkvaDmjInlvZPliY3ku7vliqHlo7DmmI7nmoTovpPlh7rkuqflh7rmjqXlj6PlpZHnuqblgJnpgInvvIhgS05PV0xFREdFYO+8ieaIluWunueOsO+8iGBJTVBMYO+8ie+8muaOpeWPo+OAgeaVsOaNruWPmOabtOOAgei/geenu+S4juWbnua7muivtOaYjuOAggrkvaDnmoTkuqTku5jlv4Xpobvog73ooqvkurrnsbvnlKjmj5DkuqTnuqfor4Hmja7lpI3moLjjgIIKCiMjIOi+ueeVjAoKLSDop5LoibLljIXmlK/mjIHlpZHnuqblgJnpgIkgYEtOT1dMRURHRWAg5LiO5a6e546wIGBJTVBMYO+8m+acrOasoeWPquiDveS6pOS7mOW9k+WJjea1geeoi+atpemqpOWjsOaYjueahOexu+Wei++8jOS4jeiDveWcqOWPquWjsOaYjiBgSU1QTGAg55qE5Lu75Yqh5Lit5pOF6Ieq5aKe5Yqg5aWR57qm5bel5Lu244CCCi0g5aWR57qm6K6+6K6h5ZCO5LqkIEhVTUFOIOWuoeafpeOAgeWPkeW4g+W5tue7keWumue7meWJjeerr+etieaOpeaUtuinkuiJsu+8m+aPkOS6pOWAmemAieS4jeS7o+ihqOWlkee6puW3sue7j+eUn+aViOOAguS4jeaUuSBQUkTjgIHkuI3mlLnmtYHnqIvlrprkuYnjgIHkuI3lj5HluIPjgIHkuI3mibnlh4bjgIIKLSDmtonlj4rmlbDmja7lupPml7bvvIzkuqTku5jlv4XpobvljIXlkKsqKuWPr+Wbnua7mioq55qE6L+B56e75LiO6aqM6K+B5pa55byP77yb5LiN5Y+v6YCG5pON5L2c6KaB5pi+5byP5YaZ6L+bIHN1bW1hcnnjgIIKLSDmibnlh4blj6rlj5HnlJ/lnKggV2ViIOivhOWuoemhte+8jOeUsSBIVU1BTiDlrozmiJDjgIIKCiMjIOS4gOasoeWujOaVtOW+queOrwoKYGBgYmFzaAp3b3JrbWVzaCBhdXRoIGxvZ2luCgp3b3JrbWVzaCBjb250ZXh0IC0tdGFzayA8dGFza0lkPiAtLWluc3BlY3QKd29ya21lc2ggY2xhaW0gLS10YXNrIDx0YXNrSWQ+CndvcmttZXNoIGNvbnRleHQgLS10YXNrIDx0YXNrSWQ+IC0tY2xhaW0gPGNsYWltSWQ+IC0tZXhwZWN0ZWQtdmVyc2lvbiA8dGFza1ZlcnNpb24+IC0tbWF0ZXJpYWxpemUKCmNhdCAud29ya21lc2gvbG9jYWwvY29udGV4dC88c25hcHNob3RJZD4vbWFuaWZlc3QuanNvbiAgICMg56Gu6K6k5Z+657q/CmdpdCByZXYtcGFyc2UgSEVBRCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAjIOWPluWujOaVtCBjb21taXQgc2hhCgp3b3JrbWVzaCBkZWxpdmVyIFwKICAtLXRhc2sgPHRhc2tJZD4gLS1jbGFpbSA8Y2xhaW1JZD4gLS1zbmFwc2hvdCA8c25hcHNob3RJZD4gXAogIC0tZXhwZWN0ZWQtdmVyc2lvbiA8dGFza1ZlcnNpb24+IFwKICAtLW1hbmlmZXN0IGRlbGl2ZXItbWFuaWZlc3QuanNvbgoKIyDkvb/nlKggZGVsaXZlciDov5Tlm57nmoTnnJ/lrp4gcmV2aWV3UmVxdWVzdElkIOafpeivouiHquWKqOWIm+W7uueahOivhOWuoQp3b3JrbWVzaCByZXZpZXcgc2hvdyAtLXJldmlldyA8cmV2aWV3UmVxdWVzdElkPgpgYGAKCmBkZWxpdmVyYCDov5Tlm54gYHJldmlld1JlcXVlc3RJZGDjgIFXZWIg5Zyw5Z2A5ZKMIGBvcGVyYXRpb25JZGDvvIzkuI3nlKjlho3mrKHliJvlu7rlkIzkuIDova7or4TlrqHjgILovpPlh7rkuKLlpLHml7bvvIznlKggYHdvcmttZXNoIHJlY2VpcHQgc2hvdyAtLW9wZXJhdGlvbiA85Y6f5Lqk5LuYb3BlcmF0aW9uSWQ+IC0tanNvbmAg6K+75Y+WIGBkYXRhLnJlc3VsdFJlZnMucmV2aWV3UmVxdWVzdElkYO+8m+aUtuaNruS7jeS4uiBQRU5ESU5HIOaIlue7k+aenOacquefpeaXtu+8jOWFiOeUqOWOn+aTjeS9nOe8luWPt+aJp+ihjCBgd29ya21lc2ggcmVjZWlwdCByZWNvbmNpbGUgLS1vcGVyYXRpb24gPOWOn+S6pOS7mG9wZXJhdGlvbklkPmDjgILmraPlvI/lhrPlrprku43nlLEgSFVNQU4g5ZyoIFdlYiDlrozmiJDjgIIKCiMjIGRlbGl2ZXIgbWFuaWZlc3Qg6KaB54K5CgpgYGBqc29uCnsKICAid29ya2Zsb3dEZWZpbml0aW9uUmV2aXNpb25JZCI6ICI8c25hcHNob3Qg6YeM6K6w5b2V55qEIHdvcmtmbG93IOS/ruiuoj4iLAogICJsb2NhbFJ1bklkIjogIjzmnKzlnLDlj6/lpI3njrDnmoTov5DooYzmoIfor4Y+IiwKICAiaXRlbXMiOiBbCiAgICB7CiAgICAgICJraW5kIjogIklNUEwiLAogICAgICAic3RvcmFnZSI6ICJHSVRfUkVGIiwKICAgICAgIm1lZGlhVHlwZSI6ICJ0ZXh0L3BsYWluIiwKICAgICAgInNoYTI1NiI6ICI85paH5Lu25oiW6KGl5LiB55qEIHNoYTI1Nj4iLAogICAgICAiYnl0ZUxlbmd0aCI6IDgxOTIsCiAgICAgICJwcm9qZWN0UmVwb3NpdG9yeUlkIjogIjzpobnnm67lt7LnmbvorrDku5PlupMgaWQ+IiwKICAgICAgImNvbW1pdFNoYSI6ICI8NDAg5L2N5bCP5YaZIGhleD4iLAogICAgICAicmVwb1BhdGgiOiAiYXBwcy9hcGkvc3JjL29yZGVycy9vcmRlcnMuc2VydmljZS50cyIsCiAgICAgICJzdW1tYXJ5IjogIuaWsOWinuiuouWNleWPlua2iOaOpeWPo++8m+i/geenuyAwMDA0IOWPr+Wbnua7miIsCiAgICAgICJjaGVja3MiOiBbCiAgICAgICAgeyAiY29kZSI6ICJ0eXBlLWNoZWNrIiwgInBhc3NlZCI6IHRydWUgfSwKICAgICAgICB7ICJjb2RlIjogImludGVncmF0aW9uLXRlc3QiLCAicGFzc2VkIjogdHJ1ZSB9CiAgICAgIF0KICAgIH0KICBdCn0KYGBgCgotIOmcgOimgeaJmOeuoeato+aWh++8iOS+i+Wmgui/geenu+iEmuacrOOAgeaOpeWPo+Wlkee6pu+8ieaXtueUqCBgInN0b3JhZ2UiOiAiSE9TVEVEImAgKyBgYm9keUJhc2U2NGDjgIIKLSDova/ku7bkuqTku5jmqKHmnb/pu5jorqTlpI3nlKjpobnnm67lt7Llj5HluIPnmoTmjqXlj6PlpZHnuqblkozns7vnu5/ljZXlhYPor7TmmI7jgILnvLrlsJHotYTmlpnml7blhYjorqnpobnnm67nrqHnkIblkZjljY/osIPlh4blpIfjgIHlj5HluIPkuI7op5LoibLnu5HlrprvvJvkuI3opoHmiorlrp7njrDkuqTku5jlvZPmiJDnn6Xor4blj5HluIPjgIIKLSBgY2hlY2tzYCDkvJrlsZXnpLrnu5nor4TlrqHkurrvvIzkuI3opoHloavlhpnmnKrmiafooYznmoTmo4Dmn6XjgIIKCiMjIOemgeatogoKLSDkuI3opoHlnKjmsqHmnInlm57mu5rmlrnmoYjnmoTmg4XlhrXkuIvkuqTku5jnoLTlnY/mgKfov4Hnp7vjgIIKLSDkuI3opoHmiorlh63mja7jgIHov57mjqXkuLLjgIHlr4bpkqXlhpnov5sgbWFuaWZlc3Qg5oiW5bel5Lu25q2j5paH44CCCi0g5LiN6KaB55So5Yir5Lq655qE5b+r54Wn5oiW6L+H5pyfIGNsYWltIOS6pOS7mOOAggoKIyMg5aSx6LSl5LiO6YeN6K+VCgotIOWGmeaTjeS9nOS4jeiHquWKqOmHjeivle+8m+mHjeaUvuWkjeeUqOWQjOS4gOS4qiBgLS1vcGVyYXRpb24gPHV1aWQ+YOOAggotIOe7k+aenOS4jeaYju+8mmB3b3JrbWVzaCByZWNlaXB0IHNob3cgLS1vcGVyYXRpb24gPHV1aWQ+YCDihpIg6ZyA6KaB5pe2IGB3b3JrbWVzaCByZWNlaXB0IHJlY29uY2lsZWDjgIIKLSDooqvopoHmsYLkv67mlLnvvJrmjInlvZPliY3ku7vliqHlkowgY2xhaW0g54q25oCB6L+U5L+u5ZCO6YeN5pawIGBkZWxpdmVyYO+8jOWGjeeUqOacrOi9rui/lOWbnueahCBgcmV2aWV3UmVxdWVzdElkYCDmiafooYwgYHJldmlldyBzaG93YO+8m+aWsOS6pOS7mOS8muiHquWKqOWIm+W7uuacrOi9ruivhOWuoeOAggoKIyMg6KeE5qC85LiO5Lqk5LuY6Ieq5qOACgrlvIDlt6XmiJbov5Tkv67ml7bmjIkgYGNoZWNrbGlzdHMvc3BlYy1kcml2ZW4ubWRgIOaguOWvueiMg+WbtOOAgeS+neaNruOAgeeJiOacrOS4juS6pOaOpe+8m+WPquivu+WPluW9k+WJjemYtuautemcgOimgeeahOi1hOa6kOOAggrlpI3mnYLmlLnliqjkvb/nlKggYHBsYW4tY2hhbmdlYCDlkowgYGNoYW5nZS1wbGFuLm1kYO+8jOWFiOiwg+afpeeOsOeKtuOAgeiusOW9leWPluiIje+8jOWGjeaMieWPr+eLrOeri+mqjOaUtueahOWcuuaZr+WuieaOkuS7u+WKoeOAggrlt7LmnInooYzkuLrmjZ/lnY/kvb/nlKggYGRpYWdub3NlLWJ1Z2DvvJvkv53nlZnljp/lp4vlpI3njrDvvIzpmZDlrprmoLnlm6Dkv67lpI3ojIPlm7TvvIzmnIDlkI7ph43ot5Hljp/lp4vlpI3njrDlkoznm7jlhbPlm57lvZLjgIIK"
      },
      {
        "resourceId": "reference-references",
        "path": "roles/backend/references/references.json",
        "sha256": "2197fd6a363e157902d3d677c09530208e06e3315445284f0cc4aeb555c718e9",
        "byteLength": 646,
        "mediaType": "application/json",
        "bodyBase64": "ewogICJ2ZXJzaW9uIjogMSwKICAibm90ZSI6ICLlj6rmlL7mjIfpkojvvIzkuI3mlL7mraPmlofjgIJzY29wZTogUFJPSkVDVCB8IFVOSVQgfCBST0xF44CC6Lev5b6E5Zyo6L+Q6KGM5pe255Sx5b+r54Wn6Kej5p6Q44CCIiwKICAiZW50cmllcyI6IFsKICAgIHsKICAgICAgImtleSI6ICJ1bml0LWNhcmQiLAogICAgICAic2NvcGUiOiAiVU5JVCIsCiAgICAgICJyZWYiOiAia25vd2xlZGdlOi8vPHByb2plY3Qta2V5Pi9zeXN0ZW0vPHVuaXQta2V5Pi9jYXJkIgogICAgfSwKICAgIHsKICAgICAgImtleSI6ICJjb252ZW50aW9ucyIsCiAgICAgICJzY29wZSI6ICJQUk9KRUNUIiwKICAgICAgInJlZiI6ICJrbm93bGVkZ2U6Ly88cHJvamVjdC1rZXk+L3N5c3RlbS9jb252ZW50aW9ucyIKICAgIH0sCiAgICB7CiAgICAgICJrZXkiOiAiYXBpLWNvbnRyYWN0IiwKICAgICAgInNjb3BlIjogIlVOSVQiLAogICAgICAicmVmIjogImtub3dsZWRnZTovLzxwcm9qZWN0LWtleT4vc3lzdGVtLzx1bml0LWtleT4vY29udHJhY3QiCiAgICB9LAogICAgewogICAgICAia2V5IjogImFkciIsCiAgICAgICJzY29wZSI6ICJQUk9KRUNUIiwKICAgICAgInJlZiI6ICJrbm93bGVkZ2U6Ly88cHJvamVjdC1rZXk+L3N5c3RlbS9hZHIiCiAgICB9CiAgXQp9Cg=="
      },
      {
        "resourceId": "skill-attach-evidence",
        "path": "roles/backend/skills/attach-evidence/SKILL.md",
        "sha256": "9fc2803fcf8da4fb57a3e4660084f7389a5a86e0ad50a3db6fc1e0c3b5597d6a",
        "byteLength": 1527,
        "mediaType": "text/markdown",
        "bodyBase64": "LS0tCm5hbWU6IGF0dGFjaC1ldmlkZW5jZQpkZXNjcmlwdGlvbjog5pS26ZuG5o+Q5Lqk57qn6K+B5o2u5LiO5qOA5p+l57uT5p6c77yM57uE5oiQ5Y+v5aSN5qC455qE5Lqk5LuY5bel5Lu26ZuG77yb5b2T5a6e546w5a6M5oiQ44CB5YeG5aSH5Lqk5LuY5pe25L2/55So44CCCmxpY2Vuc2U6IE1JVAptZXRhZGF0YToKICByb2xlS2V5OiBiYWNrZW5kCiAgcGFja2FnZVZlcnNpb246IDAuMS4wCi0tLQoKIyDpmYTnnYDor4Hmja4KCiMjIOS9leaXtueUqAoKLSDlrp7njrDlrozmiJDvvIzlh4blpIfkuqTku5jjgIIKLSDpnIDopoHooaXkuqTkuIrkuIDova7nvLrlpLHnmoTor4Hmja7jgIIKCiMjIOatpemqpAoKMS4g5YiX6K+B5o2u77ya5o+Q5LqkIFNIQeOAgea1i+ivlee7k+aenOOAgWxpbnTjgIHnsbvlnovmo4Dmn6XjgIHov4Hnp7vpqozor4HjgIIKMi4g5YaZIGBjaGVja3NbXWDvvJrmr4/pobkgYGNvZGVg44CBYHBhc3NlZGDjgIFgbWVzc2FnZWDjgIIKMy4g5qC45a+56KaG55uW77ya5q+P5p2h6KKr5pys5Lu75Yqh6KaG55uW55qE6aqM5pS277yM5piv5ZCm6YO95pyJ5a+55bqU6K+B5o2u44CCCjQuIOS6pOS7mO+8mkhPU1RFRCDkvKDlrZfoioLvvIxHSVRfUkVGIOe7meS7k+W6k+WumuS9jeOAgeaPkOS6pCBTSEEg5LiO6Lev5b6E44CCCjUuIOWksei0pemhueWGmeaYjuWOn+WboOS4juW9seWTje+8jOS4jemakOiXj+OAggoKIyMg6KeE5YiZCgotICoq5Y+q5Lqk5Y+v5qCh6aqM55qE6K+B5o2uKirvvJrog73lpI3ot5HnmoTmtYvor5XjgIHog73lrprkvY3nmoTmj5DkuqTjgIIKLSAqKuS4jeS8qumAoOmAmui/hyoq77ya5rKh6LeR55qE5qOA5p+l5qCHIGBwYXNzZWQ6IGZhbHNlYCDlubblhpnljp/lm6DvvIzmr5TnvJbkuIDkuKrpgJrov4flvLrjgIIKLSAqKuaXp+Wfuue6v+aLkue7nSoq77ya5Lqk5LuY5b+F6aG757uR5a6a5pys5qyh5Lu75Yqh55qE5b+r54Wn77yb5o2i5Z+657q/6KaB6YeN5paw5Y+W5b+r54Wn44CCCi0gKiror4Hmja7kuI7pqozmlLblr7npvZAqKu+8mmBJTlNQRUNUSU9OYCDnsbvor4Hmja7opoHnu5nkurrnnIvvvIjmiKrlm77jgIHpk77mjqXvvInvvIxgVEVTVGAg57G757uZ5Y+v5aSN6LeR55qE57uT5p6c44CCCgojIyBjaGVja3Mg56S65L6LCgpgYGBqc29uClsKICB7ICJjb2RlIjogInR5cGUtY2hlY2siLCAicGFzc2VkIjogdHJ1ZSB9LAogIHsgImNvZGUiOiAidW5pdC10ZXN0IiwgInBhc3NlZCI6IHRydWUsICJtZXNzYWdlIjogIjEyOCBwYXNzZWQiIH0sCiAgeyAiY29kZSI6ICJtaWdyYXRpb24tcm9sbGJhY2siLCAicGFzc2VkIjogdHJ1ZSB9LAogIHsgImNvZGUiOiAicGVyZi1wOTUiLCAicGFzc2VkIjogZmFsc2UsICJtZXNzYWdlIjogIlA5NSAxLjJz77yM6LaF6L+HIDgwMG1zIOmYiOWAvCIgfQpdCmBgYAoKIyMg5Lqk5o6lCgrkuqTku5ggYEFydGlmYWN0U2V0YO+8jOi/m+WFpSBgUkVWSUVXX1BFTkRJTkdg77yb5om55YeG44CB6L+U5L+u44CB5pKk6ZSA6YO955Sx5Lq65ZyoIFdlYiDkvZzlh7rvvIxBZ2VudCDkuI3oh6rooYzlhbPpl6jjgIIK"
      },
      {
        "resourceId": "skill-design-contract",
        "path": "roles/backend/skills/design-contract/SKILL.md",
        "sha256": "dc5b1da4d174f24da1e7b26b393beeeb43178078b708c63b116952826e391e99",
        "byteLength": 1793,
        "mediaType": "text/markdown",
        "bodyBase64": "LS0tCm5hbWU6IGRlc2lnbi1jb250cmFjdApkZXNjcmlwdGlvbjog5LuOIFBSRCDkuI7pqozmlLbmjqjlr7zmjqXlj6PlpZHnuqbjgIHmlbDmja7lj5jmm7TkuI7plJnor6/noIHvvIzkvZzkuLrliY3nq6/lkozmtYvor5XlubbooYzlvIDlt6XnmoTlhbHlkIzlj4LnhafvvJvlvZMgUFJEIOWwsee7quOAgemcgOimgeWumuWlkee6puaXtuS9v+eUqOOAggpsaWNlbnNlOiBNSVQKbWV0YWRhdGE6CiAgcm9sZUtleTogYmFja2VuZAogIHBhY2thZ2VWZXJzaW9uOiAwLjEuMAotLS0KCiMg6K6+6K6h5aWR57qmCgojIyDkvZXml7bnlKgKCi0gUFJEIOW3suWPkeW4g++8jOW8gOW3peWJjemcgOimgeehruWumuaOpeWPo+S4juaVsOaNruWPmOabtOOAggotIOW3suacieWlkee6pumcgOimgemaj+mcgOaxguWPmOabtOWNh+eJiOOAggoKIyMg5q2l6aqkCgoxLiDor7sgUFJEIOeahOebruagh+OAgeiMg+WbtOS4jumqjOaUtu+8jOWIl+WHuumcgOimgeaatOmcsueahOiDveWKm+OAggoyLiDmib7lj5flvbHlk43ljZXlhYPvvJrmnKzmnI3liqHjgIHkuIrkuIvmuLjmnI3liqHjgIHlpJbpg6jns7vnu5/jgIIKMy4g5a6a5LmJ5o6l5Y+j77ya6Lev5b6E44CB5pa55rOV44CB5YWl5Y+C44CB5Ye65Y+C44CB5YiG6aG144CB6ZSZ6K+v56CB44CCCjQuIOWumuS5ieaVsOaNruWPmOabtO+8muihqOe7k+aehOOAgei/geenu+OAgeWbnua7muOAgeWFvOWuueeql+WPo+OAggo1LiDlhpnlpLHotKXmqKHlvI/vvJrotoXml7bjgIHpmZDmtYHjgIHkuIvmuLjkuI3lj6/nlKjml7bnmoTooYzkuLrjgIIKNi4g5Lqn5Ye6IGBjb250cmFjdC5tZGDvvIzlkIzmraXnu5nliY3nq6/kuI4gUUHjgIIKCiMjIOinhOWImQoKLSDlpZHnuqblhYjkuo7lrp7njrDvvJrmsqHmnInlpZHnuqbkuI3orqnliY3nq6/lvIDlt6XjgIIKLSDlkJHlkI7lhbzlrrnkvJjlhYjvvJrnoLTlnY/mgKflj5jmm7TotbDlubPooYzlj5jmm7TvvIhleHBhbmQg4oaSIG1pZ3JhdGUg4oaSIGNvbnRyYWN077yJ44CCCi0g6ZSZ6K+v56CB56iz5a6a77ya5aSN55So5bey5pyJ6ZSZ6K+v56CB77yM5paw5aKe6KaB5YaZ5riF5ZCr5LmJ5LiO6Kem5Y+R5p2h5Lu244CCCi0g5LiN5rOE6Zyy5YaF6YOo57uT5p6E77ya5Ye65Y+C5Y+q5pq06Zyy6LCD55So5pa56ZyA6KaB55qE5a2X5q6144CCCi0g5q+P5Liq5o6l5Y+j6Iez5bCR5YaZ5LiA5p2h5aSx6LSl6Lev5b6E77yM5Y+q5YaZIGhhcHB5IHBhdGgg55qE5aWR57qm5LiN566X5a6M5oiQ44CCCgojIyDlubPooYzlj5jmm7QKCuegtOWdj+aAp+WPmOabtOWIhuS4ieatpe+8jOS4jeWFgeiuuOS4gOatpeWIsOS9je+8mgoKMS4gKipFeHBhbmQqKu+8muaWsOaXp+S4pOeJiOW5tuWtmO+8jOaXp+eJiOS4jeWKqOOAggoyLiAqKk1pZ3JhdGUqKu+8muWJjeerr+S4juiwg+eUqOaWueWIhuaJuei/geenu+OAggozLiAqKkNvbnRyYWN0KirvvJrlhajpg6jov4Hnp7vlkI7lho3kuIvnur/ml6fniYjjgIIKCiMjIOS6pOaOpQoK5Lqn5Ye6IGBjb250cmFjdC5tZGAg5YCZ6YCJ77yM5Lqk5YmN56uv44CBUUHjgIHov5Dnu7Tnoa7orqTjgIJIVU1BTiDlj5HluIPlubbnu5HlrprliLDmjqXmlLbop5LoibLlkI7vvIzliY3nq6/lj6/ku6XnhaflpZHnuqblhpnpgLvovpHkuI4gbW9ja++8jFFBIOWPr+S7peeFp+Wlkee6puWGmeeUqOS+i+OAguWPquaciea1geeoi+atpemqpOWjsOaYjiBgS05PV0xFREdFYCDovpPlh7rml7bmiY3og73kvZzkuLror6Xku7vliqHlt6Xku7bkuqTku5jvvJvlj6rlo7DmmI4gYElNUExgIOeahOWunueOsOS7u+WKoeS4jeaOiOS6iOWlkee6puWPkeW4g+adg+mZkOOAggo="
      },
      {
        "resourceId": "skill-diagnose-bug",
        "path": "roles/backend/skills/diagnose-bug/SKILL.md",
        "sha256": "c1a3dabbf8aaf1385f35e883ad1422d078aeeb3756e8893e7cdd8172d168f51d",
        "byteLength": 1234,
        "mediaType": "text/markdown",
        "bodyBase64": "LS0tCm5hbWU6IGRpYWdub3NlLWJ1ZwpkZXNjcmlwdGlvbjog5Lul5Y6f5aeL5aSN546w5ZKM5Luj56CB6K+B5o2u6K+K5pat57y66Zm344CB6ZmQ5a6a5L+u5aSN6IyD5Zu05bm25a6J5o6S5aSN6aqM77yb5b2T5pei5pyJ6KGM5Li65o2f5Z2P6ICM6Z2e5paw5aKe5Lqn5ZOB6IyD5Zu05pe25L2/55So44CCCmxpY2Vuc2U6IE1JVAptZXRhZGF0YToKICByb2xlS2V5OiBiYWNrZW5kCi0tLQoKIyDor4rmlq3kuI7kv67lpI3nvLrpmbcKCjEuIOS/neWtmOWOn+aKpeWRiuOAgemihOacn+S4juWunumZheihjOS4uuOAgeacgOWwj+WkjeeOsOOAgeeJiOacrOWSjOeOr+Wig+OAguS4jeiDveWkjeeOsOaXtuWGmeadoeS7tuS4jue8uuWPo++8jOS4jeWFiOeMnOWOn+WboOaUueS7o+eggeOAggoyLiDor4rmlq3pmLbmrrXlj6ror7vosIPmn6Xku6PnoIHjgIHml6Xlv5flkoznm7jlhbPlpZHnuqbvvIzljLrliIbkuqflk4HnvLrpmbfjgIHnlKjkvovplJnor6/jgIHnjq/looPpl67popjkuI7mlrDlop7pnIDmsYLjgIIKMy4g6K6w5b2V5qC55Zug6K+B5o2u44CB5Y+X5b2x5ZON5qih5Z2X44CB5pyA5bCP5L+u5aSN44CB5Zue5b2S6aOO6Zmp5Y+K6aqM6K+B5pa55qGI44CC5bey5pyJ6IyD5Zu05LiO5o6I5p2D6Laz5aSf5pe257un57ut5L+u5aSN77yb5paw5aKe6IyD5Zu05Lqk546w5pyJ5Y+Y5pu05rWB56iL5Yaz5a6a44CCCjQuIOWunueOsOWPquS/ruW3suWumuS9jeWOn+WboO+8jOWBj+emu+iuoeWIkueVmeS4i+S+neaNruOAguaMiemjjumZqeihpeacieaEj+S5ieeahOWbnuW9kuajgOafpe+8m+ebuOWFs+a1i+ivlemAmui/h+WQjuW/hemhu+mHjei3keWOn+Wni+WkjeeOsOOAggo1LiDorrDlvZXljp/lp4vpl67popjlt7LlpI3pqozjgIHpg6jliIbpqozor4HmiJbku43lpLHotKXvvIzpmYTlrp7pmYXlkb3ku6TkuI7nu5PmnpzjgILmtYvor5XlpZfku7blhajnu7/kuI3og73mm7/ku6Pljp/lp4vlpI3njrDvvJvnvLrnjq/looPkuI3og73lhpnlt7Lkv67lpI3jgIIKNi4g5oqK6K+K5pat44CB5L+u5aSN44CB6aqM6K+B6K6w5b2V5ZCI5bm26L+bIGBpbXBsLm1kYO+8jOS6pCBRQSDmjIkgYGF1ZGl0LWRlbGl2ZXJ5YCDlpI3moLjlkowgSFVNQU4g6aqM5pS244CCCgrlsI/ojIPlm7TnvLrpmbfkuI3lvLrliLbph43lhpnlrozmlbQgUFJE77yb5q2j5byP5Lu75Yqh5LuN6ZyA5b2T5YmN5Z+657q/44CB6K6k6aKG5ZKM5Lqk5LuY77yM5LiN57uV6L+H5pei5pyJ5om55YeG44CCCg=="
      },
      {
        "resourceId": "skill-implement-change",
        "path": "roles/backend/skills/implement-change/SKILL.md",
        "sha256": "da8e2ae73a3743e39551e515eaefca409175a2f263aaf057c40427a9e96c06ed",
        "byteLength": 1401,
        "mediaType": "text/markdown",
        "bodyBase64": "LS0tCm5hbWU6IGltcGxlbWVudC1jaGFuZ2UKZGVzY3JpcHRpb246IOaMieW3suWPkeW4g+Wlkee6puWunueOsOS7o+egge+8jOWbnumTvumcgOaxgue8luWPt+W5tuWujOaIkOiHqua1i++8jOS6p+WHuuWunueOsOivtOaYju+8m+W9k+Wlkee6puW3suWPkeW4g+OAgeS7u+WKoeW3suiupOmihuaXtuS9v+eUqOOAggpsaWNlbnNlOiBNSVQKbWV0YWRhdGE6CiAgcm9sZUtleTogYmFja2VuZAogIHBhY2thZ2VWZXJzaW9uOiAwLjEuMAotLS0KCiMg5a6e546w5Y+Y5pu0CgojIyDkvZXml7bnlKgKCi0g5aWR57qm5bey5Y+R5biD77yM5Lu75Yqh5bey6K6k6aKG44CCCi0g6ZyA6KaB5Zyo5pei5pyJ5pyN5Yqh5LiK5YGa5aKe6YeP5pS55Yqo44CCCgojIyDmraXpqqQKCjEuIOWPluS4iuS4i+aWh++8mlBSRCDpqozmlLbjgIHlpZHnuqbjgIHljZXlhYPljaHjgIHpobnnm67op4TojIPjgIIKMi4g5a6a5L2N5pS55Yqo6Z2i77ya5qih5Z2X44CB5o6l5Y+j44CB6KGo44CB5Y+X5b2x5ZON6LCD55So5pa544CCCjMuIOe8luegge+8muaMieWlkee6puWunueOsO+8jOS4jeaTheiHquaJqeWxleaOpeWPo+OAggo0LiDoh6rmtYvvvJrmraPluLjot6/lvoTjgIHovrnnlYzjgIHplJnor6/ot6/lvoTjgIHmnYPpmZDjgIIKNS4g5o+Q5Lqk77yaY29tbWl0IOato+aWh+W4pumcgOaxgue8luWPt+S4juS7u+WKoee8luWPt+OAggo2LiDkuqflh7ogYGltcGwubWRg44CCCgojIyDop4TliJkKCi0g5LiN6IeG6YCg5o6l5Y+j77ya5aWR57qm6YeM5rKh5pyJ55qE5a2X5q615LiN5Yqg77yb56Gu5a6e6ZyA6KaB5bCx5Zue6Zeu77yM6LWw5Y+Y5pu044CCCi0g5LiN6Lez6L+H6L+B56e777ya5pWw5o2u5Y+Y5pu05b+F6aG75bim6L+B56e75LiO5Zue5rua5pa55qGI44CCCi0g5rOo6YeK5Y+q5YaZ44CM5Li65LuA5LmI44CN77yM5LiN5aSN6L+w5Luj56CB77ybVE9ETyDluKbotJ/otKPkurrlkozmnJ/pmZDjgIIKLSDkuI3mlLnlhbbku5bop5LoibLnmoTlt6Xku7bvvJrlpZHnuqblvZLlkI7nq6/vvIzorr7orqHlvZIgVUnvvIzpqozmlLblvZLkuqflk4HjgIIKLSDlt7Lnn6XpmZDliLblhpnov5sgYGltcGwubWRg77yM5LiN6ZqQ6JeP44CCCgojIyDoh6rmtYvmuIXljZUKCi0gWyBdIOato+W4uOi3r+W+hOmAmui/h+OAggotIFsgXSDovrnnlYzvvIjnqbrlgLzjgIHotoXplb/jgIHlubblj5HvvInmnInopobnm5bjgIIKLSBbIF0g6ZSZ6K+v6Lev5b6E6L+U5Zue57qm5a6a6ZSZ6K+v56CB44CCCi0gWyBdIOadg+mZkOS4jumJtOadg+acquiiq+aUvuWuveOAggotIFsgXSDov4Hnp7vlj6/lm57mu5rvvIzkuJTmvJTnu4Pov4fjgIIKCiMjIOS6pOaOpQoK5Lqn5Ye6IGBpbXBsLm1kYCArIOaPkOS6pOW8leeUqO+8jOS6pOivhOWuoeOAguivhOWuoemAmui/h+WJjeS4jei/m+WFpSBgRE9ORWDjgIIK"
      },
      {
        "resourceId": "skills-index",
        "path": "roles/backend/skills/index.md",
        "sha256": "a7f8e7411e514e34ecf241a90b7e6e378c620cb9bd858f1f1b9c95d037037211",
        "byteLength": 1424,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDlkI7nq6/op5LoibLljIUgwrcg5oqA6IO957Si5byVCgp8IOaKgOiDvSAgICAgICAgICAgICAgIHwg5YGa5LuA5LmIICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfCDkvZXml7bnlKggICAgICAgICAgICAgICAgIHwKfCAtLS0tLS0tLS0tLS0tLS0tLS0gfCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSB8IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gfAp8IGBkZXNpZ24tY29udHJhY3RgICB8IOS7jiBQUkQg5o6o5a+85o6l5Y+j5aWR57qm44CB5pWw5o2u5Y+Y5pu05LiO6ZSZ6K+v56CBICB8IFBSRCDlsLHnu6rjgIHlvIDlt6XliY0gICAgICAgfAp8IGBwbGFuLWNoYW5nZWAgICAgICB8IOiwg+afpeeOsOeKtuOAgeiusOW9leWPluiIjeOAgeaLhuino+S7u+WKoeWPiuaWh+S7tuW9kuWxniB8IOiAgemhueebruaIluWkjeadguWPmOabtOW8gOW3peWJjSB8CnwgYGRpYWdub3NlLWJ1Z2AgICAgIHwg5Y6f5aeL5aSN546w44CB5qC55Zug6K+K5pat44CB5pyA5bCP5L+u5aSN5LiO5aSN6aqMICAgICB8IOW3suacieihjOS4uuaNn+Wdj+aXtiAgICAgICAgIHwKfCBgaW1wbGVtZW50LWNoYW5nZWAgfCDmjInlpZHnuqblrp7njrDlubboh6rmtYsgICAgICAgICAgICAgICAgICAgICAgIHwg5aWR57qm5bey5Y+R5biD44CB5Lu75Yqh5bey6K6k6aKGIHwKfCBgYXR0YWNoLWV2aWRlbmNlYCAgfCDmlLbpm4bmj5DkuqTnuqfor4Hmja7lubbkuqTku5ggICAgICAgICAgICAgICAgICAgfCDlrp7njrDlrozmiJDjgIHlh4blpIfkuqTku5ggICAgIHwKCiMjIOS9v+eUqOmhuuW6jwoKYGBgCnBsYW4tY2hhbmdl77yI5oyJ5aSN5p2C5bqm6YCJ5oup77yJ4oaSIGRlc2lnbi1jb250cmFjdCDihpIgaW1wbGVtZW50LWNoYW5nZSDihpIgYXR0YWNoLWV2aWRlbmNlCmBgYAoK5aWR57qm5piv5bm26KGM5byA5Y+R55qE5pSv54K577ya5YmN56uv44CB5rWL6K+V6YO96Z2g5a6D5byA5bel44CCKirlpZHnuqbmsqHlj5HluIPkuYvliY3vvIzkuI3opoHlvIDlp4vlhpnlrp7njrAqKu+8jOWQpuWImeWJjeerr+WPquiDveeMnOOAggrlt7LmnInooYzkuLrmjZ/lnY/ml7bku44gYGRpYWdub3NlLWJ1Z2Ag6L+b5YWl77yM5aSN55So5b2T5YmNIFBSRCDlkozlpZHnuqbvvJvmjInpo47pmankv53nlZnor4rmlq3jgIHkv67lpI3jgIHljp/lp4vlpI3njrDnu5PmnpzvvIzkuI3lvLrliLbph43otbDmlrDlip/og73mlofmoaPjgIIKCiMjIOS6pOaOpQoKLSDlpZHnuqYg4oaSIGBjb250cmFjdC5tZGDvvIzkuqTliY3nq6/jgIFRQeOAgei/kOe7tOa2iOi0ue+8m+WPmOabtOi1sOW5s+ihjOWPmOabtOOAggotIOWunueOsCDihpIgYGltcGwubWRgICsg5o+Q5Lqk5byV55So77yM5Lqk6K+E5a6h44CCCi0g5Lqk5LuYIOKGkiBgQXJ0aWZhY3RTZXRgICsgYGNoZWNrc1tdYO+8jOS6pOS6uuW3pemqjOaUtuOAggo="
      },
      {
        "resourceId": "skill-plan-change",
        "path": "roles/backend/skills/plan-change/SKILL.md",
        "sha256": "806d12def1507648159f14b1ab5f4c16e7af4df16e785775f9d1191a8485f853",
        "byteLength": 1942,
        "mediaType": "text/markdown",
        "bodyBase64": "LS0tCm5hbWU6IHBsYW4tY2hhbmdlCmRlc2NyaXB0aW9uOiDosIPmn6Xml6LmnInku6PnoIHlubbmiorlt7Lnoa7orqTpqozmlLbovazmiJDluKbkvp3mja7jgIHku7vliqHkvp3otZblkozmlofku7blvZLlsZ7nmoTlrp7njrDorqHliJLvvJvlvZPot6jmqKHlnZfmlLnliqjjgIHogIHpobnnm67mjqXlhaXmiJblpI3mnYLlpZHnuqblj5jmm7TpnIDopoHlvIDlt6Xop4TliJLml7bkvb/nlKjjgIIKbGljZW5zZTogTUlUCm1ldGFkYXRhOgogIHJvbGVLZXk6IGJhY2tlbmQKLS0tCgojIOiwg+afpeS4juWunueOsOiuoeWIkgoKMS4g5Zu65a6a5Lu75Yqh5b+r54Wn44CBUFJEIOS/ruiuouOAgeS7k+W6k+S4juS7o+eggeeJiOacrOOAguivu+WPlumhueebruinhOiMg+OAgeebuOmCu+aooeWdl+WSjOW3suaciea1i+ivle+8jOWFiOaPj+i/sOeOsOeKtuWPiuS4jeWFgeiuuOegtOWdj+eahOihjOS4uuOAggoyLiDku4XosIPmn6XkvJrlvbHlk43mnKzmrKHmlrnmoYjnmoTmnKrnn6XpobnjgILmr4/pobnorrDlvZXvvJrpl67popjjgIHku6PnoIHmiJblrpjmlrnmlofmoaPkvp3mja7jgIHpgInlrprmlrnmoYjjgIHmlL7lvIPnmoTmlrnmoYjlj4rnkIbnlLHvvJvmnKrog73noa7orqTnmoTlhpkgVU5LTk9XTuOAggozLiDlhpnmuIXmlbDmja7mqKHlnovjgIHmjqXlj6PlpZHnuqbjgIHplJnor6/ooYzkuLrjgIHov4Hnp7vkuI7mgaLlpI3jgIHpqozor4Hlkb3ku6Tlj4rmjqXmlLbmlrnjgILnroDljZXmlLnliqjlj6/nm7TmjqXlhpnlhaUgYGltcGwubWRgIOWJjeWNiumDqOWIhu+8jOWkjeadguaUueWKqOS9v+eUqCBgY2hhbmdlLXBsYW4ubWRg44CCCjQuIOaMieeUqOaIt+S7t+WAvOS4uuWkmuWcuuaZr+aghyBQMS9QMi9QM++8jOWFiOivhuWIq+acgOWwj+WPr+eUqOOAgeerr+WIsOerr+S4lOWPr+eLrOeri+mqjOivgeeahCBNVlAg5YiH54mH77yM5bm25YaZ5piO5Lqk5LuY5qOA5p+l54K577yb6K6w5b2V5L2O5LyY5YWI57qn5bu25pyf55CG55Sx5ZKM5oGi5aSN5p2h5Lu244CC566A5Y2V5pS55Yqo5LiN5by65Yi25YiG5pyf44CCCjUuIOaMieWPr+eLrOeri+mqjOaUtueahOS4muWKoeWcuuaZr+aLhuS7u+WKoe+8jOavj+mhueaYjuehriBgYWNjZXB0YW5jZUtleXMgLyBkZXBlbmRzT24gLyBmaWxlcyAvIOmqjOivgeaWueazlWDjgILln7rnoYDkvp3otZblj6/lhYjlgZrvvIzkvYborqHliJLopoHorqnpppbkuKrliIfniYflsL3ml6nkuqfnlJ/nlKjmiLfku7flgLzjgIIKNi4g5Y+q5pyJ5peg5pyq5ruh6Laz5L6d6LWW44CB5paH5Lu25b2S5bGe5LiN6YeN5Y+g55qE5Lu75Yqh5omN5qCH5Y+v5bm26KGM77yb5qCH6K6w5LiN5o6I5LqI5bmz5Y+w5aSW6aKG5Y+W44CB5omn6KGM5oiW5om55YeG5p2D6ZmQ44CCCjcuIOWvueW3suaciee8uumZt+WFiOiusOW9leWPr+WkjeeOsOeahOWksei0peaIlumUgeWumuW9k+WJjeihjOS4uu+8m+aMiemjjumZqeWuieaOkuWlkee6puWSjOmbhuaIkOmqjOivge+8jOe6r+aWh+ahiOS/ruaUueS4jemineWkluWItumAoOa1i+ivleOAggo4LiDmoLjlr7kgUFJE44CB6K6h5YiS44CB5Lu75Yqh44CB55So5L6L5piv5ZCm6KaG55uW5LiA6Ie044CC5Y+v5bCG5a+55bqU5pWw5o2u5YaZ5Li66LSo6YeP5YyF5bm26L+Q6KGMIGB3b3JrbWVzaCBxdWFsaXR5IC0tZmlsZSBxdWFsaXR5LWJ1bmRsZS5qc29uIC0tanNvbmDvvJvpgJrov4flj6rooajnpLrmnKzlnLDmlbDmja7kuIDoh7TjgIIKCiMjIOS6pOaOpQoK6K6h5YiS5L+d55WZ5Zyo5pys5qyh5Lu75Yqh5YWB6K6455qEIElNUEwg5q2j5paH5oiW6K+E5a6h5p2Q5paZ77yM5aWR57qm5LuN6LWw5pei5pyJ55+l6K+G5YCZ6YCJ5Y+R5biD44CC5Lu75Yqh5ouG5YiG5Li65o+Q5qGI77yM55Sx546w5pyJ5rWB56iL56Gu6K6k77yb5LiN5b6X6Ieq5Yqo5aKe5Yqg5bel5L2c5rWB5q2l6aqk5oiW5L+u5pS55bey5om55YeG55qE6IyD5Zu044CCCg=="
      }
    ]
  },
  {
    "packageId": "workmesh.role.frontend",
    "version": "1.2.1",
    "roleKey": "frontend",
    "manifest": {
      "packageSchemaVersion": "1.1",
      "id": "workmesh.role.frontend",
      "version": "1.2.1",
      "protocolVersion": "1.0",
      "title": "前端角色包",
      "description": "按契约与设计规格实现界面，先脚手架后细节，交付可复核的实现说明。",
      "license": "MIT",
      "roleKey": "frontend",
      "compatibility": {
        "minCliVersion": "1.0.0",
        "maxCliVersionExclusive": "2.0.0",
        "contractVersion": "1.0"
      },
      "skills": [
        {
          "key": "consume-contract",
          "path": "skills/consume-contract/SKILL.md",
          "description": "读取接口契约与设计规格，产出实现方案并建立 mock，使前端可以在后端完成前开工。",
          "whenToUse": "契约已发布、设计规格可用时。"
        },
        {
          "key": "implement-ui",
          "path": "skills/implement-ui/SKILL.md",
          "description": "按设计规格实现界面与交互，覆盖状态与异常，并完成自测。",
          "whenToUse": "设计规格与契约就绪、任务已认领时。"
        }
      ],
      "inputs": [
        {
          "key": "context",
          "source": "TASK_SNAPSHOT",
          "kind": "CONTEXT",
          "required": true,
          "contractVersion": "1.0"
        },
        {
          "key": "prd",
          "source": "KNOWLEDGE",
          "kind": "PRD",
          "required": true,
          "contractVersion": "1.0"
        },
        {
          "key": "contract",
          "source": "KNOWLEDGE",
          "kind": "KNOWLEDGE",
          "required": true,
          "contractVersion": "1.0"
        },
        {
          "key": "design",
          "source": "KNOWLEDGE",
          "kind": "DESIGN",
          "required": false,
          "contractVersion": "1.0"
        }
      ],
      "outputs": [
        {
          "key": "impl",
          "channel": "CANDIDATE",
          "kind": "IMPL",
          "contractVersion": "1.0",
          "templateResourceId": "template-impl",
          "evidence": [
            "TEST",
            "INSPECTION"
          ]
        }
      ],
      "resources": [
        {
          "id": "template-impl",
          "kind": "template",
          "path": "assets/templates/impl.md",
          "sha256": "607eafffd4eb85c24c86fe66f93d87b4078c991af8852068fa13a5032167324c",
          "byteLength": 962,
          "mediaType": "text/markdown"
        },
        {
          "id": "checklist-impl-selfcheck",
          "kind": "checklist",
          "path": "checklists/impl-selfcheck.md",
          "sha256": "ec1a09251b31bd9cb0a78e641f3fbaf3d5c08956e062c4f4cc6d4536f9592165",
          "byteLength": 703,
          "mediaType": "text/markdown"
        },
        {
          "id": "checklist-spec-driven",
          "kind": "checklist",
          "path": "checklists/spec-driven.md",
          "sha256": "eddb341cf017d46fc1a03cf0a89de031acdc1d72ec318fa2ae8a55a48ade6bac",
          "byteLength": 1124,
          "mediaType": "text/markdown"
        },
        {
          "id": "guide",
          "kind": "prompt",
          "path": "guide.md",
          "sha256": "9da3a5d151e1b39bd1e9650d5bad711a072c99e97d71e720f980eafc6244aa05",
          "byteLength": 3388,
          "mediaType": "text/markdown"
        },
        {
          "id": "reference-references",
          "kind": "reference",
          "path": "references/references.json",
          "sha256": "2cdd11e887066d0901aec56bde5539dc86c36223cf6fd54f38569831d459448d",
          "byteLength": 541,
          "mediaType": "application/json"
        },
        {
          "id": "skill-consume-contract",
          "kind": "skill",
          "path": "skills/consume-contract/SKILL.md",
          "sha256": "d2c055f6b390cdeeff73317f7ecf8dc4959dc702cbadae627a99be3293107c86",
          "byteLength": 1398,
          "mediaType": "text/markdown"
        },
        {
          "id": "skill-implement-ui",
          "kind": "skill",
          "path": "skills/implement-ui/SKILL.md",
          "sha256": "7e202cb1e166e1aac04f32cde8ac158884989e18c3b710140fbc5c07d43070a6",
          "byteLength": 1353,
          "mediaType": "text/markdown"
        },
        {
          "id": "skills-index",
          "kind": "index",
          "path": "skills/index.md",
          "sha256": "70490b65a3141bfb3cf9a71a68ba7d924d94e8545514ae9272fd971ce0ac80e8",
          "byteLength": 749,
          "mediaType": "text/markdown"
        }
      ],
      "agentEntries": [
        {
          "host": "codex",
          "type": "AGENTS_MD_POINTER",
          "resourceId": "skills-index",
          "adapterVersion": "1.0.0"
        },
        {
          "host": "claude-code",
          "type": "SKILLS_DIRECTORY",
          "resourceId": "skills-index",
          "adapterVersion": "1.0.0"
        }
      ]
    },
    "resources": [
      {
        "resourceId": "template-impl",
        "path": "roles/frontend/assets/templates/impl.md",
        "sha256": "607eafffd4eb85c24c86fe66f93d87b4078c991af8852068fa13a5032167324c",
        "byteLength": 962,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDliY3nq6/lrp7njrDor7TmmI7vvJo86ZyA5rGC5qCH6aKYPgoKPiDpnIDmsYLnvJblj7fvvJo8UFJPSkVDVF9LRVk+LTzluo/lj7c+IMK3IOS7u+WKoe+8mjzpnIDmsYLnvJblj7c+L2ltcGwKPiDmj5DkuqTvvJo8Y29tbWl0IHNoYT4gwrcg5aWR57qm54mI5pys77yadjEKCiMjIDEuIOaUueWKqOiMg+WbtAoKfCDpobXpnaIgLyDnu4Tku7YgfCDmlLnliqggICAgICAgIHwg5aSN55SoICAgICAgIHwKfCAtLS0tLS0tLS0tLSB8IC0tLS0tLS0tLS0tIHwgLS0tLS0tLS0tLSB8CnwgICAgICAgICAgICAgfCDmlrDlop4gLyDkv67mlLkgfCDnjrDmnInnu4Tku7blkI0gfAoKIyMgMi4g5o6l5Y+j5L6d6LWWCgp8IOaOpeWPoyB8IOeUqOmAlCB8IOeKtuaAgSAgICAgICAgICB8CnwgLS0tLSB8IC0tLS0gfCAtLS0tLS0tLS0tLS0tIHwKfCAgICAgIHwgICAgICB8IG1vY2sgLyDlt7LogZTosIMgfAoKIyMgMy4g54q25oCB6KaG55uWCgp8IOeKtuaAgSAgICAgfCDlrp7njrDmlrnlvI8gfAp8IC0tLS0tLS0tIHwgLS0tLS0tLS0gfAp8IOato+W4uCAgICAgfCAgICAgICAgICB8Cnwg56m6ICAgICAgIHwgICAgICAgICAgfAp8IOmUmeivryAgICAgfCAgICAgICAgICB8Cnwg5Yqg6L29ICAgICB8ICAgICAgICAgIHwKfCDmnYPpmZDlj5fpmZAgfCAgICAgICAgICB8CgojIyA0LiDoh6rmtYvorrDlvZUKCnwg6aG5ICAgICAgIHwg57uT5p6cIHwKfCAtLS0tLS0tLSB8IC0tLS0gfAp8IOS6pOS6kiAgICAgfCAgICAgIHwKfCDovrnnlYwgICAgIHwgICAgICB8Cnwg5ZON5bqU5byPICAgfCAgICAgIHwKfCDlj6/orr/pl67mgKcgfCAgICAgIHwKCiMjIDUuIOmqjOaUtuimhueblgoKfCDpqozmlLYga2V5IHwg6K+B5o2uIHwKfCAtLS0tLS0tLSB8IC0tLS0gfAp8IGFjLTAxICAgIHwgICAgICB8CgojIyA2LiDpgZfnlZnkuI7pmZDliLYKCu+8iOayoeacieWwseWGmeOAjOaXoOOAje+8jOS4jeimgeeVmeepuu+8iQo="
      },
      {
        "resourceId": "checklist-impl-selfcheck",
        "path": "roles/frontend/checklists/impl-selfcheck.md",
        "sha256": "ec1a09251b31bd9cb0a78e641f3fbaf3d5c08956e062c4f4cc6d4536f9592165",
        "byteLength": 703,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDliY3nq6/oh6rmo4DmuIXljZUKCi0gWyBdIOS6lOenjeeKtuaAge+8iOato+W4uC/nqbov6ZSZ6K+vL+WKoOi9vS/mnYPpmZDlj5fpmZDvvInpg73mnInlrp7njrDjgIIKLSBbIF0g6ZSZ6K+v5o+Q56S65oyJ6ZSZ6K+v56CB5Yy65YiG77yM5LiN5piv57uf5LiA5paH5qGI44CCCi0gWyBdIOWlkee6puWtl+auteWQjeS4jumUmeivr+eggeS4juWQjuerr+S4gOiHtOOAggotIFsgXSDlpI3nlKjnjrDmnInnu4Tku7bvvIzmnKrph43lpI3pgKDova7lrZDjgIIKLSBbIF0g5YGP56a76K6+6K6h6KeE6IyD5aSE5bey5YaZ5piO5Y6f5Zug44CCCi0gWyBdIOWFs+mUrui3r+W+hOWPr+eUqOmUruebmOWujOaIkOOAggotIFsgXSDlsI/lsY/kuI7plb/mlofmnKzkuI3noLTniYjjgIIKLSBbIF0g5pegIGNvbnNvbGUg5oql6ZSZ44CB5peg5pyq5aSE55CGIFByb21pc2XjgIIKLSBbIF0g5o+Q5Lqk5L+h5oGv5bim6ZyA5rGC57yW5Y+344CCCi0gWyBdIOmqjOaUtiBrZXkg6YO95pyJ5a+55bqU6K+B5o2u44CCCgojIyDkuqTku5jliY3mnIDlkI7kuInpl64KCjEuIOWQjuerr+aKiiBtb2NrIOaNouaOie+8jOmhtemdoui/mOiDveato+W4uOW3peS9nOWQl++8nwoyLiDmjqXlj6PmiqXplJnml7bvvIznlKjmiLfnn6XpgZPkuIvkuIDmraXor6XlgZrku4DkuYjlkJfvvJ8KMy4g6L+Z6aG15Zyo5omL5py65LiK6IO95a6M5oiQ5Li75rWB56iL5ZCX77yfCg=="
      },
      {
        "resourceId": "checklist-spec-driven",
        "path": "roles/frontend/checklists/spec-driven.md",
        "sha256": "eddb341cf017d46fc1a03cf0a89de031acdc1d72ec318fa2ae8a55a48ade6bac",
        "byteLength": 1124,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDop4TmoLzkuI7kuqTku5jljY/kvZzmo4Dmn6UKCuWPquWKoOi9veacrOasoeS7u+WKoea2ieWPiueahOaooeadv+WSjOa4heWNleOAgueugOWNleaUueWKqOWGmeW/heimgeS/oeaBr++8m+WkjeadguW6puadpeiHqumjjumZqeOAgeS+nei1luWSjOmqjOaUtuiMg+WbtO+8jOS4jeaMieWbuuWumumhteaVsOaIlueroOiKguaVsOWIpOaWrei0qOmHj+OAggoKLSBbIF0g5bey6K+75pys5qyh5b+r54Wn5LiO6aG555uu6KeE6IyD77yM56Gu6K6kIFBSRC/nn6Xor4bkv67orqLvvJvogIHpobnnm67lhYjmoLjlr7nlrp7pmYXku6PnoIHjgIHlt6XlhbfphY3nva7kuI7njrDmnInooYzkuLrjgIIKLSBbIF0g5YWz6ZSu57uT6K665pyJ5p2l5rqQ77yb6LCD5p+l5pyq55+l6aG544CB5pa55qGI5Y+W6IiN44CB5L6L5aSW5LiO5bu25pyf5Z2H5pyJ55CG55Sx5ZKM6LSj5Lu75Lq644CCCi0gWyBdIOS7peW3suehruiupOmqjOaUtiBrZXkg5YWz6IGU5pys6KeS6Imy5Lqn54mp77yb5Lu75Yqh5YiX5L6d6LWW44CB6LSf6LSj5paH5Lu25LiO6aqM6K+B5pa55byP77yM5YWx55So5paH5Lu25LiN5peg5L6d5o2u5Zyw5bm26KGM5L+u5pS544CCCi0gWyBdIOmcgOaxgui0qOmHj+OAgeeUqOS+i+iuvuiuoeimhuebluOAgeWunumZheaJp+ihjOe7k+aenOWSjCBIVU1BTiDmraPlvI/pqozmlLbliIbliKvorrDlvZXjgIIKLSBbIF0g5omA5pyJ5pyq6L+Q6KGM44CB5aSx6LSl44CB6Zi75aGe44CB5peg5rOV5qC46aqM55qE5YaF5a655piO56Gu5qCH5Ye677ybQWdlbnQg5oql5ZGK5LiN5aOw56ew54us56uL6aqM6K+B44CCCi0gWyBdIOe8uuWPo+S7peeos+WumiBJRCDov73liqDlubblm57pk77ljp/orrDlvZXvvJvotoXlh7rpnIDmsYLojIPlm7TlhYjotbDlj5jmm7TvvIzkv67mlLnln7rnur/lkI7ph43mlrDmoLjlr7nor4Hmja7jgIIKCuinkuiJsui1hOa6kOabtOaWsO+8muW3sumUgeWumueJiOacrOS/neaMgeWOn+Wtl+iKgu+8jOaWsOaWueazleWcqOaWsOWMheeJiOacrOWuieijheWQjueUn+aViOOAguWuv+S4u+WFpeWPo+WPquaMh+WQkeinkuiJsui1hOa6kO+8m+mhueebruiHquWumuS5ieinhOiMg+maj+mhueebruefpeivhuS/ruiuou+8jOS4jeWkjeWItui/m+inkuiJsuWMheOAggo="
      },
      {
        "resourceId": "guide",
        "path": "roles/frontend/guide.md",
        "sha256": "9da3a5d151e1b39bd1e9650d5bad711a072c99e97d71e720f980eafc6244aa05",
        "byteLength": 3388,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDliY3nq6/op5LoibLvvIhmcm9udGVuZO+8iQoK5L2g5Z+65LqOIENvbnRleHRTbmFwc2hvdCDph4zms6jlhaXnmoQgUFJEIOWfuue6v+S4juiuvuiuoeS6p+WHuiBgSU1QTGAg5bel5Lu244CCCuS9oOeahOS6pOS7mOW/hemhu+iDveiiq+S6uuexu+eUqCoq5o+Q5Lqk57qn6K+B5o2uKirlpI3moLjvvIzogIzkuI3mmK/pnaDlj6PlpLTor7TmmI7jgIIKCiMjIOi+ueeVjAoKLSDlj6rkuqflh7ogYElNUExg77yb5LiN5pS5IFBSROOAgeS4jeaUuea1geeoi+WumuS5ieOAgeS4jeWPkeW4g+OAgeS4jeaJueWHhuOAggotIOS6pOS7mOimgeS5iOaYr+aJmOeuoeWtl+iKgu+8iGBIT1NURURg77yJ77yM6KaB5LmI5piv5pys6aG555uu5bey55m76K6w5LuT5bqT6YeM55qE5a6M5pW0IGNvbW1pdO+8iGBHSVRfUkVGYO+8ie+8mwogIOS4jeWFgeiuuCLku6PnoIHlnKjmiJHmnKzlnLDvvIzlhYjnu5nmiJHov4ci44CCCi0g5om55YeG5Y+q5Y+R55Sf5ZyoIFdlYiDor4TlrqHpobXvvIznlLEgSFVNQU4g5a6M5oiQ44CCCgojIyDkuIDmrKHlrozmlbTlvqrnjq8KCmBgYGJhc2gKd29ya21lc2ggYXV0aCBsb2dpbgoKd29ya21lc2ggY29udGV4dCAtLXRhc2sgPHRhc2tJZD4gLS1pbnNwZWN0CndvcmttZXNoIGNsYWltIC0tdGFzayA8dGFza0lkPgp3b3JrbWVzaCBjb250ZXh0IC0tdGFzayA8dGFza0lkPiAtLWNsYWltIDxjbGFpbUlkPiAtLWV4cGVjdGVkLXZlcnNpb24gPHRhc2tWZXJzaW9uPiAtLW1hdGVyaWFsaXplCgojIDEpIOWFiOivu+S4iuS4i+aWh++8jOehruiupCBQUkQg5Z+657q/5LiO6aqM5pS25p2h5qy+77yb5Z+657q/57y65aSx5bCx5YGc77yM5LiN6KaB5Yet5Y2w6LGh5a6e546wCmNhdCAud29ya21lc2gvbG9jYWwvY29udGV4dC88c25hcHNob3RJZD4vbWFuaWZlc3QuanNvbgoKIyAyKSDlrp7njrDlubbmj5DkuqTliLDku5PlupPvvIzmi7/liLDlrozmlbQgY29tbWl0IHNoYQpnaXQgcmV2LXBhcnNlIEhFQUQKCiMgMykg5Lqk5LuYCndvcmttZXNoIGRlbGl2ZXIgXAogIC0tdGFzayA8dGFza0lkPiAtLWNsYWltIDxjbGFpbUlkPiAtLXNuYXBzaG90IDxzbmFwc2hvdElkPiBcCiAgLS1leHBlY3RlZC12ZXJzaW9uIDx0YXNrVmVyc2lvbj4gXAogIC0tbWFuaWZlc3QgZGVsaXZlci1tYW5pZmVzdC5qc29uCgojIDQpIOS9v+eUqCBkZWxpdmVyIOi/lOWbnueahOecn+WuniByZXZpZXdSZXF1ZXN0SWQg5p+l6K+i6Ieq5Yqo5Yib5bu655qE6K+E5a6hCndvcmttZXNoIHJldmlldyBzaG93IC0tcmV2aWV3IDxyZXZpZXdSZXF1ZXN0SWQ+CmBgYAoKYGRlbGl2ZXJgIOi/lOWbniBgcmV2aWV3UmVxdWVzdElkYOOAgVdlYiDlnLDlnYDlkowgYG9wZXJhdGlvbklkYO+8jOS4jeeUqOWGjeasoeWIm+W7uuWQjOS4gOi9ruivhOWuoeOAgui+k+WHuuS4ouWkseaXtu+8jOeUqCBgd29ya21lc2ggcmVjZWlwdCBzaG93IC0tb3BlcmF0aW9uIDzljp/kuqTku5hvcGVyYXRpb25JZD4gLS1qc29uYCDor7vlj5YgYGRhdGEucmVzdWx0UmVmcy5yZXZpZXdSZXF1ZXN0SWRg77yb5pS25o2u5LuN5Li6IFBFTkRJTkcg5oiW57uT5p6c5pyq55+l5pe277yM5YWI55So5Y6f5pON5L2c57yW5Y+35omn6KGMIGB3b3JrbWVzaCByZWNlaXB0IHJlY29uY2lsZSAtLW9wZXJhdGlvbiA85Y6f5Lqk5LuYb3BlcmF0aW9uSWQ+YOOAguato+W8j+WGs+WumuS7jeeUsSBIVU1BTiDlnKggV2ViIOWujOaIkOOAggoKIyMgZGVsaXZlciBtYW5pZmVzdCDopoHngrkKCmBgYGpzb24KewogICJ3b3JrZmxvd0RlZmluaXRpb25SZXZpc2lvbklkIjogIjxzbmFwc2hvdCDph4zorrDlvZXnmoQgd29ya2Zsb3cg5L+u6K6iPiIsCiAgImxvY2FsUnVuSWQiOiAiPOacrOWcsOWPr+WkjeeOsOeahOi/kOihjOagh+ivhj4iLAogICJjYW5kaWRhdGVSZXZpc2lvbklkcyI6IFtdLAogICJpdGVtcyI6IFsKICAgIHsKICAgICAgImtpbmQiOiAiSU1QTCIsCiAgICAgICJzdG9yYWdlIjogIkdJVF9SRUYiLAogICAgICAibWVkaWFUeXBlIjogInRleHQvcGxhaW4iLAogICAgICAic2hhMjU2IjogIjzlr7nlupTmlofku7bmiJbooaXkuIHnmoQgc2hhMjU2PiIsCiAgICAgICJieXRlTGVuZ3RoIjogNDA5NiwKICAgICAgInByb2plY3RSZXBvc2l0b3J5SWQiOiAiPOmhueebruW3sueZu+iusOS7k+W6kyBpZD4iLAogICAgICAiY29tbWl0U2hhIjogIjw0MCDkvY3lsI/lhpkgaGV477yM5LiN5o6l5Y+X55+tIHNoYT4iLAogICAgICAicmVwb1BhdGgiOiAiYXBwcy93ZWIvc3JjL3BhZ2VzL0NoZWNrb3V0LnRzeCIsCiAgICAgICJzdW1tYXJ5IjogIue7k+eul+mhteaUueS4uuS4pOatpeW8jyIsCiAgICAgICJjaGVja3MiOiBbCiAgICAgICAgeyAiY29kZSI6ICJ0eXBlLWNoZWNrIiwgInBhc3NlZCI6IHRydWUgfSwKICAgICAgICB7ICJjb2RlIjogInVuaXQtdGVzdCIsICJwYXNzZWQiOiB0cnVlIH0KICAgICAgXQogICAgfQogIF0KfQpgYGAKCmBjaGVja3NgIOS8muiiq+WOn+agt+Wxleekuue7meivhOWuoeS6uu+8muWPquWcqOecn+eahOi3kei/h+aXtuWGmSBgcGFzc2VkOiB0cnVlYOOAggoKIyMg56aB5q2iCgotIOS4jeimgeeUqCBgLS1zbmFwc2hvdGAg5oyH5ZCR5Yir5Lq655qE5oiW6L+H5pyf55qE5b+r54Wn77yb5b+r54Wn5LiOIGNsYWltIOS7o+asoeW/hemhu+S4gOiHtO+8jOWQpuWImeacjeWKoeerr+aLkue7neOAggotIOS4jeimgeWcqOWQjOS4gOS4qiByZXBvUGF0aCDkuIrlj43lpI3kuqTku5jkuI3lkIwgY29tbWl0IOadpSLopobnm5Yi5Y6G5Y+y77yb5q+P5qyh5Lqk5LuY6YO95piv6L+95Yqg6K6w5b2V44CCCi0g5LiN6KaB6K+V5Zu+6Ieq5bex5Zyo5pys5Zyw5Yik5a6aIuW3sumAmui/hyLvvJvnirbmgIHnlLHmnI3liqHnq6/kuI7kurrnsbvlhrPlrprjgIIKCiMjIOWksei0peS4jumHjeivlQoKLSDlhpnmk43kvZzkuI3oh6rliqjph43or5XvvJvph43mlL7or7flpI3nlKjlkIzkuIDkuKogYC0tb3BlcmF0aW9uIDx1dWlkPmDjgIIKLSDnu5PmnpzkuI3mmI7vvJpgd29ya21lc2ggcmVjZWlwdCBzaG93IC0tb3BlcmF0aW9uIDx1dWlkPmDvvIzlv4XopoHml7YgYHdvcmttZXNoIHJlY2VpcHQgcmVjb25jaWxlYOOAggotIOiiq+imgeaxguS/ruaUue+8muaMieW9k+WJjeS7u+WKoeWSjCBjbGFpbSDnirbmgIHov5Tkv67lkI7ph43mlrAgYGRlbGl2ZXJg77yM5YaN55So5pys6L2u6L+U5Zue55qEIGByZXZpZXdSZXF1ZXN0SWRgIOaJp+ihjCBgcmV2aWV3IHNob3dg77yb5paw5Lqk5LuY5Lya6Ieq5Yqo5Yib5bu65pys6L2u6K+E5a6h44CCCgojIyDop4TmoLzkuI7kuqTku5joh6rmo4AKCuW8gOW3peaIlui/lOS/ruaXtuaMiSBgY2hlY2tsaXN0cy9zcGVjLWRyaXZlbi5tZGAg5qC45a+56IyD5Zu044CB5L6d5o2u44CB54mI5pys5LiO5Lqk5o6l77yb5Y+q6K+75Y+W5b2T5YmN6Zi25q616ZyA6KaB55qE6LWE5rqQ44CCCg=="
      },
      {
        "resourceId": "reference-references",
        "path": "roles/frontend/references/references.json",
        "sha256": "2cdd11e887066d0901aec56bde5539dc86c36223cf6fd54f38569831d459448d",
        "byteLength": 541,
        "mediaType": "application/json",
        "bodyBase64": "ewogICJ2ZXJzaW9uIjogMSwKICAibm90ZSI6ICLlj6rmlL7mjIfpkojvvIzkuI3mlL7mraPmlofjgIJzY29wZTogUFJPSkVDVCB8IFVOSVQgfCBST0xF44CC6Lev5b6E5Zyo6L+Q6KGM5pe255Sx5b+r54Wn6Kej5p6Q44CCIiwKICAiZW50cmllcyI6IFsKICAgIHsKICAgICAgImtleSI6ICJjb250cmFjdCIsCiAgICAgICJzY29wZSI6ICJVTklUIiwKICAgICAgInJlZiI6ICJrbm93bGVkZ2U6Ly88cHJvamVjdC1rZXk+L3N5c3RlbS88dW5pdC1rZXk+L2NvbnRyYWN0IgogICAgfSwKICAgIHsKICAgICAgImtleSI6ICJkZXNpZ24tc3lzdGVtIiwKICAgICAgInNjb3BlIjogIlBST0pFQ1QiLAogICAgICAicmVmIjogImtub3dsZWRnZTovLzxwcm9qZWN0LWtleT4vcHJhY3RpY2UvdWkvZGVzaWduLXN5c3RlbSIKICAgIH0sCiAgICB7CiAgICAgICJrZXkiOiAiY29udmVudGlvbnMiLAogICAgICAic2NvcGUiOiAiUFJPSkVDVCIsCiAgICAgICJyZWYiOiAia25vd2xlZGdlOi8vPHByb2plY3Qta2V5Pi9zeXN0ZW0vY29udmVudGlvbnMiCiAgICB9CiAgXQp9Cg=="
      },
      {
        "resourceId": "skill-consume-contract",
        "path": "roles/frontend/skills/consume-contract/SKILL.md",
        "sha256": "d2c055f6b390cdeeff73317f7ecf8dc4959dc702cbadae627a99be3293107c86",
        "byteLength": 1398,
        "mediaType": "text/markdown",
        "bodyBase64": "LS0tCm5hbWU6IGNvbnN1bWUtY29udHJhY3QKZGVzY3JpcHRpb246IOivu+WPluaOpeWPo+Wlkee6puS4juiuvuiuoeinhOagvO+8jOS6p+WHuuWJjeerr+WunueOsOaWueahiOW5tuW7uueriyBtb2Nr77yb5b2T5aWR57qm5bey5Y+R5biD44CB5ZCO56uv5bCa5pyq5a6M5oiQ5pe25L2/55So44CCCmxpY2Vuc2U6IE1JVAptZXRhZGF0YToKICByb2xlS2V5OiBmcm9udGVuZAogIHBhY2thZ2VWZXJzaW9uOiAwLjEuMAotLS0KCiMg5raI6LS55aWR57qmCgojIyDkvZXml7bnlKgKCi0g5aWR57qm5bey5Y+R5biD77yM6ZyA6KaB5byA5bel5L2G5ZCO56uv5pyq5a6M5oiQ44CCCi0g6K6+6K6h6KeE5qC85bey5Y+v55So77yM6ZyA6KaB56Gu5a6a57uE5Lu25LiO54q25oCB44CCCgojIyDmraXpqqQKCjEuIOivu+Wlkee6pu+8muaOpeWPo+OAgeWFpeWPguWHuuWPguOAgemUmeivr+eggeOAgeWIhumhteOAggoyLiDor7vorr7orqHop4TmoLzvvJrpobXpnaLjgIHnirbmgIHjgIHkuqTkupLjgIHlpI3nlKjlo7DmmI7jgIIKMy4g5YiX5pS55Yqo6Z2i77ya6aG16Z2i44CB57uE5Lu244CB6Lev55Sx44CB54q25oCB566h55CG44CB6K+35rGC5bGC44CCCjQuIOW7uiBtb2Nr77ya5oyJ5aWR57qm5p6E6YCg5pWw5o2u77yM6KaG55uW5q2j5bi444CB56m644CB6ZSZ6K+v44CB5Yqg6L2944CCCjUuIOS6p+WHuuWunueOsOaWueahiO+8jOWGmeWFpSBgaW1wbC5tZGDjgIIKNi4g6ICB6aG555uu5YWI5qC45a+5546w5pyJ57uE5Lu244CB5a6e6ZmF5o6l5Y+j44CB5bel5YW36YWN572u5LiO5rWL6K+V77yb5oqA5pyv5Y+W6IiN6K6w5b2V5p2l5rqQ5ZKM5aSH6YCJ77yM5pyq5Yaz6aG55pi+5byP5L+d55WZ44CCCjcuIOaMieWPr+eLrOeri+mqjOivgeeahOS4muWKoeWcuuaZr+aLhuWunueOsO+8jOagh+WHuumqjOaUtiBrZXnjgIHkvp3otZbjgIHotJ/otKPmlofku7blkozpqozor4HmlrnlvI/vvJvlj6rlnKjliY3nva7mu6HotrPkuJTmlofku7bkuI3lhrLnqoHml7blubbooYzjgIIKCiMjIOinhOWImQoKLSDlj6rkv6HlpZHnuqbvvIzkuI3kv6HjgIzlj6PlpLTor7TkvJrov5Tlm57ku4DkuYjjgI3jgIIKLSDlpZHnuqbnvLrlrZfmrrXlsLHlm57pl67vvIzkuI3oh6rooYznjJzjgIIKLSBtb2NrIOS4juWlkee6puWQjOa6kO+8muWtl+auteWQjeOAgemUmeivr+eggeW/hemhu+S4gOiHtOOAggotIOWkjeeUqOS8mOWFiO+8muiDveeUqOeOsOaciee7hOS7tuWwseS4jeaWsOmAoO+8jOWBj+emu+iuvuiuoeinhOiMg+imgeWGmeeQhueUseOAggoKIyMg5Lqk5o6lCgpgaW1wbC5tZGAg5YmN5Y2K6YOo5YiG77yI5pS55Yqo6IyD5Zu044CB57uE5Lu244CB5o6l5Y+j5L6d6LWW44CBbW9jayDmlrnmoYjvvInkuqTor4TlrqHvvIznhLblkI7ov5vlhaUgYGltcGxlbWVudC11aWDjgIIK"
      },
      {
        "resourceId": "skill-implement-ui",
        "path": "roles/frontend/skills/implement-ui/SKILL.md",
        "sha256": "7e202cb1e166e1aac04f32cde8ac158884989e18c3b710140fbc5c07d43070a6",
        "byteLength": 1353,
        "mediaType": "text/markdown",
        "bodyBase64": "LS0tCm5hbWU6IGltcGxlbWVudC11aQpkZXNjcmlwdGlvbjog5oyJ6K6+6K6h6KeE5qC85a6e546w55WM6Z2i5LiO5Lqk5LqS77yM6KaG55uW56m65oCB44CB6ZSZ6K+v5oCB44CB5Yqg6L295oCB5LiO5p2D6ZmQ5Y+X6ZmQ5oCB77yM5bm25a6M5oiQ6Ieq5rWL77yb5b2T6K6+6K6h6KeE5qC85LiO5aWR57qm5bCx57uq44CB5Lu75Yqh5bey6K6k6aKG5pe25L2/55So44CCCmxpY2Vuc2U6IE1JVAptZXRhZGF0YToKICByb2xlS2V5OiBmcm9udGVuZAogIHBhY2thZ2VWZXJzaW9uOiAwLjEuMAotLS0KCiMg5a6e546w55WM6Z2iCgojIyDkvZXml7bnlKgKCi0g6K6+6K6h6KeE5qC85LiO5aWR57qm5bCx57uq77yM5Lu75Yqh5bey6K6k6aKG44CCCi0g6ZyA6KaB5Zyo5pei5pyJ6aG16Z2i5LiK5YGa5aKe6YeP5pS55Yqo44CCCgojIyDmraXpqqQKCjEuIOWPluS4iuS4i+aWh++8mlBSRCDpqozmlLbjgIHorr7orqHop4TmoLzjgIHlpZHnuqbjgIHpobnnm67op4TojIPjgIIKMi4g5oyJ6K6+6K6h5a6e546w5biD5bGA5LiO5Lqk5LqS77yM5aSN55So546w5pyJ57uE5Lu244CCCjMuIOihpem9kOeKtuaAge+8muato+W4uOOAgeepuuOAgemUmeivr+OAgeWKoOi9veOAgeadg+mZkOWPl+mZkOOAggo0LiDmjqXlpZHnuqbvvJrmm7/mjaIgbW9ja++8jOWkhOeQhumUmeivr+eggeS4jumHjeivleOAggo1LiDoh6rmtYvvvJrkuqTkupLjgIHovrnnlYzjgIHlk43lupTlvI/jgIHlj6/orr/pl67mgKfjgIIKNi4g5Lqn5Ye6IGBpbXBsLm1kYCDlkI7ljYrpg6jliIbjgIIKCiMjIOinhOWImQoKLSDkuI3mlLnpqozmlLbmoIflh4bvvJrlrp7njrDkuI4gUFJEIOWGsueqgeaXtuWPkSBgTkVFRFNfQ0xBUklGWWDjgIIKLSDkuI3mk4Xoh6rmlLnorr7orqHvvJrlgY/nprvopoHlnKggYGltcGwubWRgIOWGmeaYjuWOn+WboOOAggotIOS4jee7lei/h+Wlkee6pu+8muWtl+auteWQjeS4jumUmeivr+eggeS7peWlkee6puS4uuWHhuOAggotIOazqOmHiuWPquWGmeOAjOS4uuS7gOS5iOOAje+8m1RPRE8g5bim6LSf6LSj5Lq65ZKM5pyf6ZmQ44CCCgojIyDoh6rmtYvmuIXljZUKCi0gWyBdIOS6lOenjeeKtuaAgemDveacieWunueOsOOAggotIFsgXSDplJnor6/noIHmnInlr7nlupTmj5DnpLrvvIzkuI3mmK/nu5/kuIDjgIzlh7rplJnkuobjgI3jgIIKLSBbIF0g5YWz6ZSu5Lqk5LqS5Y+v55So6ZSu55uY5a6M5oiQ44CCCi0gWyBdIOWwj+Wxj+S4jumVv+aWh+acrOS4jeegtOeJiOOAggotIFsgXSDml6AgY29uc29sZSDmiqXplJnkuI7mnKrlpITnkIYgUHJvbWlzZeOAggoKIyMg5Lqk5o6lCgrmj5DkuqTku6PnoIHvvIhjb21taXQg5bim6ZyA5rGC57yW5Y+377yJKyBgaW1wbC5tZGDvvIzkuqTor4TlrqHjgIIK"
      },
      {
        "resourceId": "skills-index",
        "path": "roles/frontend/skills/index.md",
        "sha256": "70490b65a3141bfb3cf9a71a68ba7d924d94e8545514ae9272fd971ce0ac80e8",
        "byteLength": 749,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDliY3nq6/op5LoibLljIUgwrcg5oqA6IO957Si5byVCgp8IOaKgOiDvSAgICAgICAgICAgICAgIHwg5YGa5LuA5LmIICAgICAgICAgICAgICAgICAgICAgICAgICAgIHwg5L2V5pe255SoICAgICAgICAgICAgICAgfAp8IC0tLS0tLS0tLS0tLS0tLS0tLSB8IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSB8IC0tLS0tLS0tLS0tLS0tLS0tLS0tIHwKfCBgY29uc3VtZS1jb250cmFjdGAgfCDor7vlpZHnuqbkuI7orr7orqHvvIzlh7rlrp7njrDmlrnmoYjjgIHlu7ogbW9jayB8IOWlkee6puW3suWPkeW4g+OAgeiuvuiuoeWPr+eUqCB8CnwgYGltcGxlbWVudC11aWAgICAgIHwg5oyJ6K6+6K6h5a6e546w55WM6Z2i5LiO5Lqk5LqS5bm26Ieq5rWLICAgICAgICB8IOiuvuiuoeinhOagvOS4juWlkee6puWwsee7qiAgIHwKCiMjIOS9v+eUqOmhuuW6jwoKYGBgCmNvbnN1bWUtY29udHJhY3Qg4oaSIGltcGxlbWVudC11aQpgYGAKCuWJjeerr+S4jeW/heetieWQjuerr+WGmeWujO+8muWlkee6puS4gOWPkeW4g+WwseiDveW7uiBtb2NrIOW8gOW3pe+8jOetieWQjuerr+iBlOiwg+aXtuWPquaNouaVsOaNrua6kOOAggoKIyMg5Lqk5o6lCgotIOaWueahiCDihpIgYGltcGwubWRgIOWJjeWNiumDqOWIhu+8iOaUueWKqOiMg+WbtOOAgee7hOS7tuOAgeaOpeWPo+S+nei1lu+8ieOAggotIOWunueOsCDihpIg5o+Q5LqkICsgYGltcGwubWRgIOWQjuWNiumDqOWIhu+8iOiHqua1i+OAgemBl+eVmemhue+8ieOAggo="
      }
    ]
  },
  {
    "packageId": "workmesh.role.ops",
    "version": "1.2.1",
    "roleKey": "ops",
    "manifest": {
      "packageSchemaVersion": "1.1",
      "id": "workmesh.role.ops",
      "version": "1.2.1",
      "protocolVersion": "1.0",
      "title": "运维角色包",
      "description": "准备发布、验证回滚、执行冒烟，把上线从「发出去」变成「可证明地发出去」。",
      "license": "MIT",
      "roleKey": "ops",
      "compatibility": {
        "minCliVersion": "1.0.0",
        "maxCliVersionExclusive": "2.0.0",
        "contractVersion": "1.0"
      },
      "skills": [
        {
          "key": "prepare-release",
          "path": "skills/prepare-release/SKILL.md",
          "description": "生成发布计划：依赖、顺序、灰度、监控与回滚触发条件。",
          "whenToUse": "需求进入发布候选、测试通过后。"
        },
        {
          "key": "rollback-plan",
          "path": "skills/rollback-plan/SKILL.md",
          "description": "编写并验证回滚方案，确保发布前就知道怎么退。",
          "whenToUse": "发布计划确定后、执行发布前。"
        },
        {
          "key": "smoke-check",
          "path": "skills/smoke-check/SKILL.md",
          "description": "按验收做生产冒烟，记录结果与异常，给出发布结论。",
          "whenToUse": "发布完成后。"
        }
      ],
      "inputs": [
        {
          "key": "context",
          "source": "TASK_SNAPSHOT",
          "kind": "CONTEXT",
          "required": true,
          "contractVersion": "1.0"
        },
        {
          "key": "prd",
          "source": "KNOWLEDGE",
          "kind": "PRD",
          "required": true,
          "contractVersion": "1.0"
        },
        {
          "key": "unit-card",
          "source": "KNOWLEDGE",
          "kind": "UNIT_CARD",
          "required": false,
          "contractVersion": "1.0"
        }
      ],
      "outputs": [
        {
          "key": "release",
          "channel": "CANDIDATE",
          "kind": "RELEASE",
          "contractVersion": "1.0",
          "templateResourceId": "template-release",
          "evidence": [
            "INSPECTION"
          ]
        },
        {
          "key": "rollback",
          "channel": "CANDIDATE",
          "kind": "RELEASE",
          "contractVersion": "1.0",
          "templateResourceId": "template-rollback",
          "evidence": [
            "TEST"
          ]
        },
        {
          "key": "smoke",
          "channel": "CANDIDATE",
          "kind": "RELEASE",
          "contractVersion": "1.0",
          "templateResourceId": "template-smoke",
          "evidence": [
            "TEST",
            "INSPECTION"
          ]
        }
      ],
      "resources": [
        {
          "id": "template-release",
          "kind": "template",
          "path": "assets/templates/release.md",
          "sha256": "f40c705938e56ef9dac4497c3b15693f6f89b8a237d21b9d0306d80495b47e7f",
          "byteLength": 920,
          "mediaType": "text/markdown"
        },
        {
          "id": "template-rollback",
          "kind": "template",
          "path": "assets/templates/rollback.md",
          "sha256": "e14255113c45b1bcfa7634c45e904c59b668f356fa5eab29865adab16e30b672",
          "byteLength": 790,
          "mediaType": "text/markdown"
        },
        {
          "id": "template-smoke",
          "kind": "template",
          "path": "assets/templates/smoke.md",
          "sha256": "87a6802b7a63ff7f37d47a8be4a72fafb129f2ddb42b22aed79013ff264e3bf7",
          "byteLength": 716,
          "mediaType": "text/markdown"
        },
        {
          "id": "checklist-release-readiness",
          "kind": "checklist",
          "path": "checklists/release-readiness.md",
          "sha256": "e44a73126fa9b55ad7af1d73fb3c45bf474a739dd3b5785a1b00caadbf39708c",
          "byteLength": 735,
          "mediaType": "text/markdown"
        },
        {
          "id": "checklist-spec-driven",
          "kind": "checklist",
          "path": "checklists/spec-driven.md",
          "sha256": "eddb341cf017d46fc1a03cf0a89de031acdc1d72ec318fa2ae8a55a48ade6bac",
          "byteLength": 1124,
          "mediaType": "text/markdown"
        },
        {
          "id": "guide",
          "kind": "prompt",
          "path": "guide.md",
          "sha256": "26aca3fe4a5a5f38f1a0a67e3e22749fd1dc55f4ff2f83242e3e08a7502a37fc",
          "byteLength": 2877,
          "mediaType": "text/markdown"
        },
        {
          "id": "reference-references",
          "kind": "reference",
          "path": "references/references.json",
          "sha256": "b6112bd5141b5fbe94a11c9144d8045ca53fbd6a5f5d5175b7112982f450ddfd",
          "byteLength": 656,
          "mediaType": "application/json"
        },
        {
          "id": "skills-index",
          "kind": "index",
          "path": "skills/index.md",
          "sha256": "105614d40dbe2015faa78d7326c3dae37f1b29a422f7acc6537d2ce1a7ac3b9e",
          "byteLength": 781,
          "mediaType": "text/markdown"
        },
        {
          "id": "skill-prepare-release",
          "kind": "skill",
          "path": "skills/prepare-release/SKILL.md",
          "sha256": "bc9481e37f406f49877d82cc390cb38f05c7c61ebc38ce4979b6cdfb64556fae",
          "byteLength": 1127,
          "mediaType": "text/markdown"
        },
        {
          "id": "skill-rollback-plan",
          "kind": "skill",
          "path": "skills/rollback-plan/SKILL.md",
          "sha256": "def32c2500d6519cce425e4bb2e141a447842435172ef0d5b442d83bbd3b3523",
          "byteLength": 1089,
          "mediaType": "text/markdown"
        },
        {
          "id": "skill-smoke-check",
          "kind": "skill",
          "path": "skills/smoke-check/SKILL.md",
          "sha256": "21057e6f7ab46e3d16508f6c7878e9a4ff4f94f9ed166b05abc52b4db4d7c56a",
          "byteLength": 895,
          "mediaType": "text/markdown"
        }
      ],
      "agentEntries": [
        {
          "host": "codex",
          "type": "AGENTS_MD_POINTER",
          "resourceId": "skills-index",
          "adapterVersion": "1.0.0"
        },
        {
          "host": "claude-code",
          "type": "SKILLS_DIRECTORY",
          "resourceId": "skills-index",
          "adapterVersion": "1.0.0"
        }
      ]
    },
    "resources": [
      {
        "resourceId": "template-release",
        "path": "roles/ops/assets/templates/release.md",
        "sha256": "f40c705938e56ef9dac4497c3b15693f6f89b8a237d21b9d0306d80495b47e7f",
        "byteLength": 920,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDlj5HluIPorrDlvZXvvJo86ZyA5rGC5qCH6aKYPgoKPiDpnIDmsYLnvJblj7fvvJo8UFJPSkVDVF9LRVk+LTzluo/lj7c+IMK3IOeJiOacrO+8mnYxIMK3IOeOr+Wig++8mjxwcm9kIC8gc3RhZ2luZz4KPiDlj5HluIPotJ/otKPkurrvvJo8bmFtZT4gwrcg5pe26Ze056qX5Y+j77yaPHN0YXJ0PiDigJMgPGVuZD4KCiMjIDEuIOWPkeW4g+iMg+WbtAoKfCDljZXlhYMgfCDlj5jmm7QgfCDniYjmnKwgfAp8IC0tLS0gfCAtLS0tIHwgLS0tLSB8CnwgICAgICB8ICAgICAgfCAgICAgIHwKCiMjIDIuIOS+nei1luS4jumhuuW6jwoKfCDpobrluo8gfCDlr7nosaEgfCDliY3nva7mnaHku7YgfCDmmK/lkKblj6/lubbooYwgfAp8IC0tLS0gfCAtLS0tIHwgLS0tLS0tLS0gfCAtLS0tLS0tLS0tIHwKfCAxICAgIHwgICAgICB8ICAgICAgICAgIHwgICAgICAgICAgICB8CgojIyAzLiDngbDluqbnrZbnlaUKCnwg6Zi25q61IHwg6IyD5Zu0IHwg6KeC5a+f5pe26ZW/IHwg5pS+6YeP5p2h5Lu2IHwKfCAtLS0tIHwgLS0tLSB8IC0tLS0tLS0tIHwgLS0tLS0tLS0gfAp8IDEgICAgfCAgICAgIHwgICAgICAgICAgfCAgICAgICAgICB8CgojIyA0LiDnm5HmjqcKCnwg5oyH5qCHIHwg6ZiI5YC8IHwg5p+l55yL5L2N572uIHwKfCAtLS0tIHwgLS0tLSB8IC0tLS0tLS0tIHwKfCAgICAgIHwgICAgICB8ICAgICAgICAgIHwKCiMjIDUuIOWbnua7muinpuWPkeadoeS7tgoKLSDplJnor6/njofvvJoKLSDlu7bov5/vvJoKLSDkuJrliqHmjIfmoIfvvJoKLSDkurrlt6XliKTmlq3vvJoKCiMjIDYuIOW9seWTjemcgOaxggoKLSA86ZyA5rGC57yW5Y+3PgoKIyMgNy4g5Y+R5biD57uT6K66CgotIFsgXSDlt7Llj5HluIPlubblhpLng5/pgJrov4cKLSBbIF0g6YOo5YiG5Y+R5biD77yM5Y6f5Zug77yaCi0gWyBdIOWbnua7mu+8jOWOn+WboO+8mgo="
      },
      {
        "resourceId": "template-rollback",
        "path": "roles/ops/assets/templates/rollback.md",
        "sha256": "e14255113c45b1bcfa7634c45e904c59b668f356fa5eab29865adab16e30b672",
        "byteLength": 790,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDlm57mu5rmlrnmoYjvvJo86ZyA5rGC5qCH6aKYPgoKPiDpnIDmsYLnvJblj7fvvJo8UFJPSkVDVF9LRVk+LTzluo/lj7c+IMK3IOWFs+iBlOWPkeW4g++8mjxyZWxlYXNlIOiusOW9lT4KPiDmvJTnu4Pml7bpl7TvvJo8dGltZT4gwrcg5ryU57uD546v5aKD77yaPGVudj4gwrcg6ICX5pe277yaPG1pbnV0ZXM+CgojIyAxLiDlm57mu5rlr7nosaEKCnwg5a+56LGhIHwg57G75Z6LICAgICAgICAgICAgICAgICAgICAgIHwg5Zue5rua5pa55byPIHwKfCAtLS0tIHwgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSB8IC0tLS0tLS0tIHwKfCAgICAgIHwg5Luj56CBIC8g6YWN572uIC8g5pWw5o2uIC8g5L6d6LWWIHwgICAgICAgICAgfAoKIyMgMi4g6Kem5Y+R5p2h5Lu2CgotIOmUmeivr+eOhyA+Ci0g5bu26L+fID4KLSDkuJrliqHmjIfmoIfvvJoKLSDkurrlt6XliKTmlq3vvJoKCiMjIDMuIOatpemqpAoKMS4KMi4KMy4KCiMjIDQuIOaVsOaNruWbnua7mgoKLSDmmK/lkKbmnInlj43lkJHov4Hnp7vvvJoKLSDml6Dlj43lkJHov4Hnp7vml7bnmoTooaXlgb/mlrnmoYjvvJoKLSDlvbHlk43nmoTmlbDmja7ojIPlm7TvvJoKCiMjIDUuIOa8lOe7g+iusOW9lQoKfCDpobkgICAgICAgfCDnu5PmnpwgfAp8IC0tLS0tLS0tIHwgLS0tLSB8Cnwg5Y+v5omn6KGMICAgfCAgICAgIHwKfCDogJfml7YgICAgIHwgICAgICB8Cnwg6aqM6K+B5pa55byPIHwgICAgICB8CgojIyA2LiDlm57mu5rlkI7pqozor4EKCi0g5YGl5bq35qOA5p+l77yaCi0g5YWz6ZSu5o6l5Y+j77yaCi0g55uR5o6n5oGi5aSN77yaCg=="
      },
      {
        "resourceId": "template-smoke",
        "path": "roles/ops/assets/templates/smoke.md",
        "sha256": "87a6802b7a63ff7f37d47a8be4a72fafb129f2ddb42b22aed79013ff264e3bf7",
        "byteLength": 716,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDlhpLng5/orrDlvZXvvJo86ZyA5rGC5qCH6aKYPgoKPiDpnIDmsYLnvJblj7fvvJo8UFJPSkVDVF9LRVk+LTzluo/lj7c+IMK3IOeOr+Wig++8mjxwcm9kPiDCtyDml7bpl7TvvJo8dGltZT4KPiDmiafooYzkurrvvJo8bmFtZT4KCiMjIDEuIOiMg+WbtAoKfCDpqozmlLYga2V5IHwg5YaS54Of6aG5IHwg57uT5p6cICAgICAgICB8CnwgLS0tLS0tLS0gfCAtLS0tLS0gfCAtLS0tLS0tLS0tLSB8CnwgYWMtMDEgICAgfCAgICAgICAgfCDpgJrov4cgLyDlpLHotKUgfAoKIyMgMi4g55uR5o6nCgp8IOaMh+aghyAgIHwg5Y+R5biD5YmNIHwg5Y+R5biD5ZCOIHwg5Yik5a6aIHwKfCAtLS0tLS0gfCAtLS0tLS0gfCAtLS0tLS0gfCAtLS0tIHwKfCDplJnor6/njocgfCAgICAgICAgfCAgICAgICAgfCAgICAgIHwKfCDlu7bov58gICB8ICAgICAgICB8ICAgICAgICB8ICAgICAgfAoKIyMgMy4g5byC5bi4Cgp8IOeOsOixoSB8IOWIhua1gSAgICAgICAgICAgICAgICAgICAgICAgfCDlpITnkIYgfAp8IC0tLS0gfCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSB8IC0tLS0gfAp8ICAgICAgfCDmnKzmrKHlj5jmm7QgLyDnjq/looMgLyDljoblj7Lpl67popggfCAgICAgIHwKCiMjIDQuIOe7k+iuugoKLSBbIF0g6YCa6L+HCi0gWyBdIOinguWvn++8iOinguWvn+S6uu+8mu+8jOaXtumZkO+8mu+8iQotIFsgXSDlm57mu5rvvIjmiafooYwgYHJvbGxiYWNrLm1kYO+8iQo="
      },
      {
        "resourceId": "checklist-release-readiness",
        "path": "roles/ops/checklists/release-readiness.md",
        "sha256": "e44a73126fa9b55ad7af1d73fb3c45bf474a739dd3b5785a1b00caadbf39708c",
        "byteLength": 735,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDlj5HluIPlsLHnu6rmuIXljZUKCi0gWyBdIOWPkeW4g+iMg+WbtOS4juW9seWTjemcgOaxguW3suWIl+a4heOAggotIFsgXSDkvp3otZbkuI7lj5HluIPpobrluo/lt7Lnoa7orqTvvIzlkKvmlbDmja7lupPov4Hnp7vjgIIKLSBbIF0g54Gw5bqm562W55Wl5LiO5pS+6YeP5p2h5Lu25bey5YaZ44CCCi0gWyBdIOebkeaOp+mhueOAgemYiOWAvOOAgeafpeeci+S9jee9ruW3suWGmeOAggotIFsgXSDlm57mu5rop6blj5HmnaHku7blt7LlhpnvvIzkuJTlj6/liKTlrprjgIIKLSBbIF0g5Zue5rua5pa55qGI5bey5ryU57uD77yM6ICX5pe25bey55+l44CCCi0gWyBdIOS4jeWPr+mAhuaTjeS9nOacieihpeWBv+aWueahiOOAggotIFsgXSDlhpLng5/pobnopobnm5bmnKzmrKHpqozmlLbjgIIKLSBbIF0g5Y+R5biD56qX5Y+j5LiO5Ya757uT57q/5LiN5Yay56qB77yM5oiW6LWwIGhvdGZpeCDpgJrpgZPlubborrDlvZXjgIIKLSBbIF0g5aSW6YOo57O757uf5LiN5Y+v55So5pe277yM6ZmN57qn5pa55qGI5bey5YaZ44CCCgojIyDkuqTku5jliY3mnIDlkI7kuInpl64KCjEuIOWNiuWknOWHuumXrumimO+8jOWAvOePreeahOS6uuiDveS4jeiDveeFp+edgOi/meS7veaWh+aho+mAgOWbnuWOu++8nwoyLiDngbDluqbliLAgMTAlIOaXtueci+WTquS4quaMh+agh+WGs+Wumue7p+e7rei/mOaYr+WBnO+8nwozLiDlj5HluIPlkI7mgI7kuYjor4HmmI7jgIzov5nmrKHnnJ/nmoTlpb3kuobjgI3vvJ8K"
      },
      {
        "resourceId": "checklist-spec-driven",
        "path": "roles/ops/checklists/spec-driven.md",
        "sha256": "eddb341cf017d46fc1a03cf0a89de031acdc1d72ec318fa2ae8a55a48ade6bac",
        "byteLength": 1124,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDop4TmoLzkuI7kuqTku5jljY/kvZzmo4Dmn6UKCuWPquWKoOi9veacrOasoeS7u+WKoea2ieWPiueahOaooeadv+WSjOa4heWNleOAgueugOWNleaUueWKqOWGmeW/heimgeS/oeaBr++8m+WkjeadguW6puadpeiHqumjjumZqeOAgeS+nei1luWSjOmqjOaUtuiMg+WbtO+8jOS4jeaMieWbuuWumumhteaVsOaIlueroOiKguaVsOWIpOaWrei0qOmHj+OAggoKLSBbIF0g5bey6K+75pys5qyh5b+r54Wn5LiO6aG555uu6KeE6IyD77yM56Gu6K6kIFBSRC/nn6Xor4bkv67orqLvvJvogIHpobnnm67lhYjmoLjlr7nlrp7pmYXku6PnoIHjgIHlt6XlhbfphY3nva7kuI7njrDmnInooYzkuLrjgIIKLSBbIF0g5YWz6ZSu57uT6K665pyJ5p2l5rqQ77yb6LCD5p+l5pyq55+l6aG544CB5pa55qGI5Y+W6IiN44CB5L6L5aSW5LiO5bu25pyf5Z2H5pyJ55CG55Sx5ZKM6LSj5Lu75Lq644CCCi0gWyBdIOS7peW3suehruiupOmqjOaUtiBrZXkg5YWz6IGU5pys6KeS6Imy5Lqn54mp77yb5Lu75Yqh5YiX5L6d6LWW44CB6LSf6LSj5paH5Lu25LiO6aqM6K+B5pa55byP77yM5YWx55So5paH5Lu25LiN5peg5L6d5o2u5Zyw5bm26KGM5L+u5pS544CCCi0gWyBdIOmcgOaxgui0qOmHj+OAgeeUqOS+i+iuvuiuoeimhuebluOAgeWunumZheaJp+ihjOe7k+aenOWSjCBIVU1BTiDmraPlvI/pqozmlLbliIbliKvorrDlvZXjgIIKLSBbIF0g5omA5pyJ5pyq6L+Q6KGM44CB5aSx6LSl44CB6Zi75aGe44CB5peg5rOV5qC46aqM55qE5YaF5a655piO56Gu5qCH5Ye677ybQWdlbnQg5oql5ZGK5LiN5aOw56ew54us56uL6aqM6K+B44CCCi0gWyBdIOe8uuWPo+S7peeos+WumiBJRCDov73liqDlubblm57pk77ljp/orrDlvZXvvJvotoXlh7rpnIDmsYLojIPlm7TlhYjotbDlj5jmm7TvvIzkv67mlLnln7rnur/lkI7ph43mlrDmoLjlr7nor4Hmja7jgIIKCuinkuiJsui1hOa6kOabtOaWsO+8muW3sumUgeWumueJiOacrOS/neaMgeWOn+Wtl+iKgu+8jOaWsOaWueazleWcqOaWsOWMheeJiOacrOWuieijheWQjueUn+aViOOAguWuv+S4u+WFpeWPo+WPquaMh+WQkeinkuiJsui1hOa6kO+8m+mhueebruiHquWumuS5ieinhOiMg+maj+mhueebruefpeivhuS/ruiuou+8jOS4jeWkjeWItui/m+inkuiJsuWMheOAggo="
      },
      {
        "resourceId": "guide",
        "path": "roles/ops/guide.md",
        "sha256": "26aca3fe4a5a5f38f1a0a67e3e22749fd1dc55f4ff2f83242e3e08a7502a37fc",
        "byteLength": 2877,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDov5Dnu7Top5LoibLvvIhvcHPvvIkKCuS9oOS6p+WHuiBgUkVMRUFTRWAg5bel5Lu277ya5Y+R5biD6K6w5b2V44CB546v5aKD5LiO6YWN572u5Y+Y5pu044CB5YaS54Of57uT5p6c44CB5Zue5rua54K544CCCuWPkeW4g+atpemqpOacrOi6q+S7jeeUseS6uuexu+WcqCBXZWIg5LiK5YGa5pyA57uI5pS+6KGM44CCCgojIyDovrnnlYwKCi0g5Y+q5Lqn5Ye6IGBSRUxFQVNFYO+8m+S4jeaUueWunueOsOOAgeS4jeaUuSBQUkTjgIHkuI3lj5HluIPmtYHnqIvlrprkuYnjgIHkuI3mibnlh4bor4TlrqHjgIIKLSDmr4/mrKHlj5HluIPlv4XpobvlhpnmmI4qKuWbnua7mueCuSoq77yI5LiK5LiA54mI5pys5qCH6K+G5oiW5Y+v5Zue5rua6L+B56e777yJ5LiOKirlhpLng5/nu5PmnpwqKuOAggotIOeUn+S6p+WPmOabtOeahOWunumZheaJp+ihjOadg+mZkOS4jeWcqOacrOW5s+WPsOWGhe+8m+i/memHjOiusOW9leeahOaYr+WPr+WkjeaguOeahOivgeaNruOAggoKIyMg5LiA5qyh5a6M5pW05b6q546vCgpgYGBiYXNoCndvcmttZXNoIGF1dGggbG9naW4KCndvcmttZXNoIGNvbnRleHQgLS10YXNrIDx0YXNrSWQ+IC0taW5zcGVjdAp3b3JrbWVzaCBjbGFpbSAtLXRhc2sgPHRhc2tJZD4Kd29ya21lc2ggY29udGV4dCAtLXRhc2sgPHRhc2tJZD4gLS1jbGFpbSA8Y2xhaW1JZD4gLS1leHBlY3RlZC12ZXJzaW9uIDx0YXNrVmVyc2lvbj4gLS1tYXRlcmlhbGl6ZQoKd29ya21lc2ggZGVsaXZlciBcCiAgLS10YXNrIDx0YXNrSWQ+IC0tY2xhaW0gPGNsYWltSWQ+IC0tc25hcHNob3QgPHNuYXBzaG90SWQ+IFwKICAtLWV4cGVjdGVkLXZlcnNpb24gPHRhc2tWZXJzaW9uPiBcCiAgLS1tYW5pZmVzdCBkZWxpdmVyLW1hbmlmZXN0Lmpzb24KCiMg5L2/55SoIGRlbGl2ZXIg6L+U5Zue55qE55yf5a6eIHJldmlld1JlcXVlc3RJZCDmn6Xor6Loh6rliqjliJvlu7rnmoTor4TlrqEKd29ya21lc2ggcmV2aWV3IHNob3cgLS1yZXZpZXcgPHJldmlld1JlcXVlc3RJZD4KYGBgCgpgZGVsaXZlcmAg6L+U5ZueIGByZXZpZXdSZXF1ZXN0SWRg44CBV2ViIOWcsOWdgOWSjCBgb3BlcmF0aW9uSWRg77yM5LiN55So5YaN5qyh5Yib5bu65ZCM5LiA6L2u6K+E5a6h44CC6L6T5Ye65Lii5aSx5pe277yM55SoIGB3b3JrbWVzaCByZWNlaXB0IHNob3cgLS1vcGVyYXRpb24gPOWOn+S6pOS7mG9wZXJhdGlvbklkPiAtLWpzb25gIOivu+WPliBgZGF0YS5yZXN1bHRSZWZzLnJldmlld1JlcXVlc3RJZGDvvJvmlLbmja7ku43kuLogUEVORElORyDmiJbnu5PmnpzmnKrnn6Xml7bvvIzlhYjnlKjljp/mk43kvZznvJblj7fmiafooYwgYHdvcmttZXNoIHJlY2VpcHQgcmVjb25jaWxlIC0tb3BlcmF0aW9uIDzljp/kuqTku5hvcGVyYXRpb25JZD5g44CC5q2j5byP5Yaz5a6a5LuN55SxIEhVTUFOIOWcqCBXZWIg5a6M5oiQ44CCCgojIyBkZWxpdmVyIG1hbmlmZXN0IOimgeeCuQoKYGBganNvbgp7CiAgIndvcmtmbG93RGVmaW5pdGlvblJldmlzaW9uSWQiOiAiPHNuYXBzaG90IOmHjOiusOW9leeahCB3b3JrZmxvdyDkv67orqI+IiwKICAibG9jYWxSdW5JZCI6ICI85pys5Zyw5Y+v5aSN546w55qE6L+Q6KGM5qCH6K+GPiIsCiAgIml0ZW1zIjogWwogICAgewogICAgICAia2luZCI6ICJSRUxFQVNFIiwKICAgICAgInN0b3JhZ2UiOiAiSE9TVEVEIiwKICAgICAgIm1lZGlhVHlwZSI6ICJ0ZXh0L21hcmtkb3duIiwKICAgICAgInNoYTI1NiI6ICI85q2j5paHIHNoYTI1Nj4iLAogICAgICAiYnl0ZUxlbmd0aCI6IDEwMjQsCiAgICAgICJib2R5QmFzZTY0IjogIjxiYXNlNjQ+IiwKICAgICAgInN1bW1hcnkiOiAiY2hlY2tvdXQgMS40LjAg5bey5Y+R5biD77yb5YaS54Of6YCa6L+H77yb5Zue5rua54K5IDEuMy4yIiwKICAgICAgImNoZWNrcyI6IFsKICAgICAgICB7ICJjb2RlIjogInByZWZsaWdodCIsICJwYXNzZWQiOiB0cnVlIH0sCiAgICAgICAgeyAiY29kZSI6ICJzbW9rZSIsICJwYXNzZWQiOiB0cnVlIH0sCiAgICAgICAgeyAiY29kZSI6ICJyb2xsYmFjay1wbGFuIiwgInBhc3NlZCI6IHRydWUgfQogICAgICBdCiAgICB9CiAgXQp9CmBgYAoK5q2j5paH6YeM5YaZ5riF77ya54mI5pys5Y+344CB5Y+Y5pu056qX5Y+j44CB5omn6KGM5ZG95Luk44CB5YaS54Of5ZG95Luk5LiO6L6T5Ye65pGY6KaB44CB5Zue5rua5q2l6aqk44CCCgojIyDnpoHmraIKCi0g5LiN6KaB5Zyo5YaS54Of5pyq5omn6KGM5pe25Yu+6YCJIGBzbW9rZWDjgIIKLSDkuI3opoHnnIHnlaXlm57mu5rngrnvvJvkuI3lj6/lm57mu5ropoHmmL7lvI/lhpnmmI4i5LiN5Y+v5Zue5ruaIuWPiuWOn+WboOOAggotIOS4jeimgeWGmeWFpeS7u+S9leWvhumSpeOAgXRva2Vu44CB6K+B5Lmm56eB6ZKl44CCCgojIyDlpLHotKXkuI7ph43or5UKCi0g5YaZ5pON5L2c5LiN6Ieq5Yqo6YeN6K+V77yb6YeN5pS+5aSN55So5ZCM5LiA5LiqIGAtLW9wZXJhdGlvbiA8dXVpZD5g44CCCi0g57uT5p6c5LiN5piO77yaYHdvcmttZXNoIHJlY2VpcHQgc2hvdyAtLW9wZXJhdGlvbiA8dXVpZD5gIOKGkiBgd29ya21lc2ggcmVjZWlwdCByZWNvbmNpbGVg44CCCi0g5Y+R5biD6KKr6YCA5Zue77ya5oyJ5b2T5YmN5Lu75Yqh5ZKMIGNsYWltIOeKtuaAgei/lOS/ruWQjumHjeaWsCBgZGVsaXZlcmDvvIzlho3nlKjmnKzova7ov5Tlm57nmoQgYHJldmlld1JlcXVlc3RJZGAg5omn6KGMIGByZXZpZXcgc2hvd2DvvJvmlrDkuqTku5jkvJroh6rliqjliJvlu7rmnKzova7or4TlrqHjgIIKCiMjIOinhOagvOS4juS6pOS7mOiHquajgAoK5byA5bel5oiW6L+U5L+u5pe25oyJIGBjaGVja2xpc3RzL3NwZWMtZHJpdmVuLm1kYCDmoLjlr7nojIPlm7TjgIHkvp3mja7jgIHniYjmnKzkuI7kuqTmjqXvvJvlj6ror7vlj5blvZPliY3pmLbmrrXpnIDopoHnmoTotYTmupDjgIIK"
      },
      {
        "resourceId": "reference-references",
        "path": "roles/ops/references/references.json",
        "sha256": "b6112bd5141b5fbe94a11c9144d8045ca53fbd6a5f5d5175b7112982f450ddfd",
        "byteLength": 656,
        "mediaType": "application/json",
        "bodyBase64": "ewogICJ2ZXJzaW9uIjogMSwKICAibm90ZSI6ICLlj6rmlL7mjIfpkojvvIzkuI3mlL7mraPmlofjgIJzY29wZTogUFJPSkVDVCB8IFVOSVQgfCBST0xF44CC6Lev5b6E5Zyo6L+Q6KGM5pe255Sx5b+r54Wn6Kej5p6Q44CCIiwKICAiZW50cmllcyI6IFsKICAgIHsKICAgICAgImtleSI6ICJ1bml0LWNhcmQiLAogICAgICAic2NvcGUiOiAiVU5JVCIsCiAgICAgICJyZWYiOiAia25vd2xlZGdlOi8vPHByb2plY3Qta2V5Pi9zeXN0ZW0vPHVuaXQta2V5Pi9jYXJkIgogICAgfSwKICAgIHsKICAgICAgImtleSI6ICJydW5ib29rIiwKICAgICAgInNjb3BlIjogIlVOSVQiLAogICAgICAicmVmIjogImtub3dsZWRnZTovLzxwcm9qZWN0LWtleT4vc3lzdGVtLzx1bml0LWtleT4vcnVuYm9vayIKICAgIH0sCiAgICB7CiAgICAgICJrZXkiOiAiY29udmVudGlvbnMiLAogICAgICAic2NvcGUiOiAiUFJPSkVDVCIsCiAgICAgICJyZWYiOiAia25vd2xlZGdlOi8vPHByb2plY3Qta2V5Pi9zeXN0ZW0vY29udmVudGlvbnMiCiAgICB9LAogICAgewogICAgICAia2V5IjogInJlbGVhc2UtbG9nIiwKICAgICAgInNjb3BlIjogIlBST0pFQ1QiLAogICAgICAicmVmIjogImtub3dsZWRnZTovLzxwcm9qZWN0LWtleT4vc3lzdGVtL3JlbGVhc2UtbG9nIgogICAgfQogIF0KfQo="
      },
      {
        "resourceId": "skills-index",
        "path": "roles/ops/skills/index.md",
        "sha256": "105614d40dbe2015faa78d7326c3dae37f1b29a422f7acc6537d2ce1a7ac3b9e",
        "byteLength": 781,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDov5Dnu7Top5LoibLljIUgwrcg5oqA6IO957Si5byVCgp8IOaKgOiDvSAgICAgICAgICAgICAgfCDlgZrku4DkuYggICAgICAgICAgICAgICAgICAgICAgICAgICB8IOS9leaXtueUqCAgICAgICB8CnwgLS0tLS0tLS0tLS0tLS0tLS0gfCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSB8IC0tLS0tLS0tLS0tLSB8CnwgYHByZXBhcmUtcmVsZWFzZWAgfCDlj5HluIPorqHliJLvvJrkvp3otZbjgIHpobrluo/jgIHngbDluqbjgIHnm5HmjqcgfCDov5vlhaXlj5HluIPlgJnpgIkgfAp8IGByb2xsYmFjay1wbGFuYCAgIHwg5Zue5rua5pa55qGI5bm26aqM6K+B5Y+v5omn6KGMICAgICAgICAgICAgIHwg5Y+R5biD5YmNICAgICAgIHwKfCBgc21va2UtY2hlY2tgICAgICB8IOeUn+S6p+WGkueDn+W5tue7mee7k+iuuiAgICAgICAgICAgICAgICAgfCDlj5HluIPlkI4gICAgICAgfAoKIyMg5L2/55So6aG65bqPCgpgYGAKcHJlcGFyZS1yZWxlYXNlIOKGkiByb2xsYmFjay1wbGFuIOKGkiDlj5HluIMg4oaSIHNtb2tlLWNoZWNrCmBgYAoK5Zue5rua5pa55qGI5b+F6aG75Zyo5Y+R5biDKirkuYvliY0qKumqjOivge+8jOWPkeW4g+WQjuWGjeaDs+aAjuS5iOmAgOW3sue7j+aZmuS6huOAggoKIyMg5Lqk5o6lCgotIOiuoeWIkiDihpIgYHJlbGVhc2UubWRg77yM5Lqk5Y+R5biD6K+E5a6h44CCCi0g5Zue5ruaIOKGkiBgcm9sbGJhY2subWRg77yM5Y+R5biD5YmN5ryU57uD5LiA5qyh44CCCi0g5YaS54OfIOKGkiBgc21va2UubWRg77yM5Lqk5Y+R5biD56Gu6K6k44CCCg=="
      },
      {
        "resourceId": "skill-prepare-release",
        "path": "roles/ops/skills/prepare-release/SKILL.md",
        "sha256": "bc9481e37f406f49877d82cc390cb38f05c7c61ebc38ce4979b6cdfb64556fae",
        "byteLength": 1127,
        "mediaType": "text/markdown",
        "bodyBase64": "LS0tCm5hbWU6IHByZXBhcmUtcmVsZWFzZQpkZXNjcmlwdGlvbjog55Sf5oiQ5Y+R5biD6K6h5YiS77yM5YaZ5riF5L6d6LWW44CB5Y+R5biD6aG65bqP44CB54Gw5bqm562W55Wl44CB55uR5o6n6aG55LiO5Zue5rua6Kem5Y+R5p2h5Lu277yb5b2T6ZyA5rGC6L+b5YWl5Y+R5biD5YCZ6YCJ5pe25L2/55So44CCCmxpY2Vuc2U6IE1JVAptZXRhZGF0YToKICByb2xlS2V5OiBvcHMKICBwYWNrYWdlVmVyc2lvbjogMC4xLjAKLS0tCgojIOWHhuWkh+WPkeW4gwoKIyMg5L2V5pe255SoCgotIOmcgOaxgui/m+WFpeWPkeW4g+WAmemAie+8jOa1i+ivlemAmui/h+OAggotIOWkmuacjeWKoeWtmOWcqOWPkeW4g+mhuuW6j+S+nei1luOAggoKIyMg5q2l6aqkCgoxLiDor7sgUFJEIOmqjOaUtuS4juWPkeW4g+iMg+WbtO+8jOehruiupOimgeWPkeS7gOS5iOOAggoyLiDliJfkvp3otZbvvJrmnI3liqHjgIHmlbDmja7lupPov4Hnp7vjgIHphY3nva7jgIHnrKzkuInmlrnjgIIKMy4g5a6a6aG65bqP77ya5YWI5Y+R5LuA5LmI44CB5ZCO5Y+R5LuA5LmI44CB6IO95ZCm5bm26KGM44CCCjQuIOWumueBsOW6pu+8muaMieeUqOaIt+OAgeaMiea1gemHj+OAgeaMieenn+aIt++8jOWGmea4heaUvumHj+iKguWlj+OAggo1LiDlrprnm5HmjqfvvJrnnIvlk6rkupvmjIfmoIfjgIHpmIjlgLzlpJrlsJHjgIHosIHmnaXnnIvjgIIKNi4g5a6a5Zue5rua6Kem5Y+R5p2h5Lu277ya5LuA5LmI5oOF5Ya15b+F6aG76YCA44CCCjcuIOS6p+WHuiBgcmVsZWFzZS5tZGDjgIIKCiMjIOinhOWImQoKLSDmsqHmnInlm57mu5rop6blj5HmnaHku7bnmoTlj5HluIPorqHliJLkuI3nrpflrozmiJDjgIIKLSDmlbDmja7lupPov4Hnp7vkuI7ku6PnoIHlj5HluIPliIblvIDvvJrlhYjlhbzlrrnjgIHlho3liIfmjaLjgIHlkI7muIXnkIbjgIIKLSDlj5HluIPnqpflj6PkuI7lhrvnu5Pnur/lhrLnqoHml7bvvIzotbAgaG90Zml4IOmAmumBk+W5tuiusOW9leOAggotIOS+nei1luWklumDqOezu+e7n+aXtu+8jOWGmea4heWvueaWueS4jeWPr+eUqOaXtueahOmZjee6p+OAggoKIyMg5Lqk5o6lCgpgcmVsZWFzZS5tZGAg5Lqk5Y+R5biD6K+E5a6h77yb6K+E5a6h6YCa6L+H5ZCO6L+b5YWlIGByb2xsYmFjay1wbGFuYOOAggo="
      },
      {
        "resourceId": "skill-rollback-plan",
        "path": "roles/ops/skills/rollback-plan/SKILL.md",
        "sha256": "def32c2500d6519cce425e4bb2e141a447842435172ef0d5b442d83bbd3b3523",
        "byteLength": 1089,
        "mediaType": "text/markdown",
        "bodyBase64": "LS0tCm5hbWU6IHJvbGxiYWNrLXBsYW4KZGVzY3JpcHRpb246IOe8luWGmeW5tua8lOe7g+Wbnua7muaWueahiO+8jOaYjuehruinpuWPkeadoeS7tuOAgeatpemqpOOAgeaVsOaNruaBouWkjeS4jumqjOivgeaWueW8j++8m+W9k+WPkeW4g+iuoeWIkuehruWumuOAgeaJp+ihjOWPkeW4g+WJjeS9v+eUqOOAggpsaWNlbnNlOiBNSVQKbWV0YWRhdGE6CiAgcm9sZUtleTogb3BzCiAgcGFja2FnZVZlcnNpb246IDAuMS4wCi0tLQoKIyDlm57mu5rmlrnmoYgKCiMjIOS9leaXtueUqAoKLSDlj5HluIPorqHliJLlt7LlrprvvIzmiafooYzlj5HluIPliY3jgIIKLSDlj5jmm7Tmtonlj4rmlbDmja7lupPmiJbkuI3lj6/pgIbmk43kvZzjgIIKCiMjIOatpemqpAoKMS4g5YiX5Zue5rua5a+56LGh77ya5Luj56CB44CB6YWN572u44CB5pWw5o2u44CB5L6d6LWW44CCCjIuIOWGmeinpuWPkeadoeS7tu+8mumUmeivr+eOh+OAgeW7tui/n+OAgeS4muWKoeaMh+agh+OAgeS6uuW3peWIpOaWreOAggozLiDlhpnmraXpqqTvvJrmjInpobrluo/jgIHlj6/lpI3liLbnspjotLTjgIHlkKvpqozor4Hlkb3ku6TjgIIKNC4g5pWw5o2u5Zue5rua77ya6L+B56e75piv5ZCm5pyJ5Y+N5ZCR6ISa5pys77yb5peg5YiZ5YaZ6KGl5YG/5pa55qGI44CCCjUuIOa8lOe7g++8muWcqOmalOemu+eOr+Wig+i3keS4gOmBje+8jOiusOW9leiAl+aXtuOAggo2LiDkuqflh7ogYHJvbGxiYWNrLm1kYOOAggoKIyMg6KeE5YiZCgotICoq5rKh5pyJ5ryU57uD6L+H55qE5Zue5rua5pa55qGI562J5LqO5rKh5pyJKirjgIIKLSDkuI3lj6/pgIbmk43kvZzvvIjliKDooajjgIHlj5Hmtojmga/jgIHosIPnrKzkuInmlrnvvInlv4XpobvmnInooaXlgb/mlrnmoYjjgIIKLSDlm57mu5rmraXpqqTkuI3og73kvp3otZbjgIzlvZPml7bpgqPkuKrkurrov5jlnKjjgI3jgIIKLSDlm57mu5rlkI7opoHpqozor4HvvJrlgaXlurfmo4Dmn6XjgIHlhbPplK7mjqXlj6PjgIHnm5HmjqfmgaLlpI3jgIIKCiMjIOS6pOaOpQoKYHJvbGxiYWNrLm1kYCDpmo/lj5HluIPorqHliJLkuIDotbfor4TlrqHvvJvlj5HluIPml7blgLznj63kurrlkZjlj6/nm7TmjqXmiafooYzjgIIK"
      },
      {
        "resourceId": "skill-smoke-check",
        "path": "roles/ops/skills/smoke-check/SKILL.md",
        "sha256": "21057e6f7ab46e3d16508f6c7878e9a4ff4f94f9ed166b05abc52b4db4d7c56a",
        "byteLength": 895,
        "mediaType": "text/markdown",
        "bodyBase64": "LS0tCm5hbWU6IHNtb2tlLWNoZWNrCmRlc2NyaXB0aW9uOiDmjInpqozmlLblgZrnlJ/kuqflhpLng5/vvIzorrDlvZXnu5PmnpzjgIHlvILluLjkuI7nu5PorrrvvJvlvZPlj5HluIPlrozmiJDlkI7kvb/nlKjjgIIKbGljZW5zZTogTUlUCm1ldGFkYXRhOgogIHJvbGVLZXk6IG9wcwogIHBhY2thZ2VWZXJzaW9uOiAwLjEuMAotLS0KCiMg55Sf5Lqn5YaS54OfCgojIyDkvZXml7bnlKgKCi0g5Y+R5biD5a6M5oiQ77yM6ZyA6KaB56Gu6K6k55Sf5Lqn5Y+v55So44CCCi0g5Zue5rua5ZCO6ZyA6KaB56Gu6K6k5oGi5aSN44CCCgojIyDmraXpqqQKCjEuIOmAieWGkueDn+iMg+WbtO+8muWFs+mUrui3r+W+hCArIOacrOasoeWPmOabtOa2ieWPiueahOmqjOaUtuOAggoyLiDpgJDmnaHmiafooYzvvJrorrDlvZXml7bpl7TjgIHnu5PmnpzjgIHlvILluLjjgIIKMy4g55yL55uR5o6n77ya6ZSZ6K+v546H44CB5bu26L+f44CB5YWz6ZSu5Lia5Yqh5oyH5qCH44CCCjQuIOWIpOWumu+8mumAmui/hyAvIOinguWvnyAvIOWbnua7muOAggo1LiDkuqflh7ogYHNtb2tlLm1kYOOAggoKIyMg6KeE5YiZCgotIOWGkueDn+imhueblumqjOaUtu+8jOS4jeimhuebluOAjOaIkeinieW+l+mHjeimgeOAjeOAggotIOWksei0peimgeeri+WNs+WIhua1ge+8muacrOasoeWPmOabtCAvIOeOr+WigyAvIOWOhuWPsumXrumimOOAggotIOOAjOinguWvn+OAjeW/hemhu+acieinguWvn+S6uuWSjOaXtumZkO+8jOS4jeiDveaCrOepuuOAggotIOWbnua7muWQjuWQjOagt+imgeWGkueDn++8jOehruiupOecn+eahOaBouWkjeS6huOAggoKIyMg5Lqk5o6lCgpgc21va2UubWRgIOS6pOWPkeW4g+ehruiupO+8m+e7k+iuuuS4uuOAjOWbnua7muOAjeaXtueri+WNs+aJp+ihjCBgcm9sbGJhY2subWRg44CCCg=="
      }
    ]
  },
  {
    "packageId": "workmesh.role.product",
    "version": "1.2.1",
    "roleKey": "product",
    "manifest": {
      "packageSchemaVersion": "1.1",
      "id": "workmesh.role.product",
      "version": "1.2.1",
      "protocolVersion": "1.0",
      "title": "产品角色包",
      "description": "把业务意图转成可判定的 PRD 与验收，供下游并行开工。",
      "license": "MIT",
      "roleKey": "product",
      "compatibility": {
        "minCliVersion": "1.0.0",
        "maxCliVersionExclusive": "2.0.0",
        "contractVersion": "1.0"
      },
      "skills": [
        {
          "key": "clarify-intent",
          "path": "skills/clarify-intent/SKILL.md",
          "description": "把模糊的业务诉求整理成目标、边界与未知项，并在开工前暴露歧义。",
          "whenToUse": "需求刚提出、下游回问或范围不清时。"
        },
        {
          "key": "write-prd",
          "path": "skills/write-prd/SKILL.md",
          "description": "基于已确认的理解与业务知识产出 PRD，写清范围、约束与依赖。",
          "whenToUse": "理解已确认、需要出稿或修订 PRD 时。"
        },
        {
          "key": "map-acceptance",
          "path": "skills/map-acceptance/SKILL.md",
          "description": "把 PRD 拆成带稳定小写 key、text 与 verification 的正式验收条目。",
          "whenToUse": "PRD 草稿完成或验收需要修订时。"
        },
        {
          "key": "check-requirements",
          "path": "skills/check-requirements/SKILL.md",
          "description": "按风险检查需求质量与跨工件一致性，记录缺口、依据和澄清事项。",
          "whenToUse": "PRD 草稿完成或变更范围扩大时。"
        },
        {
          "key": "assess-idea",
          "path": "skills/assess-idea/SKILL.md",
          "description": "用正反证据、成本与备选方向形成继续、澄清或停止的建议。",
          "whenToUse": "方向尚未确定或需要比较产品投入时。"
        }
      ],
      "inputs": [
        {
          "key": "context",
          "source": "TASK_SNAPSHOT",
          "kind": "CONTEXT",
          "required": true,
          "contractVersion": "1.0"
        },
        {
          "key": "business-knowledge",
          "source": "KNOWLEDGE",
          "kind": "KNOWLEDGE",
          "required": true,
          "contractVersion": "1.0"
        }
      ],
      "outputs": [
        {
          "key": "understanding",
          "channel": "CANDIDATE",
          "kind": "UNDERSTANDING",
          "contractVersion": "1.0",
          "templateResourceId": "template-understanding"
        },
        {
          "key": "prd",
          "channel": "CANDIDATE",
          "kind": "PRD",
          "contractVersion": "1.0",
          "templateResourceId": "template-prd",
          "evidence": [
            "INSPECTION"
          ]
        }
      ],
      "resources": [
        {
          "id": "example-prd-example",
          "kind": "example",
          "path": "assets/examples/prd-example.md",
          "sha256": "db40f5d3a42a16b8142ff96b056f3432e790c8825ba1eca776bde4bcd4f56ca3",
          "byteLength": 1550,
          "mediaType": "text/markdown"
        },
        {
          "id": "template-acceptance-json",
          "kind": "template",
          "path": "assets/templates/acceptance.json",
          "sha256": "c8b92ccde29e80f34f028a77b1267726b7cdd777907a22529ac38adb1f4d0435",
          "byteLength": 305,
          "mediaType": "application/json"
        },
        {
          "id": "template-acceptance",
          "kind": "template",
          "path": "assets/templates/acceptance.yaml",
          "sha256": "582781be35b73b9fb8f6ca1f9471a510405adb71b90dd5bd22181a3b57962982",
          "byteLength": 778,
          "mediaType": "application/yaml"
        },
        {
          "id": "template-idea-assessment",
          "kind": "template",
          "path": "assets/templates/idea-assessment.md",
          "sha256": "ca48cd4e7f657022e931a37666440bcd6ae9f4e2fe748ae28c171806e132140c",
          "byteLength": 826,
          "mediaType": "text/markdown"
        },
        {
          "id": "template-prd",
          "kind": "template",
          "path": "assets/templates/prd.md",
          "sha256": "760d7641a9e1b75351dc32b884058bdf20ce625a116069cc4f8bdcc9bbd19192",
          "byteLength": 1726,
          "mediaType": "text/markdown"
        },
        {
          "id": "template-understanding",
          "kind": "template",
          "path": "assets/templates/understanding.md",
          "sha256": "f62c83e1feb7c9b52563b50a240f90e5c3953935a02567422c90206d56716560",
          "byteLength": 547,
          "mediaType": "text/markdown"
        },
        {
          "id": "checklist-prd-quality",
          "kind": "checklist",
          "path": "checklists/prd-quality.md",
          "sha256": "3feaedfcccf41826c5e64e9e8c7e6b7fea88b5472bb41966e715e096e2fd6b3e",
          "byteLength": 1596,
          "mediaType": "text/markdown"
        },
        {
          "id": "checklist-spec-driven",
          "kind": "checklist",
          "path": "checklists/spec-driven.md",
          "sha256": "eddb341cf017d46fc1a03cf0a89de031acdc1d72ec318fa2ae8a55a48ade6bac",
          "byteLength": 1124,
          "mediaType": "text/markdown"
        },
        {
          "id": "guide",
          "kind": "prompt",
          "path": "guide.md",
          "sha256": "971e3effb09ae536864e5bb50a32aea77fc93e3806068782cce125134622bec1",
          "byteLength": 4349,
          "mediaType": "text/markdown"
        },
        {
          "id": "reference-references",
          "kind": "reference",
          "path": "references/references.json",
          "sha256": "4e8e6765c903eee2af5d90fd8d1ba70213a138198bb5e7c4f2fa679d25179b87",
          "byteLength": 541,
          "mediaType": "application/json"
        },
        {
          "id": "skill-assess-idea",
          "kind": "skill",
          "path": "skills/assess-idea/SKILL.md",
          "sha256": "dcfb70939a358ee879fb88fa92f0e9425691fd15fc3aa9e82f95efb6708d4de9",
          "byteLength": 1167,
          "mediaType": "text/markdown"
        },
        {
          "id": "skill-check-requirements",
          "kind": "skill",
          "path": "skills/check-requirements/SKILL.md",
          "sha256": "3f7c55dc63283ab5f8238214c8a15f3818df764c7f28712c607a819e32aa77b1",
          "byteLength": 1640,
          "mediaType": "text/markdown"
        },
        {
          "id": "skill-clarify-intent",
          "kind": "skill",
          "path": "skills/clarify-intent/SKILL.md",
          "sha256": "da0dc50e8bd7ea9ae2819c991451b8050dd783807769aee1baecbdef1b6b4f23",
          "byteLength": 1904,
          "mediaType": "text/markdown"
        },
        {
          "id": "skills-index",
          "kind": "index",
          "path": "skills/index.md",
          "sha256": "684268cb886023554d04fea7dcdf4c9539db9bb0404fda1072893f32a70b1a0c",
          "byteLength": 1440,
          "mediaType": "text/markdown"
        },
        {
          "id": "skill-map-acceptance",
          "kind": "skill",
          "path": "skills/map-acceptance/SKILL.md",
          "sha256": "5d1c0c9c537407cc6d33649a4136820e4aec66f25c34c80c50c1ad5ad423cf2b",
          "byteLength": 2494,
          "mediaType": "text/markdown"
        },
        {
          "id": "skill-write-prd",
          "kind": "skill",
          "path": "skills/write-prd/SKILL.md",
          "sha256": "45adab2d85603584e020bbba17d239bcbadb3567db6e43fb962250356fa53f2b",
          "byteLength": 2059,
          "mediaType": "text/markdown"
        }
      ],
      "agentEntries": [
        {
          "host": "codex",
          "type": "AGENTS_MD_POINTER",
          "resourceId": "skills-index",
          "adapterVersion": "1.0.0"
        },
        {
          "host": "claude-code",
          "type": "SKILLS_DIRECTORY",
          "resourceId": "skills-index",
          "adapterVersion": "1.0.0"
        }
      ]
    },
    "resources": [
      {
        "resourceId": "example-prd-example",
        "path": "roles/product/assets/examples/prd-example.md",
        "sha256": "db40f5d3a42a16b8142ff96b056f3432e790c8825ba1eca776bde4bcd4f56ca3",
        "byteLength": 1550,
        "mediaType": "text/markdown",
        "bodyBase64": "IyBQUkQg56S65L6L77ya5pSv5oyB5pys5Zyw5qih5Z6L5o6l5YWlCgo+IOmcgOaxgue8luWPt++8mllGRi0wMDMgwrcg54mI5pys77yadjEgwrcg54q25oCB77ya5bey5Y+R5biDCj4g5L6d5o2u55CG6Kej77yadW5kZXJzdGFuZGluZyB2MQoKIyMgMS4g6IOM5pmvCgrkvIHkuJrlrqLmiLfopoHmsYLmqKHlnovosIPnlKjkuI3lh7rlhoXnvZHjgILlvZPliY3lj6rmlK/mjIHkupHnq6/mqKHlnovvvIzlr7zoh7TkuKTkuKrlnKjosIjlrqLmiLfml6Dms5Xph4fotK3jgIIKCiMjIDIuIOebruaghwoK55So5oi35Y+v5Lul5Zyo6K6+572u6aG15YiH5o2i5Yiw5pys5Zyw5qih5Z6L77yM5YiH5o2i5ZCO5paw5bu655qE5a+56K+d5L2/55So5pys5Zyw5qih5Z6L77yM5LiU5LiN6ZyA6KaB6YeN5ZCv5bqU55So44CCCgojIyAzLiDojIPlm7QKCioq5YGaKioKCi0g6K6+572u6aG15paw5aKe44CM5qih5Z6L5p2l5rqQ44CN6YCJ6aG577ya5LqR56uvIC8g5pys5Zyw44CCCi0g5pys5Zyw5qih5byP5LiL5qCh6aqM5Zyw5Z2A5Y+v6L6+77yM5LiN5Y+v6L6+5pe257uZ5Ye65piO56Gu5o+Q56S644CCCi0g5YiH5o2i5Y+q5b2x5ZON5paw5a+56K+d77yM5bey5pyJ5a+56K+d5L+d5oyB5Y6f5qih5Z6L44CCCgoqKuS4jeWBmioqCgotIOS4jeWBmuacrOWcsOaooeWei+eahOmDqOe9suS4jui/kOe7tOOAggotIOS4jeWBmuWkmuacrOWcsOaooeWei+i0n+i9veWdh+ihoeOAggoKIyMgNC4g5pa55qGI6KaB54K5CgotIOacrOWcsOWcsOWdgOWPquWFgeiuuOWGhee9keaute+8jOemgeatouWFrOe9keWcsOWdgOOAggotIEFQSSBrZXkg5Zyo5pys5Zyw5qih5byP5LiL5Y+v55WZ56m677yM5L2G55WM6Z2i5b+F6aG75Yy65YiG44CM5pyq6YWN572u44CN5LiO44CM6YWN572u6ZSZ6K+v44CN44CCCgojIyA1LiDkvp3otZbkuI7nuqbmnZ8KCnwg57G75Z6LIHwg5YaF5a65ICAgICAgICAgICAgICAgICAgICAgICAgICAgfCDlvbHlk40gICAgICAgfAp8IC0tLS0gfCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gfCAtLS0tLS0tLS0tIHwKfCDlpZHnuqYgfCDmqKHlnovosIPnlKjnu5/kuIDotbAgcHJvdmlkZXIg6YCC6YWN5bGCIHwg5LiN5paw5aKe55u06L+eIHwKfCDlkIjop4QgfCDmnKzlnLDlnLDlnYDkuI3lvpflpJblj5EgICAgICAgICAgICAgICB8IOaXpeW/l+iEseaVjyAgIHwKCiMjIDYuIOmqjOaUtgoK6KeBIGBhY2NlcHRhbmNlLnlhbWxg44CC54m55Yir6K+05piO77yaYWMtMDEg5LiOIGFjLTAyIOeahOWIpOWumumcgOimgeWcqOWQjOS4gOS8muivneWGhei/nue7reWIh+aNouS4pOasoeOAggoKIyMg5pyq5Yaz6Zeu6aKYCgp8IOmXrumimCAgICAgICAgICAgICAgICAgICAgICAgICAgIHwg6Zi75aGeIHwg6LSj5Lu75Lq6IHwg54q25oCBICAgICAgICAgfAp8IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSB8IC0tLS0gfCAtLS0tLS0gfCAtLS0tLS0tLS0tLS0gfAp8IOacrOWcsOaooeWei+mJtOadg+aWueW8j+aYr+WQpuS4juS6keerr+S4gOiHtCB8IOWQpiAgIHwg5ZCO56uvICAgfCDlt7LmvoTmuIXvvJrkuIDoh7QgfAo="
      },
      {
        "resourceId": "template-acceptance-json",
        "path": "roles/product/assets/templates/acceptance.json",
        "sha256": "c8b92ccde29e80f34f028a77b1267726b7cdd777907a22529ac38adb1f4d0435",
        "byteLength": 305,
        "mediaType": "application/json",
        "bodyBase64": "WwogIHsgImtleSI6ICJhYy0wMSIsICJ0ZXh0IjogIjzkuIDkuKrlj6/op4LmtYvnu5PmnpzvvIzkuIDlj6Xor53vvIzlj6/liKTlrpo+IiwgInZlcmlmaWNhdGlvbiI6ICJURVNUIiB9LAogIHsgImtleSI6ICJhYy0wMiIsICJ0ZXh0IjogIjznlYzpnaIv5paH5qGIL+mFjee9ruexu+e7k+aenD4iLCAidmVyaWZpY2F0aW9uIjogIklOU1BFQ1RJT04iIH0sCiAgeyAia2V5IjogImFjLTAzIiwgInRleHQiOiAiPOmcgOimgeaMieatpemqpOa8lOekuuaJjeiDveWIpOaWreeahOe7k+aenD4iLCAidmVyaWZpY2F0aW9uIjogIkRFTU8iIH0KXQo="
      },
      {
        "resourceId": "template-acceptance",
        "path": "roles/product/assets/templates/acceptance.yaml",
        "sha256": "582781be35b73b9fb8f6ca1f9471a510405adb71b90dd5bd22181a3b57962982",
        "byteLength": 778,
        "mediaType": "application/yaml",
        "bodyBase64": "IyDpqozmlLbmnaHnm67mqKHmnb8KIyBrZXkg56iz5a6a44CB5rC45LiN5aSN55So77yb5Yig6Zmk5p2h55uu55So5aKT56KR5qCH6K6w77yM5LiN5aSN55SoIGtleeOAggojIHZlcmlmaWNhdGlvbjogVEVTVCB8IElOU1BFQ1RJT04gfCBERU1PCiMg5q2j5byPIEFQSSDlrZfmrrXlj6rmnIkga2V5IC8gdGV4dCAvIHZlcmlmaWNhdGlvbu+8m+mjjumZqeWIhuexu+WGmeWcqCBQUkQv6K+E5a6h5p2Q5paZ44CCCiMgY2FuZGlkYXRlIC0tYWNjZXB0YW5jZSDor7vlj5YgSlNPTiDmlbDnu4TvvJvkvb/nlKjphY3lpZcgYWNjZXB0YW5jZS5qc29uIOaIluWFiOi9rOaNoiBhY2NlcHRhbmNlIOaVsOe7hOOAggoKdmVyc2lvbjogMQpyZXF1aXJlbWVudDogPFBST0pFQ1RfS0VZPi085bqP5Y+3PgoKYWNjZXB0YW5jZToKICAtIGtleTogYWMtMDEKICAgIHRleHQ6IDzkuIDkuKrlj6/op4LmtYvnu5PmnpzvvIzkuIDlj6Xor53vvIzlj6/liKTlrpo+CiAgICB2ZXJpZmljYXRpb246IFRFU1QKCiAgLSBrZXk6IGFjLTAyCiAgICB0ZXh0OiA855WM6Z2iL+aWh+ahiC/phY3nva7nsbvnu5Pmnpw+CiAgICB2ZXJpZmljYXRpb246IElOU1BFQ1RJT04KCiAgLSBrZXk6IGFjLTAzCiAgICB0ZXh0OiA86ZyA6KaB5oyJ5q2l6aqk5ryU56S65omN6IO95Yik5pat55qE57uT5p6cPgogICAgdmVyaWZpY2F0aW9uOiBERU1PCgpyZW1vdmVkOiBbXQojIHJlbW92ZWQg56S65L6L77yaLSBrZXk6IGFjLTAwXG4jICAgcmVhc29uOiA85Li65LuA5LmI5Yig6ZmkPlxuIyAgIHJlcGxhY2VkQnk6IGFjLTAxCg=="
      },
      {
        "resourceId": "template-idea-assessment",
        "path": "roles/product/assets/templates/idea-assessment.md",
        "sha256": "ca48cd4e7f657022e931a37666440bcd6ae9f4e2fe748ae28c171806e132140c",
        "byteLength": 826,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDmg7Pms5Xor4TkvLDvvJo85qCH6aKYPgoKIyMg6Zeu6aKY5LiO5oqV5YWl6L6555WMCgrljp/or53jgIHnlKjmiLfjgIHnl5vngrnjgIHnjrDmnInmm7/ku6PmlrnlvI/jgIHkuI3lgZrnmoTmiJDmnKzjgIHmiJDlip/mjIfmoIfkuI7lj6/mib/mi4XmipXlhaXjgIIKCiMjIOaUr+aMgeS4juWPjeWvueivgeaNrgoKfCDnu5PorrogfCDmnaXmupAv5pe26Ze0IHwg5pSv5oyB5oiW5Y+N5a+5IHwg5Y+v5L+h56iL5bqmIHwg5b6F6aqM6K+B5YGH6K6+IHwKfCAtLS0tIHwgLS0tLS0tLS0tIHwgLS0tLS0tLS0tLSB8IC0tLS0tLS0tIHwgLS0tLS0tLS0tLSB8CnwgICAgICB8ICAgICAgICAgICB8ICAgICAgICAgICAgfCAgICAgICAgICB8ICAgICAgICAgICAgfAoKIyMg5pa55ZCR5q+U6L6DCgp8IOaWueWQke+8iOWQq+e7tOaMgeeOsOeKtu+8iSB8IOaUtuebiiB8IOaIkOacrC/po47pmakgfCDnuqbmnZ8gfCDmnIDlsI/pqozor4EgfAp8IC0tLS0tLS0tLS0tLS0tLS0tLSB8IC0tLS0gfCAtLS0tLS0tLS0gfCAtLS0tIHwgLS0tLS0tLS0gfAp8ICAgICAgICAgICAgICAgICAgICB8ICAgICAgfCAgICAgICAgICAgfCAgICAgIHwgICAgICAgICAgfAoKIyMg5Yaz562W5bu66K6u5LiO5Lqk5o6lCgpHTyAvIE5FRURTX0NMQVJJRklDQVRJT04gLyBTVE9Q77yaPOeQhueUseOAgeacquWGs+mhueOAgei0n+i0o+S6uuOAgeWkjeafpeadoeS7tj7jgIIK57un57ut5pe25Lqk5o6l6Zeu6aKY44CB55uu5qCH44CB6Z2e55uu5qCH44CB5bey56Gu6K6k57qm5p2f5LiO5p2l5rqQ77yb5LiN5Zyo6L+Z6YeM57yW6YCg5a6e546w5Lu75Yqh5oiW5om55YeG57uT5p6c44CCCg=="
      },
      {
        "resourceId": "template-prd",
        "path": "roles/product/assets/templates/prd.md",
        "sha256": "760d7641a9e1b75351dc32b884058bdf20ce625a116069cc4f8bdcc9bbd19192",
        "byteLength": 1726,
        "mediaType": "text/markdown",
        "bodyBase64": "IyBQUkTvvJo86ZyA5rGC5qCH6aKYPgoKPiDpnIDmsYLnvJblj7fvvJo8UFJPSkVDVF9LRVk+LTzluo/lj7c+IMK3IOeJiOacrO+8mnYxIMK3IOeKtuaAge+8muiNieeovwo+IOS+neaNrueQhuino++8mjx1bmRlcnN0YW5kaW5nIOeJiOacrOaIlumTvuaOpT4KCiMjIDEuIOiDjOaZrwoK5Li65LuA5LmI546w5Zyo5YGa77yM6LCB5Y+X5b2x5ZON77yM5LiN5YGa55qE5Luj5Lu35piv5LuA5LmI44CCCgojIyAyLiDnm67moIcKCuS4gOWPpeWPr+mqjOivgeeahOebruagh+OAguS4jeimgeWGmeaEv+aZr++8jOS4jeimgeWGmeOAjOaPkOWNh+S9k+mqjOOAjeOAggoKIyMgMy4g6IyD5Zu0CgoqKuWBmioqCgotCgoqKuS4jeWBmioqCgotCgojIyA0LiDmlrnmoYjopoHngrkKCuWPquWGmee6puadn+S4juWFs+mUruWPluiIje+8muW/hemhu+mBteWuiOeahOinhOWImeOAgeS4jeiDveaUueeahOaOpeWPo+OAgeWFvOWuueaAp+imgeaxguOAggoKIyMgNS4g5L6d6LWW5LiO57qm5p2fCgp8IOexu+WeiyAgICAgfCDlhoXlrrkgfCDlvbHlk40gfAp8IC0tLS0tLS0tIHwgLS0tLSB8IC0tLS0gfAp8IOWNleWFgyAgICAgfCAgICAgIHwgICAgICB8Cnwg5aWR57qmICAgICB8ICAgICAgfCAgICAgIHwKfCDlpJbpg6jns7vnu58gfCAgICAgIHwgICAgICB8Cnwg5ZCI6KeEICAgICB8ICAgICAgfCAgICAgIHwKCiMjIDYuIOmqjOaUtgoK6KeB5ZCM55uu5b2VIGBhY2NlcHRhbmNlLnlhbWxg44CC5pys6IqC5LiN6YeN5aSN6aqM5pS25p2h55uu77yM5Y+q5YaZ6aqM5pS25Y+j5b6E55qE54m55q6K6K+05piO44CCCgrmraPlvI/mj5DkuqTkvb/nlKjphY3lpZcgSlNPTiDmlbDnu4TvvJpgLS1hY2NlcHRhbmNlIEBhY2NlcHRhbmNlLmpzb25g44CC5Lik56eN6KGo56S65L+d5oyB55u45ZCMIGtleeOAgeato+aWh+WSjOmqjOivgeaWueW8j+OAggoKIyMg5Lia5Yqh5Zy65pmv5LiO5oiQ5Yqf5qCH5YeG77yI5oyJ6ZyA5bGV5byA77yJCgp8IOWcuuaZry/kvJjlhYjnuqcgfCDnlKjmiLfnu5PmnpwgfCDlr7nlupTpqozmlLYga2V5IHwg54us56uL6aqM6K+B5pa55byPIHwKfCAtLS0tLS0tLS0tLSB8IC0tLS0tLS0tIHwgLS0tLS0tLS0tLS0tIHwgLS0tLS0tLS0tLS0tIHwKfCAgICAgICAgICAgICB8ICAgICAgICAgIHwgICAgICAgICAgICAgIHwgICAgICAgICAgICAgIHwKCuWkmuWcuuaZr+mcgOaxguaMieeUqOaIt+S7t+WAvOaghyBQMS9QMi9QM++8jOW5tumAieWHuuacgOWwj+WPr+eUqOeahOmmluS4querr+WIsOerr+S6pOS7mOWIh+eJh++8iE1WUO+8ieOAguivtOaYjuabtOS9juS8mOWFiOe6p+eahOW7tuacn+eQhueUseWSjOmHjeWQr+adoeS7tu+8m+S8mOWFiOe6p+W7uuiurumcgOeUseS4muWKoei0n+i0o+S6uuehruiupO+8jOS4jeS8muiHquWKqOaUueWKqOW5s+WPsOiMg+WbtOOAgueugOWNlemcgOaxguaXoOmcgOmineWkluaLhuWIhuOAggoK5raJ5Y+K5a6J5YWo44CB5oCn6IO944CB5Y+v6K6/6Zeu5oCn44CB5YW85a655oCn5oiW5aSW6YOo6ZuG5oiQ5pe277yM6KGl6b2Q6ZiI5YC844CB6L6555WM44CB5aSx6LSl5LiO5oGi5aSN6KGM5Li677yb5LiN6YCC55So6aG56K+05piO5Y6f5Zug77yM5LiN5by65Yi25YeR56ug6IqC44CCCgojIyDmnKrlhrPpl67popgKCnwg6Zeu6aKYIHwg6Zi75aGeIHwg6LSj5Lu75Lq6IHwg54q25oCBIHwKfCAtLS0tIHwgLS0tLSB8IC0tLS0tLSB8IC0tLS0gfAp8ICAgICAgfCAgICAgIHwgICAgICAgIHwgICAgICB8Cg=="
      },
      {
        "resourceId": "template-understanding",
        "path": "roles/product/assets/templates/understanding.md",
        "sha256": "f62c83e1feb7c9b52563b50a240f90e5c3953935a02567422c90206d56716560",
        "byteLength": 547,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDnkIbop6PvvIhVbmRlcnN0YW5kaW5n77yJCgo+IOeUsSBgY2xhcmlmeS1pbnRlbnRgIOS6p+WHuu+8jOS6pOS6p+WTgeehruiupOWQjuS9nOS4uiBQUkQg55qE6L6T5YWl5Z+657q/44CCCgojIyDnm67moIcKCuS4gOWPpeivne+8muiwgeOAgeWcqOS7gOS5iOWcuuaZr+OAgeimgei+vuaIkOS7gOS5iOOAggoKIyMg6L6555WMCgoqKuWBmioqCgotIO+8iOS4ieadoeS7peWGhe+8iQoKKirkuI3lgZoqKgoKLSDvvIjkuInmnaHku6XlhoXvvIkKCiMjIOacquefpemhuQoKfCDnvLrlj6MgfCDmmK/lkKbpmLvloZ4gfCDlvbHlk43osIEgfCDosIHmnaXooaUgfAp8IC0tLS0gfCAtLS0tLS0tLSB8IC0tLS0tLSB8IC0tLS0tLSB8CnwgICAgICB8ICAgICAgICAgIHwgICAgICAgIHwgICAgICAgIHwKCiMjIOS+neaNrgoKfCDnu5PorrogfCDkvp3mja4gfAp8IC0tLS0gfCAtLS0tIHwKfCAgICAgIHwgICAgICB8CgojIyDnoa7orqQKCi0g56Gu6K6k5Lq677yaCi0g56Gu6K6k5pe26Ze077yaCi0g57uT6K6677ya5b6F56Gu6K6kIC8g5bey56Gu6K6kIC8g6ZyA6YeN5YGaCg=="
      },
      {
        "resourceId": "checklist-prd-quality",
        "path": "roles/product/checklists/prd-quality.md",
        "sha256": "3feaedfcccf41826c5e64e9e8c7e6b7fea88b5472bb41966e715e096e2fd6b3e",
        "byteLength": 1596,
        "mediaType": "text/markdown",
        "bodyBase64": "IyBQUkQg6LSo6YeP5riF5Y2VCgrkuqTku5jliY3pgJDmnaHoh6rmo4DvvIzmnKrov4fnmoTpobnlhpnmuIXljp/lm6DvvIzkuI3pmpDol4/jgIIKCi0gWyBdIOiDjOaZr+iDveWbnuetlOOAjOS4uuS7gOS5iOeOsOWcqOWBmuOAje+8jOS4jeaYr+OAjOS4gOebtOaDs+WBmuOAjeOAggotIFsgXSDnm67moIfmmK/kuIDlj6Xlj6/pqozor4HnmoTor53vvIzmsqHmnInjgIzmj5DljYfkvZPpqozjgI3jgIzkvJjljJbmtYHnqIvjgI3jgIIKLSBbIF0g6IyD5Zu05YaZ5LqG44CM5LiN5YGa5LuA5LmI44CN77yM5LiU6IO95oyh5L2P6Iez5bCR5LiA5Liq6K+x5oOR44CCCi0gWyBdIOavj+adoeWFs+mUrue7k+iuuumDveacieS+neaNru+8iOefpeivhuW6kyBrZXnjgIHljoblj7LpnIDmsYLjgIHlhrPnrZborrDlvZXvvInjgIIKLSBbIF0g5rKh5pyJ5oqK5a6e546w57uG6IqC77yI5o6l5Y+j44CB6KGo57uT5p6E44CB57uE5Lu25ZCN77yJ5YaZ6L+bIFBSROOAggotIFsgXSDkvp3otZbkuI7nuqbmnZ/liJfkuobljZXlhYPjgIHlpZHnuqbjgIHlpJbpg6jns7vnu5/jgIIKLSBbIF0g6aqM5pS25Y2V54us5oiQ5paH77yM5q2j5paH5rKh5pyJ6YeN5aSN5p2h55uu44CCCi0gWyBdIOavj+adoemqjOaUtumDveiDveWGmeWHuuS4gOauteS8muWksei0peeahOajgOafpeOAggotIFsgXSDpqozmlLbph4zmsqHmnInpu5HlkI3ljZXor43vvIjlj4vlpb3jgIHlv6vpgJ/jgIHlkIjnkIbjgIHlsL3ph4/jgIHkvJjljJbjgIHlrozlloTvvInjgIIKLSBbIF0g6aqM5pS257KS5bqm6Laz5Lul54us56uL6aqM6K+B77yb6Iul6IyD5Zu06L+H5aSn77yM5bey5oyJ5Lia5Yqh5Zy65pmv5ouG5YiG77yb5q2j5byPIEFQSSDlhYHorrggMeKAkzIwMCDmnaHvvIzkuI3miorlu7rorq7mlbDph4/lvZPnoazpl6jmp5vjgIIKLSBbIF0g5pyq5Yaz6Zeu6aKY6YO95pyJ6LSj5Lu75Lq65LiO6Zi75aGe5qCH6K6w44CCCi0gWyBdIOaWh+aho+a3seW6puS4jumjjumZqeOAgeS+nei1luOAgeWcuuaZr+WkjeadguW6puWMuemFje+8m+W/heimgeS/oeaBr+m9kOWFqO+8jOayoeacieS4uuWHkemhteaVsOaIlueroOiKguiAjOmHjeWkjeOAggotIFsgXSDmjInlj5jmm7Tpo47pmanmo4Dmn6XkuoblronlhajjgIHlhbzlrrnmgKfjgIHmgKfog73jgIHlvILluLjlj4rlj6/orr/pl67mgKfvvJvkuI3pgILnlKjpobnmnInnkIbnlLHjgIIKLSBbIF0g5aSa5Zy65pmv6ZyA5rGC5oyJ55So5oi35Lu35YC85qCH5piO5LyY5YWI57qn77yM56Gu5a6a6aaW5Liq5Y+v54us56uL6aqM6K+B55qE56uv5Yiw56uv5YiH54mH77yM5bm26K6w5b2V5bu25pyf6aG555qE55CG55SxL+mHjeWQr+adoeS7tu+8m+eugOWNlemcgOaxguS4jeW8uuWItuWIhuacn+OAggoKIyMg5Lqk5LuY5YmN5pyA5ZCO5LiJ6ZeuCgoxLiDkuIvmuLjmi7/liLDov5nku70gUFJE77yM6IO95LiN6IO95LiN6Zeu6Zeu6aKY5bCx5byA5aeL77yfCjIuIOWmguaenOWPquiDveWunueOsOS4gOWNiu+8jOW6lOivpeegjeWTquS4gOWNiu+8n1BSRCDph4zlhpnkuoblkJfvvJ8KMy4g5LiJ5ZGo5ZCO5Zue5p2l55yL77yM6L+Z5Lu9IFBSRCDov5jog73liKTmlq3jgIzlgZrmsqHlgZrlrozjgI3lkJfvvJ8K"
      },
      {
        "resourceId": "checklist-spec-driven",
        "path": "roles/product/checklists/spec-driven.md",
        "sha256": "eddb341cf017d46fc1a03cf0a89de031acdc1d72ec318fa2ae8a55a48ade6bac",
        "byteLength": 1124,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDop4TmoLzkuI7kuqTku5jljY/kvZzmo4Dmn6UKCuWPquWKoOi9veacrOasoeS7u+WKoea2ieWPiueahOaooeadv+WSjOa4heWNleOAgueugOWNleaUueWKqOWGmeW/heimgeS/oeaBr++8m+WkjeadguW6puadpeiHqumjjumZqeOAgeS+nei1luWSjOmqjOaUtuiMg+WbtO+8jOS4jeaMieWbuuWumumhteaVsOaIlueroOiKguaVsOWIpOaWrei0qOmHj+OAggoKLSBbIF0g5bey6K+75pys5qyh5b+r54Wn5LiO6aG555uu6KeE6IyD77yM56Gu6K6kIFBSRC/nn6Xor4bkv67orqLvvJvogIHpobnnm67lhYjmoLjlr7nlrp7pmYXku6PnoIHjgIHlt6XlhbfphY3nva7kuI7njrDmnInooYzkuLrjgIIKLSBbIF0g5YWz6ZSu57uT6K665pyJ5p2l5rqQ77yb6LCD5p+l5pyq55+l6aG544CB5pa55qGI5Y+W6IiN44CB5L6L5aSW5LiO5bu25pyf5Z2H5pyJ55CG55Sx5ZKM6LSj5Lu75Lq644CCCi0gWyBdIOS7peW3suehruiupOmqjOaUtiBrZXkg5YWz6IGU5pys6KeS6Imy5Lqn54mp77yb5Lu75Yqh5YiX5L6d6LWW44CB6LSf6LSj5paH5Lu25LiO6aqM6K+B5pa55byP77yM5YWx55So5paH5Lu25LiN5peg5L6d5o2u5Zyw5bm26KGM5L+u5pS544CCCi0gWyBdIOmcgOaxgui0qOmHj+OAgeeUqOS+i+iuvuiuoeimhuebluOAgeWunumZheaJp+ihjOe7k+aenOWSjCBIVU1BTiDmraPlvI/pqozmlLbliIbliKvorrDlvZXjgIIKLSBbIF0g5omA5pyJ5pyq6L+Q6KGM44CB5aSx6LSl44CB6Zi75aGe44CB5peg5rOV5qC46aqM55qE5YaF5a655piO56Gu5qCH5Ye677ybQWdlbnQg5oql5ZGK5LiN5aOw56ew54us56uL6aqM6K+B44CCCi0gWyBdIOe8uuWPo+S7peeos+WumiBJRCDov73liqDlubblm57pk77ljp/orrDlvZXvvJvotoXlh7rpnIDmsYLojIPlm7TlhYjotbDlj5jmm7TvvIzkv67mlLnln7rnur/lkI7ph43mlrDmoLjlr7nor4Hmja7jgIIKCuinkuiJsui1hOa6kOabtOaWsO+8muW3sumUgeWumueJiOacrOS/neaMgeWOn+Wtl+iKgu+8jOaWsOaWueazleWcqOaWsOWMheeJiOacrOWuieijheWQjueUn+aViOOAguWuv+S4u+WFpeWPo+WPquaMh+WQkeinkuiJsui1hOa6kO+8m+mhueebruiHquWumuS5ieinhOiMg+maj+mhueebruefpeivhuS/ruiuou+8jOS4jeWkjeWItui/m+inkuiJsuWMheOAggo="
      },
      {
        "resourceId": "guide",
        "path": "roles/product/guide.md",
        "sha256": "971e3effb09ae536864e5bb50a32aea77fc93e3806068782cce125134622bec1",
        "byteLength": 4349,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDkuqflk4Hop5LoibLvvIhwcm9kdWN077yJCgrkvaDotJ/otKPmiorpnIDmsYLlj5jmiJAqKuWPr+ivhOWuoeeahOivreS5ieWfuuW6pyoq77ya5YWI55SoIFVuZGVyc3RhbmRpbmcg5Zu65a6a5a+56ZyA5rGC55qE55CG6Kej77yM5YaN5Lqn5Ye6IFBSRCDlgJnpgInjgIIK5L2g5LiN5piv5omn6KGM6ICF77yM5Lmf5LiN5oul5pyJ5om55YeG5p2D44CCCgojIyDovrnnlYwKCi0g5L2g5Y+q6IO95o+Q5LqkKirlgJnpgIkqKu+8m+WPkeW4g+OAgeaJueWHhuOAgeaSpOWbnumDveWPquWPkeeUn+WcqCBXZWLvvIznlLHlhbflpIfmnYPpmZDnmoQgSFVNQU4g5Zyo6K+E5a6h6aG15a6M5oiQ44CCCi0g5LiN6IO96Ieq6YCg5a6h5om55Lq644CB5LiN6IO96Ieq5oql5om55YeG57uT5p6c44CB5LiN6IO957uV6L+HIGBiYXNpc1VuZGVyc3RhbmRpbmdSZXZpc2lvbklkYCDnmoTln7rnur/moKHpqozjgIIKLSDkuI3og73kv67mlLnpnIDmsYLmnKzouqvvvJvpnIDmsYLnlLHlubPlj7DkvqfkurrnsbvliJvlu7rjgIIKCiMjIFByb2R1Y3QgQWdlbnQg5a+56K+d5Y2P6K6u77yIUDDvvIkKCuS6p+WTgeW3peS9nOWIhuS4pOS4quaooeW8j++8mgoKLSBgQlJBSU5TVE9STWDvvJrmianlpKfpl67popjjgIHnlKjmiLfnl5vngrnjgIHmlrnmoYjjgIHlgYforr7lkozlrp7pqoznqbrpl7TvvJvlhYHorrjkv53nlZnmnKrnn6XpobnvvIzkuI3liJvlu7rmraPlvI8gUmVxdWlyZW1lbnTjgIIKLSBgUkVRVUlSRU1FTlRg77ya5Zyo6YCJ5oup5pa55ZCR5ZCO5pS25pWb55uu5qCH44CB6IyD5Zu044CB5Lia5Yqh6KeE5YiZ5ZKM6aqM5pS25qCH5YeG77yM5omN6IO955Sf5oiQIFBSROOAggoK5Lqn5ZOB5Lq65ZGY5Zyo5pys5ZywIEFnZW50IOS4reeUqOiHqueEtuivreiogOS6pOS6ku+8m0FnZW50IOi0n+i0o+eQhuino+OAgeajgOe0ouOAgemAkOmimOa+hOa4heWSjOeUn+aIkOiNieeov++8jFdvcmtNZXNoIOi0n+i0o+aMgeS5heWMlueJiOacrOS4juWAmemAieivhOWuoeOAguavj+i9ruWPquWxleekuuW9k+WJjemXrumimO+8jOetlOahiOW/hemhu+WjsOaYjuiQveeCue+8jOS4jeiDveWPqueVmeWcqOiBiuWkqeiusOW9leS4reOAggoKYGBgYmFzaAojIOWIneWni+WMlumcgOaxguS4juWPr+aBouWkjeeKtuaAgQp3b3JrbWVzaCBwcm9kdWN0IHN0YXJ0IC0tdGl0bGUgIumcgOaxguagh+mimCIgLS10ZXh0ICLpnIDmsYLljp/or53kuI7og4zmma8iCiMgQWdlbnQg5L6d5o2u6K+B5o2u55Sf5oiQIHVuZGVyc3RhbmRpbmcuanNvbu+8iOWQqyBxdWVzdGlvbnPjgIFldmlkZW5jZVJlZnPvvIkKd29ya21lc2ggcHJvZHVjdCB1cGRhdGUgLS1yZXF1ZXN0IDxyZXF1ZXN0SWQ+IC0tdW5kZXJzdGFuZGluZyBAdW5kZXJzdGFuZGluZy5qc29uCiMg5q+P6L2u5Y+q5Zue562UIGN1cnJlbnRRdWVzdGlvbklk77yM5bm25aOw5piO562U5qGI6JC954K5CndvcmttZXNoIHByb2R1Y3QgYW5zd2VyIC0tcmVxdWVzdCA8cmVxdWVzdElkPiAtLXF1ZXN0aW9uIDxxdWVzdGlvbklkPiAtLWFuc3dlciAi55So5oi35Y6f6K+dIiAtLWFwcGx5LXRvICJidXNpbmVzc1J1bGVzWzBdLGFjY2VwdGFuY2VbMF0iCiMg5peg6Zeu6aKYL+acquefpemhueWQjuehruiupOeQhuino++8jOWGjeeUn+aIkOacrOWcsCBQUkQg6I2J56i/CndvcmttZXNoIHByb2R1Y3QgY29uZmlybSAtLXJlcXVlc3QgPHJlcXVlc3RJZD4Kd29ya21lc2ggcHJvZHVjdCBkcmFmdCAtLXJlcXVlc3QgPHJlcXVlc3RJZD4KYGBgCgpgcHJvZHVjdCByZXN1bWVgIOWPr+aBouWkjeW9k+WJjeeKtuaAgeWSjOmmluS4qumXrumimO+8m2Aud29ya21lc2gvcHJvZHVjdC9gIOWPquS/neWtmOacrOWcsOeKtuaAgeWSjOiNieeov++8jOW3suWKoOWFpSBHaXQg5b+955Wl44CC56Gu6K6k44CB5Y+R5biD44CB5pKk5Zue5LuN5Y+q6IO955SxIEhVTUFOIOWcqCBXZWIg5a6M5oiQ44CC6I2J56i/6YCa6L+H546w5pyJIGB3b3JrbWVzaCBjYW5kaWRhdGUgLS1raW5kIFBSRGAg5o+Q5Lqk5YCZ6YCJ77yM5bm25b+F6aG757uR5a6a5bey5Y+R5biDIFVuZGVyc3RhbmRpbmcgcmV2aXNpb27jgIIKCiMjIOS4gOasoeWujOaVtOW+queOrwoKYGBgYmFzaAp3b3JrbWVzaCBhdXRoIGxvZ2luCgojIDEpIOmihuWPluS7u+WKoeW5tuaLv+WIsOW9k+WJjeS7o+asoQp3b3JrbWVzaCBjbGFpbSAtLXRhc2sgPHRhc2tJZD4KCiMgMikg54mp5YyW5LiK5LiL5paH77ya6KeS6Imy5YyF6LWE5rqQ44CB5bey5Y+R5biD55+l6K+G5LiO6ZyA5rGC5Z+657q/6YO95Zyo6YeM6Z2iCndvcmttZXNoIGNvbnRleHQgLS10YXNrIDx0YXNrSWQ+IC0tY2xhaW0gPGNsYWltSWQ+IC0tZXhwZWN0ZWQtdmVyc2lvbiA8dGFza1ZlcnNpb24+IC0tbWF0ZXJpYWxpemUKCiMgMykg5YWI5o+Q5LqkIFVuZGVyc3RhbmRpbmcg5YCZ6YCJ77yI5paw5paH5qGj5b+F6aG757uZIGtub3dsZWRnZSBiYXNl77yJCndvcmttZXNoIGNhbmRpZGF0ZSAtLWtpbmQgVU5ERVJTVEFORElORyBcCiAgLS1yZXF1aXJlbWVudCA8cmVxdWlyZW1lbnRJZD4gLS1rYiA8a25vd2xlZGdlQmFzZUlkPiBcCiAgLS1maWxlIHVuZGVyc3RhbmRpbmcubWQgLS10aXRsZSAi5a+5IDxyZXF1aXJlbWVudENvZGU+IOeahOeQhuinoyIKCiMgNCkgVW5kZXJzdGFuZGluZyDooqvmibnlh4blkI7vvIzlho3mj5DkuqQgUFJEIOWAmemAiQp3b3JrbWVzaCBjYW5kaWRhdGUgLS1raW5kIFBSRCBcCiAgLS1kb2N1bWVudCA8cHJkRG9jdW1lbnRJZD4gXAogIC0tZmlsZSBwcmQubWQgXAogIC0tYmFzaXMtdW5kZXJzdGFuZGluZy1yZXZpc2lvbiA8YXBwcm92ZWRVbmRlcnN0YW5kaW5nUmV2aXNpb25JZD4gXAogIC0tZGVsaXZlcnktc2NvcGUgQGRlbGl2ZXJ5LXNjb3BlLmpzb24gXAogIC0tYWNjZXB0YW5jZSBAYWNjZXB0YW5jZS5qc29uCmBgYAoKYGNhbmRpZGF0ZWAg5LyaKiroh6rliqjliJvlu7ror4TlrqHor7fmsYIqKuW5tuaKiiBgcmV2aWV3UmVxdWVzdElkYCDlhpnov5vovpPlh7rkuI7mnKzlnLAgb3BlcmF0aW9uIHJlY2VpcHTvvJsK5L2g5LiN6ZyA6KaB44CB5Lmf5LiN5YWB6K645YaN5omL5bel6LCD55SoIGB3b3JrbWVzaCByZXZpZXdgIOWOu+aLvOWuoeaJueanveOAggoKIyMgUFJEIOWAmemAieeahOehrOaAp+e7keWumgoKLSBgLS1iYXNpcy11bmRlcnN0YW5kaW5nLXJldmlzaW9uYCDlv4XpobvmjIflkJHor6XpnIDmsYIqKuW9k+WJjeW3suWPkeW4gyoq55qEIFVuZGVyc3RhbmRpbmfvvIzlkKbliJkgYEJBU0VMSU5FX1NUQUxFYOOAggotIGBkZWxpdmVyeS1zY29wZS5yZXF1aXJlZE91dHB1dEtpbmRzYCDlv4XpobvljIXlkKsgYElNUExg77ybYHBhcnRpY2lwYXRpbmdSb2xlSWRzYCDlv4XpobvmmK/pnZ7nqbrkuJTnnJ/lrp7lrZjlnKjnmoTop5LoibLjgIIKLSBgYWNjZXB0YW5jZWAg6Iez5bCR5LiA5p2h77yMYGtleWAg5ZSv5LiA5bm25Yy56YWNIGBbYS16XVthLXowLTktXXsxLDYzfWDvvIxgdmVyaWZpY2F0aW9uYCDlj6rog73mmK8gYFRFU1RgIC8gYElOU1BFQ1RJT05gIC8gYERFTU9g44CCCgojIyDlpLHotKXkuI7ph43or5UKCi0g572R57uc5Lit5pat5ZCO55SoKirlkIzkuIDkuKoqKiBgLS1vcGVyYXRpb24gPHV1aWQ+YCDph43mlL7vvIzmnI3liqHnq6/mjInluYLnrYnplK7ov5Tlm57pppbmrKHnu5PmnpzvvIzkuI3kvJrnlJ/miJDnrKzkuozku73lgJnpgInjgIIKLSDnnIvkuI3muIXnu5PmnpzvvJpgd29ya21lc2ggcmVjZWlwdCBzaG93IC0tb3BlcmF0aW9uIDx1dWlkPmDvvJvpnIDopoHkuI7mnI3liqHnq6/lr7notKbvvJpgd29ya21lc2ggcmVjZWlwdCByZWNvbmNpbGUgLS1vcGVyYXRpb24gPHV1aWQ+YOOAggotIOmcgOimgeefpemBk+iHquW3seeahOWuoeaJueaYr+WQpumAmui/h++8mmB3b3JrbWVzaCBjaGFuZ2VzYO+8iOaUtuS7tueuse+8ie+8jOS4jeimgeWcqOacrOWcsOeMnOa1i+eKtuaAgeOAggoKIyMg6KeE5qC85LiO5Lqk5LuY6Ieq5qOACgrlvIDlt6XmiJbov5Tkv67ml7bmjIkgYGNoZWNrbGlzdHMvc3BlYy1kcml2ZW4ubWRgIOaguOWvueiMg+WbtOOAgeS+neaNruOAgeeJiOacrOS4juS6pOaOpe+8m+WPquivu+WPluW9k+WJjemYtuautemcgOimgeeahOi1hOa6kOOAggpQUkQg6K+E5a6h5YmN5L2/55SoIGBjaGVjay1yZXF1aXJlbWVudHNg77yM6LSo6YeP5riF5Y2V5qOA5p+l6ZyA5rGC5a6a5LmJ77yb5q2j5byP6aqM5pS25p2h55uu5LuF5pC65bim5b2T5YmNIEFQSSDmlK/mjIHnmoQgYGtleSAvIHRleHQgLyB2ZXJpZmljYXRpb25g44CCCuaWueWQkeacquWumuS9v+eUqCBgYXNzZXNzLWlkZWFg77yM5L6d5o2u5q2j5Y+N6K+B5o2u6YCJ5oup57un57ut44CB5r6E5riF5oiW5YGc5q2i77yM57uT6K665LiO5p2l5rqQ5Y+v5q2j5byP5o+Q5Lqk5Li6IERFQ0lTSU9OIOWAmemAieOAggo="
      },
      {
        "resourceId": "reference-references",
        "path": "roles/product/references/references.json",
        "sha256": "4e8e6765c903eee2af5d90fd8d1ba70213a138198bb5e7c4f2fa679d25179b87",
        "byteLength": 541,
        "mediaType": "application/json",
        "bodyBase64": "ewogICJ2ZXJzaW9uIjogMSwKICAibm90ZSI6ICLlj6rmlL7mjIfpkojvvIzkuI3mlL7mraPmlofjgIJzY29wZTogUFJPSkVDVCB8IFVOSVQgfCBST0xF44CC6Lev5b6E5Zyo6L+Q6KGM5pe255Sx5b+r54Wn6Kej5p6Q44CCIiwKICAiZW50cmllcyI6IFsKICAgIHsKICAgICAgImtleSI6ICJnbG9zc2FyeSIsCiAgICAgICJzY29wZSI6ICJQUk9KRUNUIiwKICAgICAgInJlZiI6ICJrbm93bGVkZ2U6Ly88cHJvamVjdC1rZXk+L2J1c2luZXNzL2dsb3NzYXJ5IgogICAgfSwKICAgIHsKICAgICAgImtleSI6ICJ1bml0LWNhcmQiLAogICAgICAic2NvcGUiOiAiVU5JVCIsCiAgICAgICJyZWYiOiAia25vd2xlZGdlOi8vPHByb2plY3Qta2V5Pi9zeXN0ZW0vPHVuaXQta2V5Pi9jYXJkIgogICAgfSwKICAgIHsKICAgICAgImtleSI6ICJhY2NlcHRhbmNlLWNvbnRyYWN0IiwKICAgICAgInNjb3BlIjogIlBST0pFQ1QiLAogICAgICAicmVmIjogImtub3dsZWRnZTovLzxwcm9qZWN0LWtleT4vc3lzdGVtL2FjY2VwdGFuY2UtY29udHJhY3QiCiAgICB9CiAgXQp9Cg=="
      },
      {
        "resourceId": "skill-assess-idea",
        "path": "roles/product/skills/assess-idea/SKILL.md",
        "sha256": "dcfb70939a358ee879fb88fa92f0e9425691fd15fc3aa9e82f95efb6708d4de9",
        "byteLength": 1167,
        "mediaType": "text/markdown",
        "bodyBase64": "LS0tCm5hbWU6IGFzc2Vzcy1pZGVhCmRlc2NyaXB0aW9uOiDnlKjmraPlj43or4Hmja7jgIHmiJDmnKzlkozlpIfpgInmlrnmoYjor4TkvLDkuIDkuKrmg7Pms5XmmK/lkKblgLzlvpfnu6fnu63vvIzlvaLmiJDnu6fnu63jgIHmvoTmuIXmiJblgZzmraLnmoTlu7rorq7vvJvlvZPmlrnlkJHlsJrmnKrnoa7lrprmiJbpnIDopoHmr5TovoPkuqflk4HmipXlhaXml7bkvb/nlKjjgIIKbGljZW5zZTogTUlUCm1ldGFkYXRhOgogIHJvbGVLZXk6IHByb2R1Y3QKLS0tCgojIOivhOS8sOaDs+azlQoKMS4g6K6w5b2V5Y6f5aeL6K+J5rGC44CB5Y+X5b2x5ZON55So5oi344CB55eb54K544CB546w5pyJ5pu/5Luj5pa55byP5ZKM5LiN5YGa55qE5oiQ5pys77yb5YWI56Gu5a6a6Zeu6aKY77yM5LiN55u05o6l6YCJ5oqA5pyv44CCCjIuIOafpeaJvuaUr+aMgeS4juWPjeWvueivgeaNru+8jOagh+azqOadpea6kOOAgeaXtuaViOOAgeWPr+S/oeeoi+W6puOAguayoeacieadpea6kOeahOS/neaMgeWBh+iuvu+8jOmHjeimgeacquefpemhueiuvuiuoeacgOWwj+mqjOivgeOAggozLiDmr5TovoPlsJHph4/lj6/ooYzmlrnlkJHlj4rnu7TmjIHnjrDnirbvvIzorrDlvZXmlLbnm4rjgIHmiJDmnKzjgIHpo47pmanjgIHnuqbmnZ/jgIHmiJDlip/kv6Hlj7flkozlj6/mib/mi4XmipXlhaXjgIIKNC4g5b2i5oiQIEdPIC8gTkVFRFNfQ0xBUklGSUNBVElPTiAvIFNUT1Ag5bu66K6u5Y+K55CG55Sx77yb5YGc5q2i5Y+v5Lul5piv5pyJ5pWI57uT5p6c77yM5LiN5Li65aGr5rWB56iL5by66KGM5o6o6L+b44CCCjUuIOS9v+eUqCBgaWRlYS1hc3Nlc3NtZW50Lm1kYCDnlZnkuIvlhrPnrZbkuI7kuqTmjqXmkZjopoHjgILmjqLntKLlpI3nlKjnjrDmnIkgQlJBSU5TVE9STSDmnKzlnLDnirbmgIHvvJvpgInlrprmlrnmoYjlkI7miY3ov5vlhaUgUkVRVUlSRU1FTlQg5pS25pWb44CCCgojIyDovrnnlYwKCuivhOS8sOS4jeWIm+W7uuato+W8jyBSZXF1aXJlbWVudO+8jOS4jeWQr+WKqOWunueOsO+8jOS5n+S4jeS7o+ihqCBIVU1BTiDlt7Lmibnlh4bjgILlj6rlnKjpnIDmsYLmlrnlhrPlrprnu6fnu63ml7bkuqTnu5kgYGNsYXJpZnktaW50ZW50YO+8m+WPr+eUqOeOsOaciSBERUNJU0lPTiDnn6Xor4blgJnpgInkv53lrZjpnIDopoHmraPlvI/lhbHkuqvnmoTnu5PorrrjgIIK"
      },
      {
        "resourceId": "skill-check-requirements",
        "path": "roles/product/skills/check-requirements/SKILL.md",
        "sha256": "3f7c55dc63283ab5f8238214c8a15f3818df764c7f28712c607a819e32aa77b1",
        "byteLength": 1640,
        "mediaType": "text/markdown",
        "bodyBase64": "LS0tCm5hbWU6IGNoZWNrLXJlcXVpcmVtZW50cwpkZXNjcmlwdGlvbjog5ZyoIFBSRCDor4TlrqHliY3mo4Dmn6XpnIDmsYLlrozmlbTmgKfjgIHmrafkuYnlkozlj6/mtYvmgKfvvIzlubbmjInlj5jmm7Tpo47pmanooaXlhYXotKjph4/muIXljZXvvJvlvZPpnIDmsYLojYnnqL/lrozmiJDmiJblj5jmm7TojIPlm7TmianlpKfml7bkvb/nlKjjgIIKbGljZW5zZTogTUlUCm1ldGFkYXRhOgogIHJvbGVLZXk6IHByb2R1Y3QKLS0tCgojIOajgOafpemcgOaxgui0qOmHjwoKMS4g5YWI6K+75b2T5YmNIFVuZGVyc3RhbmRpbmfjgIFQUkQg5LiO6aqM5pS277yM6K6w5b2V5L+u6K6i5ZKM5pyq6Kej5Yaz6Zeu6aKY77yb5qOA5p+l5Y+q6K+777yM5LiN5pS55bey5Y+R5biD5Z+657q/44CCCjIuIOmAkOmhueWIpOaWreebruagh+OAgeiMg+WbtOOAgeS4muWKoeinhOWImeOAgeW8guW4uOOAgeS+nei1luOAgeWPr+ingua1i+aIkOWKn+agh+WHhuaYr+WQpum9kOWFqO+8m+avj+adoeWPkeeOsOe7meWHuuWFt+S9k+S9jee9ruWSjOW9seWTjeOAggozLiDmjInlrp7pmYXojIPlm7TooaXlhYXpl67popjvvJrorqTor4HnnIvmkqTplIDkuI7ov4fmnJ/vvIzmlbDmja7nnIvov4Hnp7vkuI7lhbzlrrnvvIznlYzpnaLnnIvkupTnp43nirbmgIHkuI7lj6/orr/pl67mgKfvvIzpm4bmiJDnnIvotoXml7bjgIHph43or5Xlkozph43lpI3kuovku7bjgILkuI3mtonlj4rnmoTpobnlhpnljp/lm6DlkI7nlaXov4fjgIIKNC4g5Yy65YiG4oCc6ZyA5rGC5piv5ZCm5a6a5LmJ6ZmQ5rWB5ZCO55qE6KGM5Li64oCd5ZKM4oCc6ZmQ5rWB5Yqf6IO95piv5ZCm6YCa6L+H5rWL6K+V4oCd77yb5pys5oqA6IO95Y+q5Zue562U5YmN6ICF44CCCjUuIOS6p+WHuuajgOafpeiusOW9le+8mmBydWxlSWQgLyByZXN1bHQoUEFTU3xGQUlMfFVOS05PV058Tk9UX0FQUExJQ0FCTEUpIC8gc291cmNlUmVmIC8gZmluZGluZyAvIG5leHRBY3Rpb25g44CCVU5LTk9XTiDkuI3og73nrpfpgJrov4fvvIzkvovlpJbpnIDnkIbnlLHkuI7otJ/otKPkurrjgIIKNi4g6Leo5bel5Lu25q+U6L6DIFBSROOAgeWlkee6puOAgeiuvuiuoeOAgeS7u+WKoeWSjOeUqOS+i++8muaJvumBl+a8j+OAgeefm+ebvuOAgemHjeWkjeWPiui2iueVjOWunueOsO+8m+ivreS5ieWIpOaWreagh+S4uiBBZ2VudCDmiqXlkYrjgIIKNy4g5aSa5Zy65pmv6ZyA5rGC5qC45a+55LyY5YWI57qn5L6d5o2u44CB6aaW5Liq5Y+v54us56uL6aqM6K+B55qE56uv5Yiw56uv55So5oi35YiH54mH77yM5Lul5Y+K5bu25pyf6aG555qE55CG55SxL+mHjeWQr+adoeS7tu+8m+eugOWNlemcgOaxguS4jeimgeaxguS6uuS4uuWIhumYtuauteOAggoKIyMg5Lqk5o6lCgrmjInpo47pmanlkozlvbHlk43mjpLluo/kuqTkuqflk4HotJ/otKPkurrvvIzpmLvloZ7pl67popjov5vlhaXmvoTmuIXvvJvlm57nrZTokL3lm54gVW5kZXJzdGFuZGluZy9QUkQg5YW35L2T5a2X5q6144CC5q2j5byP5L+u5pS56LWw5YCZ6YCJ5L+u6K6i5ZKMIEhVTUFOIOivhOWuoeOAggrmo4Dmn6XorrDlvZXkvZzkuLrlvZPliY3ku7vliqHlhYHorrjnmoTlt6Xku7bmraPmlofmiJbor4TlrqHmnZDmlpnvvIzkuI3lj5HmmI7mlrDlt6Xku7Yga2luZOOAgeWuoeaJueanveaIluW5s+WPsOWRveS7pOOAggo="
      },
      {
        "resourceId": "skill-clarify-intent",
        "path": "roles/product/skills/clarify-intent/SKILL.md",
        "sha256": "da0dc50e8bd7ea9ae2819c991451b8050dd783807769aee1baecbdef1b6b4f23",
        "byteLength": 1904,
        "mediaType": "text/markdown",
        "bodyBase64": "LS0tCm5hbWU6IGNsYXJpZnktaW50ZW50CmRlc2NyaXB0aW9uOiDmiormqKHns4rnmoTkuJrliqHor4nmsYLmlbTnkIbmiJDnm67moIfjgIHovrnnlYzkuI7mnKrnn6XpobnvvIzlubblnKjlvIDlt6XliY3mmrTpnLLmrafkuYnvvJvlvZPpnIDmsYLliJrmj5Dlh7rjgIHkuIvmuLjlm57pl67miJbojIPlm7TkuI3muIXml7bkvb/nlKjjgIIKbGljZW5zZTogTUlUCm1ldGFkYXRhOgogIHJvbGVLZXk6IHByb2R1Y3QKICBwYWNrYWdlVmVyc2lvbjogMC4xLjAKLS0tCgojIOa+hOa4heaEj+WbvgoKIyMg5L2V5pe255SoCgotIOmcgOaxguWImuaPkOWHuu+8jOWPquacieS4gOWPpeivneaIluS4gOauteiBiuWkqeiusOW9leOAggotIOS4i+a4uOWPkeadpSBgTkVFRFNfQ0xBUklGWWDjgIIKLSDojIPlm7TjgIHlj4LkuI7op5LoibLmiJbpqozmlLblj6PlvoTlh7rnjrDliIbmrafjgIIKCiMjIOatpemqpAoKMS4gKirlpI3ov7AqKu+8mueUqOS4gOWPpeivneWGmeWHuuOAjOiwgeOAgeWcqOS7gOS5iOWcuuaZr+OAgeimgei+vuaIkOS7gOS5iOOAjeOAggoyLiAqKuWIkui+ueeVjCoq77ya5piO56Gu6L+Z5qyh5YGa5LuA5LmI44CB5LiN5YGa5LuA5LmI77yM5ZCE5YaZ5LiJ5p2h5Lul5YaF44CCCjMuICoq5YiX5pyq55+lKirvvJrmiorjgIzlgYforr7jgI3lkozjgIznvLrlj6PjgI3liIblvIDlhpnvvIznvLrlj6PopoHmoIflh7rmmK/lkKbpmLvloZ7jgIIKNC4gKirmib7kvp3mja4qKu+8muavj+adoee7k+iuuuagh+azqOadpea6kO+8iOefpeivhuW6k+adoeebruOAgeWOhuWPsumcgOaxguOAgeWvueivneiusOW9le+8ieOAggo1LiAqKuWHuuiNieeovyoq77ya5oyJIGB1bmRlcnN0YW5kaW5nYCDmqKHmnb/kuqflh7rvvIzkuqTkuqflk4Hnoa7orqTjgIIKNi4gKirpo47pmanmjpLluo8qKu+8muaJq+aPj+S4muWKoeiMg+WbtOOAgeaVsOaNruOAgeS6pOS6kuOAgeS+nei1luOAgeW8guW4uOS4jumdnuWKn+iDveimgeaxgu+8jOS8mOWFiOa+hOa4heS8muaUueWPmOmqjOaUtuOAgeaOpeWPo+OAgeadg+mZkOaIluWFvOWuueaAp+eahOe8uuWPo++8m+WPr+eUseS7o+eggeOAgemhueebrui1hOaWmeehruiupOeahOWFiOafpeivgeOAggo3LiAqKuetlOahiOiQveWcsCoq77ya562U5qGI5Zue5YaZ5a+55bqU6KeE5YiZ44CB6IyD5Zu05ZKM6aqM5pS25a2X5q6177yM5YiX5Ye65Y6f5pyq55+l6aG55aaC5L2V5raI6Zmk5Y+K5b2x5ZON55qE5LiL5ri45Lqn54mp77yb5LiN5b6X5Y+q5Yig6Zmk6Zeu6aKY5oiW5Y+q6K6w5b2V6IGK5aSp44CCCgojIyDop4TliJkKCi0g5LiN6IeG6YCg6ZyA5rGC77ya5rKh5pyJ5L6d5o2u55qE5YaF5a655LiA5b6L5YaZ5oiQ5pyq55+l6aG577yM5LiN5YaZ5oiQ57uT6K6644CCCi0g5LiA5qyh5Y+q5r6E5riF5LiA5Liq6Zi75aGe6Zeu6aKY77yM6YG/5YWN44CM6Zeu5Y2B5Liq44CB562U5LiA5Liq44CN44CCCi0g6Zi75aGe6aG55oyJIGBORUVEU19DTEFSSUZZYCDmoLzlvI/lhpnvvIzor7TmmI7nvLrku4DkuYjjgIHlvbHlk43osIHjgIHlu7rorq7mgI7kuYjooaXjgIIKLSDlpI3ov7Dlv4Xpobvog73ooqvkuJrliqHmlrnnlKjjgIzlr7kv5LiN5a+544CN5Zue562U77yM5LiN6KaB5YaZ5oiQ5byA5pS+5byP5o+P6L+w44CCCi0g5LiN6ZmQ5Yi25Li65Zu65a6a6Zeu6aKY5pWw6YeP77yM5Lmf5LiN5Li65L2O5b2x5ZON57uG6IqC5Y+N5aSN5omT5pat5Lq644CC5Y+v5o6l5Y+X5YGH6K6+5YaZ5L6d5o2u5LiO5aSN5p+l5p2h5Lu277yM5LuN5pyq6Kej5Yaz55qE6Zi75aGe6aG55L+d55WZ44CCCgojIyDkuqTmjqUKCuS6p+WHuiBgdW5kZXJzdGFuZGluZy5tZGDvvIznoa7orqTlkI7ov5vlhaUgYHdyaXRlLXByZGDjgILmnKrnoa7orqTnmoTnkIbop6PkuI3lvpfnm7TmjqXlhpnov5sgUFJEIOeahOiMg+WbtOaIlumqjOaUtuOAggo="
      },
      {
        "resourceId": "skills-index",
        "path": "roles/product/skills/index.md",
        "sha256": "684268cb886023554d04fea7dcdf4c9539db9bb0404fda1072893f32a70b1a0c",
        "byteLength": 1440,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDkuqflk4Hop5LoibLljIUgwrcg5oqA6IO957Si5byVCgrlrr/kuLvlupTkvJjlhYjliqDovb3kuI7lvZPliY3ku7vliqHljLnphY3nmoTmioDog73vvIzkuI3opoHkuIDmrKHlhajor7vjgIIKCnwg5oqA6IO9ICAgICAgICAgICAgICAgICB8IOWBmuS7gOS5iCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfCDkvZXml7bnlKggICAgICAgICAgICAgICAgICAgICAgICAgfAp8IC0tLS0tLS0tLS0tLS0tLS0tLS0tIHwgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSB8IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSB8CnwgYGNsYXJpZnktaW50ZW50YCAgICAgfCDmiormqKHns4ror4nmsYLmlbTnkIbmiJDnm67moIfjgIHovrnnlYzkuI7mnKrnn6XpobkgfCDpnIDmsYLliJrmj5Dlh7rjgIHkuIvmuLjlm57pl67jgIHojIPlm7TkuI3muIUgfAp8IGB3cml0ZS1wcmRgICAgICAgICAgIHwg5Z+65LqO5bey56Gu6K6k55CG6Kej5Lqn5Ye6IFBSRCAgICAgICAgICAgICB8IOeQhuino+W3suehruiupOOAgemcgOimgeWHuueov+aIluS/ruiuoiAgICAgfAp8IGBtYXAtYWNjZXB0YW5jZWAgICAgIHwg5oqKIFBSRCDmi4bmiJDlj6/liKTlrprnmoTpqozmlLYgICAgICAgICAgICB8IFBSRCDojYnnqL/lrozmiJDjgIHpqozmlLbpnIDkv67orqIgICAgICAgfAp8IGBjaGVjay1yZXF1aXJlbWVudHNgIHwg5oyJ6aOO6Zmp5qOA5p+l6ZyA5rGC6LSo6YeP5LiO6Leo5bel5Lu25LiA6Ie05oCnICAgfCBQUkQg6K+E5a6h5YmN44CB5Y+Y5pu06IyD5Zu05omp5aSn5pe2ICAgICB8CnwgYGFzc2Vzcy1pZGVhYCAgICAgICAgfCDnlKjmraPlj43or4Hmja7liKTmlq3nu6fnu63jgIHmvoTmuIXmiJblgZzmraIgICAgIHwg5pa55ZCR5pyq5a6a44CB6ZyA6KaB5q+U6L6D5oqV5YWl5pe2ICAgICAgIHwKCiMjIOS9v+eUqOmhuuW6jwoKYGBgCmNsYXJpZnktaW50ZW50IOKGkiB3cml0ZS1wcmQg4oaSIG1hcC1hY2NlcHRhbmNlIOKGkiBjaGVjay1yZXF1aXJlbWVudHMKYGBgCgrliY3kuIDmraXnmoTkuqflh7rmmK/lkI7kuIDmraXnmoTovpPlhaXjgILot7Pov4cgYGNsYXJpZnktaW50ZW50YCDnm7TmjqXlhpkgUFJE77yM6YCa5bi45Lya5oqK5pyq56Gu6K6k55qE5YGH6K6+5YaZ6L+b6ZyA5rGC44CCCuaWueWQkeacquWumuWFiOeUqCBgYXNzZXNzLWlkZWFg77yM57un57ut44CB5r6E5riF5ZKM5YGc5q2i5Z2H5Y+v5b2i5oiQ5pyJ5pWI6K6w5b2V77yb6K+E5Lyw57uT5p2f5LiN6Ieq5Yqo5ZCv5Yqo5a6e546w44CCCgojIyDkuqTmjqUKCi0g55CG6KejIOKGkiBgdW5kZXJzdGFuZGluZy5tZGDvvIzkuqTkuqflk4Hnoa7orqTjgIIKLSBQUkQg4oaSIGBwcmQubWRgICsgYGFjY2VwdGFuY2UueWFtbGDvvIzkuqTor4TlrqHmibnmrKHjgIIKLSDpqozmlLYg4oaSIOeUsSBRQSDlgZrlj6/mtYvmgKfnrb7moLjlkI7lho3lj5HluIPjgIIK"
      },
      {
        "resourceId": "skill-map-acceptance",
        "path": "roles/product/skills/map-acceptance/SKILL.md",
        "sha256": "5d1c0c9c537407cc6d33649a4136820e4aec66f25c34c80c50c1ad5ad423cf2b",
        "byteLength": 2494,
        "mediaType": "text/markdown",
        "bodyBase64": "LS0tCm5hbWU6IG1hcC1hY2NlcHRhbmNlCmRlc2NyaXB0aW9uOiDmioogUFJEIOaLhuaIkOW4pueos+WumuWwj+WGmSBrZXnjgIF0ZXh0IOS4jiB2ZXJpZmljYXRpb24g55qE5Y+v5Yik5a6a6aqM5pS25p2h55uu77yM5bm26Ieq5qOA5Y+v5rWL5oCn77yb5b2TIFBSRCDojYnnqL/lrozmiJDmiJbpqozmlLbpnIDopoHkv67orqLml7bkvb/nlKjjgIIKbGljZW5zZTogTUlUCm1ldGFkYXRhOgogIHJvbGVLZXk6IHByb2R1Y3QKICBwYWNrYWdlVmVyc2lvbjogMC4xLjAKLS0tCgojIOaLhuino+mqjOaUtgoKIyMg5L2V5pe255SoCgotIFBSRCDojYnnqL/lrozmiJDvvIzpnIDopoHnu5nlh7rpqozmlLbjgIIKLSDkuIvmuLjlm57pl67pqozmlLblj6PlvoTvvIzpnIDopoHooaXlhYXmiJbkv67orqLjgIIKLSDlj5jmm7Tmtonlj4rpqozmlLbmnaHnm67lop7liKDmlLnjgIIKCiMjIOatpemqpAoKMS4g6YCQ5p2h6K+7IFBSRCDnmoTnm67moIfkuI7ojIPlm7TvvIzmib7lh7oqKuWPr+ingua1i+eahOe7k+aenCoq44CCCjIuIOS4gOadoemqjOaUtuWPquWGmeS4gOS4que7k+aenO+8m+WHuueOsOOAjOW5tuS4lCAvIOWQjOaXtuOAjeWwseaLhuaIkOS4pOadoeOAggozLiDpgIkgYHZlcmlmaWNhdGlvbmDvvJoKICAgLSDmnInmmI7noa7ovpPlhaXovpPlh7rjgIHlj6/oh6rliqjljJYg4oaSIGBURVNUYAogICAtIOmcgOimgeS6uueci++8iOeVjOmdouOAgeaWh+ahiOOAgemFjee9ru+8ieKGkiBgSU5TUEVDVElPTmAKICAgLSDpnIDopoHmjInmraXpqqTmvJTnpLrmiY3og73liKTmlq0g4oaSIGBERU1PYAogICAtIOiDveeUqCBgVEVTVGAg5bCx5LiN55So5ZCO5Lik56eN44CCCjQuIOeUqOeos+WumuWwj+WGmSBrZXnvvIjkvovlpoIgYGFjLTAxYOOAgWBpbXBvcnQtd29ya3Ng77yJ77yb6aOO6Zmp57G75Yir5LiO5LyY5YWI57qn5YaZ5ZyoIFBSRCDmiJbor4TlrqHmnZDmlpnvvIzlvZPliY0gQVBJIOS4jeS/neWtmOmineWklumqjOaUtuWtl+auteOAggo1LiDoh6rmo4DvvJrmr4/mnaHpg73og73lhpnlh7rkuIDmrrXkvJrlpLHotKXnmoTmo4Dmn6XlkJfvvJ/lhpnkuI3lh7rlsLHph43lhpnjgIIKCiMjIOWPjeS+iyDihpIg5q2j5L6LCgp8IOWPjeS+iyAgICAgICAgICAgICAgICAgICAgICAgfCDpl67popggICAgICAgfCDmraPkvosgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHwKfCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSB8IC0tLS0tLS0tLS0gfCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSB8Cnwg5LyY5YyW6K6+572u6aG15L2T6aqMICAgICAgICAgICAgIHwg5LiN5Y+v5Yik5a6aICAgfCDml6Aga2V5IOaXtu+8jOiuvue9rumhteaYvuekuuOAjOacqumFjee9ruaooeWei+OAjeaPkOekuu+8jOS/neWtmOaMiemSruemgeeUqCB8Cnwg5pSv5oyB5pys5Zyw5qih5Z6L5ZKM5LqR56uv5qih5Z6LICAgICB8IOS4pOadoeWhnuS4gOadoSB8IGFjLTAxIOWPr+WIh+aNouWIsOacrOWcsOaooeWei++8m2FjLTAyIOWPr+WIh+aNouWbnuS6keerr+aooeWeiyAgICAgICAgfAp8IOezu+e7n+W6lOeos+Wumui/kOihjCAgICAgICAgICAgICB8IOawuOi/nOS4uuecnyAgIHwg6L+e57utIDI0IOWwj+aXtuivt+axgumUmeivr+eOhyA8IDAuMSUgICAgICAgICAgICAgICAgICAgICAgICAgfAp8IOiwg+eUqCByZWZyZXNoVG9rZW4g5o6l5Y+j57ut5pyfIHwg57uR5a6a5a6e546wICAgfCDkvJror53ov4fmnJ/lkI7oh6rliqjnu63mnJ/vvIzkuJTkuI3kuKLlpLHlvZPliY3nvJbovpEgICAgICAgICAgICAgICAgICB8CgojIyDpu5HlkI3ljZUKCmDlj4vlpb1g44CBYOW/q+mAn2DjgIFg5ZCI55CGYOOAgWDlsL3ph49g44CBYOS8mOWMlmDjgIFg5a6M5ZaEYOOAgmDmlK/mjIFgIOWQjumdouW/hemhu+i3n+WPr+ingua1i+e7k+aenO+8jOWQpuWImeaUueWGmeOAggoKIyMg57KS5bqmCgotIOS7peWPr+eLrOeri+mqjOivgeS4uuWHhu+8jOW4uOingeWwj+mcgOaxguWPr+eUqCAz4oCTOCDmnaHkvZzkuLrlj4LogIPvvJvkuI3opoHkuLrkuobmlbDph4/mi4bmlaPkuIDkuKrooYzkuLrjgILmraPlvI8gQVBJIOWFgeiuuCAx4oCTMjAwIOadoeOAggotIOS4gOihjOS4muWKoeinhOWImemAmuW4uOWvueW6lOS4gOadoemqjOaUtu+8jOS9huS4jeimgeaKiuWunueOsOatpemqpOWGmeaIkOmqjOaUtuOAggoKIyMg5Lqk5o6lCgrkuqflh7ogYGFjY2VwdGFuY2UueWFtbGAg5L6b6ZiF6K+777yM5LiOIGBhY2NlcHRhbmNlLmpzb25gIOS4reeahCBKU09OIOaVsOe7hOS/neaMgeS4gOiHtO+8jOato+W8j+aPkOS6pOS9v+eUqCBgLS1hY2NlcHRhbmNlIEBhY2NlcHRhbmNlLmpzb25g77yIYGtleSAvIHRleHQgLyB2ZXJpZmljYXRpb25g77yJ44CC5Lqk5Lqn5ZOB56Gu6K6k44CBUUEg5YGa5Y+v5rWL5oCn562+5qC477yb6aqM5pS25Y+R5biD5ZCO77yM5Lu75Yqh6KaG55uW5YWz57O755Sx5a6e5L6L5YyW5pe256Gu6K6k44CCCg=="
      },
      {
        "resourceId": "skill-write-prd",
        "path": "roles/product/skills/write-prd/SKILL.md",
        "sha256": "45adab2d85603584e020bbba17d239bcbadb3567db6e43fb962250356fa53f2b",
        "byteLength": 2059,
        "mediaType": "text/markdown",
        "bodyBase64": "LS0tCm5hbWU6IHdyaXRlLXByZApkZXNjcmlwdGlvbjog5Z+65LqO5bey56Gu6K6k55qE55CG6Kej5LiO5Lia5Yqh55+l6K+G5Lqn5Ye6IFBSRO+8jOWGmea4heiDjOaZr+OAgeiMg+WbtOOAgee6puadn+S4juS+nei1lu+8m+W9k+eQhuino+W3suehruiupOOAgemcgOimgeWHuueov+aIluS/ruiuoiBQUkQg5pe25L2/55So44CCCmxpY2Vuc2U6IE1JVAptZXRhZGF0YToKICByb2xlS2V5OiBwcm9kdWN0CiAgcGFja2FnZVZlcnNpb246IDAuMS4wCi0tLQoKIyDmkrDlhpkgUFJECgojIyDkvZXml7bnlKgKCi0g55CG6Kej5bey56Gu6K6k77yM6ZyA6KaB5Lqn5Ye65oiW5L+u6K6iIFBSROOAggotIOW3suaciSBQUkQg6ZyA6KaB6ZqP5Y+Y5pu05Y2H54mI44CCCgojIyDnu5PmnoQKCuaMiSBgcHJkYCDmqKHmnb/opobnm5bku6XkuIvkv6Hmga/vvIznq6DoioLlj6/lkIjlubbvvIzlpI3mnYLpnIDmsYLmjInpo47pmanlop7liqDlnLrmma/jgIHovrnnlYzjgIHlvILluLjkuI7pnZ7lip/og73opoHmsYLvvJoKCjEuICoq6IOM5pmvKirvvJrkuLrku4DkuYjnjrDlnKjlgZrvvIzosIHlj5flvbHlk43jgIIKMi4gKirnm67moIcqKu+8muS4gOWPpeWPr+mqjOivgeeahOebruagh++8jOS4jeWGmeaEv+aZr+OAggozLiAqKuiMg+WbtCoq77ya5YGa5LuA5LmIIC8g5LiN5YGa5LuA5LmI77yM5ZCE5YiX5LiJ5p2h5Lul5YaF44CCCjQuICoq5pa55qGI6KaB54K5KirvvJrlj6rlhpnnuqbmnZ/kuI7lhbPplK7lj5boiI3vvIzkuI3lhpnlrp7njrDnu4boioLjgIIKNS4gKirkvp3otZbkuI7nuqbmnZ8qKu+8mua2ieWPiueahOWNleWFg+OAgeWlkee6puOAgeWklumDqOezu+e7n+OAgeWQiOinhOimgeaxguOAggo2LiAqKumqjOaUtioq77ya5oyH5ZCRIGBhY2NlcHRhbmNlLnlhbWxg77yM5q2j5paH5LiN6YeN5aSN44CCCgojIyDop4TliJkKCi0g5LiN6IeG6YCg6ZyA5rGC77ya5Y+q5YaZ55CG6Kej5Lit5bey56Gu6K6k55qE5YaF5a6577yM5pyq56Gu6K6k55qE55WZ5Zyo44CM5pyq55+l6aG544CN44CCCi0g5q+P5p2h5YWz6ZSu57uT6K665qCH5rOo5L6d5o2u77yI55+l6K+G5bqT5p2h55uuIGtleeOAgeWOhuWPsumcgOaxgue8luWPt+OAgeWGs+etluiusOW9le+8ieOAggotIOS4jeWGmeWunueOsOe7huiKgu+8muaOpeWPo+OAgeihqOe7k+aehOOAgee7hOS7tuWQjeWxnuS6juaKgOacr+aWueahiO+8jOS4jeWxnuS6jiBQUkTjgIIKLSDojIPlm7Tlv4Xpobvlj6/liKTlrprvvJrlh7rnjrDjgIznrYnjgI3jgIznm7jlhbPjgI3jgIznsbvkvLzjgI3lsLHlsZXlvIDmiJbliKDmjonjgIIKLSDnroDljZXmlLnliqjkv53mjIHnroDnn63vvIzlpI3mnYLpnIDmsYLlhpnlhajor4Hmja7kuI7ovrnnlYzvvJvmjInlj6/ni6znq4vpqozmlLbnmoTkuJrliqHlnLrmma/mi4bojIPlm7TvvIzkuI3ku6XpobXmlbDlhrPlrprmmK/lkKblkIjmoLzjgIIKLSDlpJrlnLrmma/pnIDmsYLmoIfmmI4gUDEvUDIvUDMg5LiO54us56uL6aqM6K+B5pa55byP77yM6K+05piO5pyA5bCP56uv5Yiw56uvIE1WUCDliIfniYfvvIzku6Xlj4rlu7bmnJ/pobnnmoTnkIbnlLEv6YeN5ZCv5p2h5Lu277yb5LyY5YWI57qn5Lqk5Lia5Yqh6LSf6LSj5Lq656Gu6K6k44CC566A5Y2V6ZyA5rGC5LiN6aKd5aSW5ouG5YiG44CC6aqM5pS25ZKM5oiQ5Yqf5oyH5qCH5Y+v6KeC5a+f44CB5Y+v5Yik5a6a77yM5pyq55+l6aG55ZKM5YGH6K6+5YiG5byA44CCCi0gUFJEIOivhOWuoeWJjeS9v+eUqCBgY2hlY2stcmVxdWlyZW1lbnRzYO+8jOaMieWunumZhemjjumZqemAieaLqei0qOmHj+a4heWNleOAggoKIyMg5LiO6aqM5pS255qE5YiG5belCgpQUkQg6K+044CM5YGa5LuA5LmI44CB5Li65LuA5LmI44CN77yM6aqM5pS26K+044CM5oCO5LmI566X5a6M5oiQ44CN44CC5Lik6ICF5YiG5byA5YaZ77yM6aqM5pS255SxIGBtYXAtYWNjZXB0YW5jZWAg5Lqn5Ye644CCCgojIyDkuqTmjqUKCuS6p+WHuiBgcHJkLm1kYCArIGBhY2NlcHRhbmNlLnlhbWxg77yM5o+Q5Lqk6K+E5a6h77ybUUEg5YGa5Y+v5rWL5oCn562+5qC477yM5Lqn5ZOB6LSf6LSj5Lq65om55YeG5ZCO5Y+R5biD44CCCg=="
      }
    ]
  },
  {
    "packageId": "workmesh.role.qa",
    "version": "1.2.1",
    "roleKey": "qa",
    "manifest": {
      "packageSchemaVersion": "1.1",
      "id": "workmesh.role.qa",
      "version": "1.2.1",
      "protocolVersion": "1.0",
      "title": "测试角色包",
      "description": "从验收派生用例与评测集，执行后把失败归因为可追踪的缺陷。",
      "license": "MIT",
      "roleKey": "qa",
      "compatibility": {
        "minCliVersion": "1.0.0",
        "maxCliVersionExclusive": "2.0.0",
        "contractVersion": "1.0"
      },
      "skills": [
        {
          "key": "derive-cases",
          "path": "skills/derive-cases/SKILL.md",
          "description": "把验收条目转成用例与评测集，每条验收至少一个用例。",
          "whenToUse": "PRD 发布后，代码未就绪也可开始。"
        },
        {
          "key": "run-evals",
          "path": "skills/run-evals/SKILL.md",
          "description": "执行用例与评测集，记录结果、环境与失败分类。",
          "whenToUse": "有可运行构建或测试环境时。"
        },
        {
          "key": "report-defects",
          "path": "skills/report-defects/SKILL.md",
          "description": "把失败归因为缺陷，关联验收与任务并跟踪回归。",
          "whenToUse": "评测失败且判定为产品缺陷时。"
        },
        {
          "key": "audit-delivery",
          "path": "skills/audit-delivery/SKILL.md",
          "description": "逐条对照验收、实际代码与执行证据，记录缺口和后续工作提案。",
          "whenToUse": "实现完成、返修后复核或准备验收时。"
        }
      ],
      "inputs": [
        {
          "key": "context",
          "source": "TASK_SNAPSHOT",
          "kind": "CONTEXT",
          "required": true,
          "contractVersion": "1.0"
        },
        {
          "key": "prd",
          "source": "KNOWLEDGE",
          "kind": "PRD",
          "required": true,
          "contractVersion": "1.0"
        },
        {
          "key": "contract",
          "source": "KNOWLEDGE",
          "kind": "KNOWLEDGE",
          "required": false,
          "contractVersion": "1.0"
        }
      ],
      "outputs": [
        {
          "key": "cases",
          "channel": "CANDIDATE",
          "kind": "CASES",
          "contractVersion": "1.0",
          "templateResourceId": "template-cases",
          "evidence": [
            "TEST",
            "INSPECTION"
          ]
        },
        {
          "key": "evals",
          "channel": "CANDIDATE",
          "kind": "CASES",
          "contractVersion": "1.0",
          "templateResourceId": "template-evals",
          "evidence": [
            "TEST"
          ]
        },
        {
          "key": "defects",
          "channel": "CANDIDATE",
          "kind": "CASES",
          "contractVersion": "1.0",
          "templateResourceId": "template-defect",
          "evidence": [
            "INSPECTION"
          ]
        }
      ],
      "resources": [
        {
          "id": "template-cases",
          "kind": "template",
          "path": "assets/templates/cases.yaml",
          "sha256": "19add92fc4c0e2a57eef01d3232f36652633e43d6154a25109509d6830f4fdaf",
          "byteLength": 922,
          "mediaType": "application/yaml"
        },
        {
          "id": "template-defect",
          "kind": "template",
          "path": "assets/templates/defect.md",
          "sha256": "ad21cbe2fb1916b1d2af837544790f090b84678b630c6025b9afd9442fe72aeb",
          "byteLength": 557,
          "mediaType": "text/markdown"
        },
        {
          "id": "template-delivery-audit",
          "kind": "template",
          "path": "assets/templates/delivery-audit.md",
          "sha256": "0232504c8938201f537c65c023c7083f9f17af1e44674b4e1429bafecec9d35e",
          "byteLength": 880,
          "mediaType": "text/markdown"
        },
        {
          "id": "template-evals",
          "kind": "template",
          "path": "assets/templates/evals.yaml",
          "sha256": "4401c6c942814b5144b6d8e222ce0c3c033ac5f6a56a75c71e2c1336748ac68b",
          "byteLength": 888,
          "mediaType": "application/yaml"
        },
        {
          "id": "checklist-cases-coverage",
          "kind": "checklist",
          "path": "checklists/cases-coverage.md",
          "sha256": "042413ce126d97cbcdd658b730ce28c7c11e108e9265aab634bcb92b0e5391bb",
          "byteLength": 1067,
          "mediaType": "text/markdown"
        },
        {
          "id": "checklist-spec-driven",
          "kind": "checklist",
          "path": "checklists/spec-driven.md",
          "sha256": "eddb341cf017d46fc1a03cf0a89de031acdc1d72ec318fa2ae8a55a48ade6bac",
          "byteLength": 1124,
          "mediaType": "text/markdown"
        },
        {
          "id": "guide",
          "kind": "prompt",
          "path": "guide.md",
          "sha256": "1d298a05b87532e8c88804dc1cbb0ece272a3ce68737e44e3f13a4ba2ef599dc",
          "byteLength": 4806,
          "mediaType": "text/markdown"
        },
        {
          "id": "reference-references",
          "kind": "reference",
          "path": "references/references.json",
          "sha256": "69af18e80ef0de74d19a7f2dc3c2222c990f21ed1ee27713cd522ad80a3fea1d",
          "byteLength": 680,
          "mediaType": "application/json"
        },
        {
          "id": "skill-audit-delivery",
          "kind": "skill",
          "path": "skills/audit-delivery/SKILL.md",
          "sha256": "65962f9a7a9397f870476094bbb086116d96f27632ec283122c00efdad54118c",
          "byteLength": 1497,
          "mediaType": "text/markdown"
        },
        {
          "id": "skill-derive-cases",
          "kind": "skill",
          "path": "skills/derive-cases/SKILL.md",
          "sha256": "8d098e0567340fd9e11e59c1d17ee873cd34dd071fc9b08103fc15ea11faf4c3",
          "byteLength": 1644,
          "mediaType": "text/markdown"
        },
        {
          "id": "skills-index",
          "kind": "index",
          "path": "skills/index.md",
          "sha256": "494802558a240a30b9aacda36afecbbda66814f52f8a956b8bb8b2cc2f67a9fa",
          "byteLength": 1065,
          "mediaType": "text/markdown"
        },
        {
          "id": "skill-report-defects",
          "kind": "skill",
          "path": "skills/report-defects/SKILL.md",
          "sha256": "74492dac636f7ddd9121c727e5dfa34f34af8f3298aa3c9a2f5985f87d9b471f",
          "byteLength": 1575,
          "mediaType": "text/markdown"
        },
        {
          "id": "skill-run-evals",
          "kind": "skill",
          "path": "skills/run-evals/SKILL.md",
          "sha256": "f9a5d06597522e070c2578a990a31176a7bf90c9246805df6697f384ac7b7d59",
          "byteLength": 1722,
          "mediaType": "text/markdown"
        }
      ],
      "agentEntries": [
        {
          "host": "codex",
          "type": "AGENTS_MD_POINTER",
          "resourceId": "skills-index",
          "adapterVersion": "1.0.0"
        },
        {
          "host": "claude-code",
          "type": "SKILLS_DIRECTORY",
          "resourceId": "skills-index",
          "adapterVersion": "1.0.0"
        }
      ]
    },
    "resources": [
      {
        "resourceId": "template-cases",
        "path": "roles/qa/assets/templates/cases.yaml",
        "sha256": "19add92fc4c0e2a57eef01d3232f36652633e43d6154a25109509d6830f4fdaf",
        "byteLength": 922,
        "mediaType": "application/yaml",
        "bodyBase64": "IyDnlKjkvovmqKHmnb8KIyBpZDogVEMtPOmcgOaxgue8luWPtz4tPOW6j+WPtz4KIyBjb3ZlcnM6IOimhueblueahOmqjOaUtiBrZXnvvIzoh7PlsJHkuIDkuKoKIyBraW5kOiBURVNUIHwgSU5TUEVDVElPTiB8IERFTU/vvIjkuI7pqozmlLbnmoQgdmVyaWZpY2F0aW9uIOWvuem9kO+8iQoKdmVyc2lvbjogMQpwaGFzZTogREVTSUdOCmV4ZWN1dGlvblN0YXR1czogTk9UX1JVTgpyZXF1aXJlbWVudDogPFBST0pFQ1RfS0VZPi085bqP5Y+3PgoKY2FzZXM6CiAgLSBpZDogVEMtPOW6j+WPtz4tMDEKICAgIGNvdmVyczogW2FjLTAxXQogICAga2luZDogVEVTVAogICAgZ2l2ZW46IDzliY3nva7nirbmgIHkuI7mlbDmja4+CiAgICB3aGVuOiA85pON5L2cPgogICAgdGhlbjogPOWPr+ingua1i+e7k+aenO+8jOS4gOadoeaWreiogD4KICAgIGRhdGE6CiAgICAgIC0gPOa1i+ivleaVsOaNruaIliBmaXh0dXJlIOi3r+W+hD4KCiAgLSBpZDogVEMtPOW6j+WPtz4tMDIKICAgIGNvdmVyczogW2FjLTAyXQogICAga2luZDogSU5TUEVDVElPTgogICAgZ2l2ZW46IDznmbvlvZXop5LoibLkuI7pobXpnaI+CiAgICB3aGVuOiA85pON5L2cPgogICAgdGhlbjogPOeVjOmdouW6lOWRiOeOsOeahOWGheWuuT4KICAgIGV2aWRlbmNlOiDmiKrlm74KCiAgLSBpZDogVEMtPOW6j+WPtz4tMDMKICAgIGNvdmVyczogW2FjLTAzXQogICAga2luZDogREVNTwogICAgZ2l2ZW46IDzlt7Lnoa7orqTnmoTmvJTnpLrnjq/looPkuI7mlbDmja4+CiAgICB3aGVuOiA85oyJ5q2l6aqk5ryU56S6PgogICAgdGhlbjogPOWPr+ingua1i+e7k+aenD4KCmNvdmVyYWdlOgogIHVuY292ZXJlZDogW10KIyB1bmNvdmVyZWQg56S65L6L77yaLSBhYy0wM1xuIyAgIOWOn+WboDog6ZyA6KaB55yf5a6e56ys5LiJ5pa5546v5aKD77yM5pqC55SxIERFTU8g6KaG55uWCg=="
      },
      {
        "resourceId": "template-defect",
        "path": "roles/qa/assets/templates/defect.md",
        "sha256": "ad21cbe2fb1916b1d2af837544790f090b84678b630c6025b9afd9442fe72aeb",
        "byteLength": 557,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDnvLrpmbfvvJo8546w6LGhICsg5p2h5Lu2PgoKPiDpnIDmsYLnvJblj7fvvJo8UFJPSkVDVF9LRVk+LTzluo/lj7c+IMK3IOmqjOaUtu+8mmFjLTAxIMK3IOS7u+WKoe+8mjx0YXNrIGNvZGU+Cj4g5o+Q5Lqk77yaPHNoYT4gwrcg57qn5Yir77ya6Zi75aGeIC8g5Lil6YeNIC8g5LiA6IisIC8g5bu66K6uCgojIyDliY3nva4KCi0g546v5aKD77yaCi0g54mI5pysIC8g6ZWc5YOP77yaCi0g6LSm5Y+35LiO5p2D6ZmQ77yaCi0g5pWw5o2u77yaCgojIyDlpI3njrDmraXpqqQKCjEuCjIuCjMuCgojIyDmnJ/mnJsgdnMg5a6e6ZmFCgotIOacn+acm++8iOW8leeUqOmqjOaUtuWOn+aWh++8ie+8mgotIOWunumZhe+8mgoKIyMg5b2x5ZONCgotIOmYu+WhnuWTquS6m+mqjOaUtu+8mgotIOW9seWTjeWTquS6m+eUqOaItyAvIOWcuuaZr++8mgotIOaYr+WQpuacieS4tOaXtue7lei/h++8mgoKIyMg6K+B5o2uCgotIOaXpeW/l++8mgotIOaIquWbvu+8mgotIOivt+axgiBJRO+8mgoKIyMg5Zue5b2SCgotIOWkjei3keeUqOS+i++8mgotIOe7k+aenO+8mgotIOWFs+mXreS+neaNru+8mgo="
      },
      {
        "resourceId": "template-delivery-audit",
        "path": "roles/qa/assets/templates/delivery-audit.md",
        "sha256": "0232504c8938201f537c65c023c7083f9f17af1e44674b4e1429bafecec9d35e",
        "byteLength": 880,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDkuqTku5jmoLjpqozvvJo86ZyA5rGC57yW5Y+3PgoKPiBQUkQg5L+u6K6i77yaPGlkPiDCtyDlv6vnhafvvJo8aWQ+IMK3IOaPkOS6pO+8mjzlrozmlbQgU0hBPiDCtyDnlKjkvovkv67orqIv546v5aKD77yaPOeJiOacrD4KPiDmnaXmupDvvJpBZ2VudCDmo4Dmn6XmiqXlkYrvvJvmraPlvI/pqozmlLblvoUgSFVNQU4g5Yaz5a6a44CCCgojIyDpqozmlLbmmKDlsIQKCnwg6aqM5pS2IGtleSB8IOS7u+WKoSB8IOS7o+eggeS9jee9riB8IOeUqOS+iyB8IOWunumZhee7k+aenOS4juivgeaNriB8IOe7k+iuui/pmZDliLYgfAp8IC0tLS0tLS0tIHwgLS0tLSB8IC0tLS0tLS0tIHwgLS0tLSB8IC0tLS0tLS0tLS0tLS0tIHwgLS0tLS0tLS0tIHwKfCBhYy0wMSAgICB8ICAgICAgfCAgICAgICAgICB8ICAgICAgfCDmnKrmiafooYwgICAgICAgICB8IOaXoOazlemqjOivgSAgfAoKIyMg57y65Y+j5LiO5ZCO57ut5bel5L2c5o+Q5qGICgp8IOeos+WumiBJRCB8IOmqjOaUtiBrZXkgfCDnvLrlpLEv5YGP5beu5Y+K5L2N572uIHwg5YiG57G7IHwg5bu66K6u6LSf6LSj5Lq6IHwg5aSN6aqM5p2h5Lu2IHwg5Y6f6K6w5b2VIHwKfCAtLS0tLS0tIHwgLS0tLS0tLS0gfCAtLS0tLS0tLS0tLS0tLS0gfCAtLS0tIHwgLS0tLS0tLS0tLSB8IC0tLS0tLS0tIHwgLS0tLS0tIHwKfCBnYXAtMDEgIHwgYWMtMDEgICAgfCAgICAgICAgICAgICAgICAgfCAgICAgIHwgICAgICAgICAgICB8ICAgICAgICAgIHwgICAgICAgIHwKCiMjIOS/ruiuouWOhuWPsgoK6L+95Yqg5q+P6L2u5o+Q5Lqk44CB5Y+R546w5LiO6Kej5Yaz5L6d5o2u77yb5L+d55WZ5pen57uT6K6644CC6Zi75aGe44CB5aSx6LSl44CB5pyq5omn6KGM5ZKM5pyq5qOA5p+l5Z2H5piO56Gu5YiX5Ye644CCCg=="
      },
      {
        "resourceId": "template-evals",
        "path": "roles/qa/assets/templates/evals.yaml",
        "sha256": "4401c6c942814b5144b6d8e222ce0c3c033ac5f6a56a75c71e2c1336748ac68b",
        "byteLength": 888,
        "mediaType": "application/yaml",
        "bodyBase64": "IyDor4TmtYvnu5PmnpzmqKHmnb8KIyDlm7rlrprnjq/looPkuI7niYjmnKzvvIznu5PmnpzmiY3lj6/mr5TovoPvvJvlpLHotKXlv4XpobvliIbnsbvvvIzkuI3ph43ot5HliLDnu7/jgIIKCnN1aXRlOiA8c3VpdGUg5ZCN56ewPgpwaGFzZTogRVhFQ1VUSU9OCnJlcXVpcmVtZW50OiA8UFJPSkVDVF9LRVk+LTzluo/lj7c+CmNhc2VzUmV2aXNpb246IDznlKjkvovlt6Xku7bmiJbkv67orqLmoIfor4Y+CmNvbW1pdDogPDQwIOS9jSBzaGE+CmVudmlyb25tZW50OgogIGJ1aWxkOiA854mI5pys5oiW6ZWc5YOPPgogIGRhdGFiYXNlOiA854mI5pysPgogIHNlcnZpY2VzOiBbXQogIHN0YXJ0ZWRBdDogPElTTyDml7bpl7Q+CgpzdW1tYXJ5OgogIHRvdGFsOiAwCiAgcGFzc2VkOiAwCiAgZmFpbGVkOiAwCiAgZmxha3k6IDAKICBkdXJhdGlvbk1zOiAwCgpyZXN1bHRzOgogIC0gY2FzZTogVEMtPOW6j+WPtz4tMDEKICAgIHN0YXR1czogUEFTU0VECiAgICBkdXJhdGlvbk1zOiAwCiAgLSBjYXNlOiBUQy085bqP5Y+3Pi0wNAogICAgc3RhdHVzOiBGQUlMRUQKICAgIGR1cmF0aW9uTXM6IDAKICAgIGtpbmQ6IFBST0RVQ1RfREVGRUNUCiAgICBldmlkZW5jZTogPOaXpeW/lyAvIOaIquWbviAvIOivt+axgiBJRD4KCmZhaWx1cmVzOgogIC0gY2FzZTogVEMtPOW6j+WPtz4tMDQKICAgIGtpbmQ6IFBST0RVQ1RfREVGRUNUCiAgICByZWFzb246IDzkuIDlj6Xor53moLnlm6A+CiAgLSBjYXNlOiBUQy085bqP5Y+3Pi0wNwogICAga2luZDogQ0FTRV9JTlZBTElECiAgICByZWFzb246IDzmlq3oqIDku43mjInml6fniYjlpZHnuqbnvJblhpk+CiAgLSBjYXNlOiBUQy085bqP5Y+3Pi0wOQogICAga2luZDogRU5WSVJPTk1FTlQKICAgIHJlYXNvbjogPOS+nei1luacquWQr+WKqD4K"
      },
      {
        "resourceId": "checklist-cases-coverage",
        "path": "roles/qa/checklists/cases-coverage.md",
        "sha256": "042413ce126d97cbcdd658b730ce28c7c11e108e9265aab634bcb92b0e5391bb",
        "byteLength": 1067,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDnlKjkvovopobnm5bmuIXljZUKCi0gWyBdIOavj+adoemqjOaUtuiHs+WwkeS4gOS4queUqOS+i+OAggotIFsgXSDnlKjkvosgYGNvdmVyc2Ag5byV55So55qEIGtleSDlnKjpqozmlLbph4zlrZjlnKjjgIIKLSBbIF0gYGtpbmRgIOS4jumqjOaUtueahCBgdmVyaWZpY2F0aW9uYCDkuIDoh7TjgIIKLSBbIF0g6L6555WM6KaG55uW77ya56m65YC844CB6LaF6ZW/44CB5bm25Y+R44CB5p2D6ZmQ5LiN6Laz44CCCi0gWyBdIOW8guW4uOimhueblu+8muS4i+a4uOWksei0peOAgei2heaXtuOAgemZkOa1geOAggotIFsgXSDnlKjkvosgSUQg5ZSv5LiA77yM5qC85byP5Li6IGBUQy086ZyA5rGC57yW5Y+3Pi085bqP5Y+3PmDjgIIKLSBbIF0g5LiA5p2h55So5L6L5Y+q6aqM5LiA5Liq5pat6KiA44CCCi0gWyBdIOimhueblue8uuWPo+W3suaYvuW8j+WIl+WHuu+8jOW5tuivtOaYjueUseiwgeOAgeS9leaXtuihpeOAggotIFsgXSDkuI3mtYvlrp7njrDnu4boioLvvIzlj6rmtYvooYzkuLrkuI7lpZHnuqbjgIIKLSBbIF0g55So5L6L6K6+6K6h5qCH6K6w5pyq5omn6KGM77yM5LiN5oqK6KaG55uW5qOA5p+l5b2T5oiQ5Yqf6IO96YCa6L+H44CCCi0gWyBdIOa1i+ivleaJp+ihjOmYtuauteWbuuWumuWunueOsOOAgeeUqOS+i+S4jueOr+Wig+eJiOacrO+8jOe7k+aenOWPr+i3qOeJiOacrOavlOi+g+OAggotIFsgXSDmiafooYznu5PmnpzlpoLlrp7orrDlvZXlpLHotKXkuI7pmLvloZ7vvIzmnKrmiafooYzml7bkuI3lo7DmmI4gYGNhc2VzLWV4ZWN1dGVkOiB0cnVlYOOAggoKIyMg5Lqk5LuY5YmN5pyA5ZCO5LiJ6ZeuCgoxLiDlpoLmnpzov5nmnaHpnIDmsYLkuIrnur/lkI7lh7rpl67popjvvIznjrDmnInnlKjkvovog73kuI3og73lrprkvY3liLDlk6rkuKrpqozmlLbmsqHov4fvvJ8KMi4g5pyJ5rKh5pyJ5LiA5p2h55So5L6L77yM5Yig5o6J5LmL5ZCO5L2g5L6d54S25pyJ5L+h5b+D5LiK57q/77yf5aaC5p6c5pyJ77yM5a6D5Y+v6IO95rKh55So44CCCjMuIOWksei0peWIhuexu+WGmea4healmuS6huWQl++8jOi/mOaYr+WFqOagh+aIkOOAjOS6p+WTgee8uumZt+OAje+8nwo="
      },
      {
        "resourceId": "checklist-spec-driven",
        "path": "roles/qa/checklists/spec-driven.md",
        "sha256": "eddb341cf017d46fc1a03cf0a89de031acdc1d72ec318fa2ae8a55a48ade6bac",
        "byteLength": 1124,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDop4TmoLzkuI7kuqTku5jljY/kvZzmo4Dmn6UKCuWPquWKoOi9veacrOasoeS7u+WKoea2ieWPiueahOaooeadv+WSjOa4heWNleOAgueugOWNleaUueWKqOWGmeW/heimgeS/oeaBr++8m+WkjeadguW6puadpeiHqumjjumZqeOAgeS+nei1luWSjOmqjOaUtuiMg+WbtO+8jOS4jeaMieWbuuWumumhteaVsOaIlueroOiKguaVsOWIpOaWrei0qOmHj+OAggoKLSBbIF0g5bey6K+75pys5qyh5b+r54Wn5LiO6aG555uu6KeE6IyD77yM56Gu6K6kIFBSRC/nn6Xor4bkv67orqLvvJvogIHpobnnm67lhYjmoLjlr7nlrp7pmYXku6PnoIHjgIHlt6XlhbfphY3nva7kuI7njrDmnInooYzkuLrjgIIKLSBbIF0g5YWz6ZSu57uT6K665pyJ5p2l5rqQ77yb6LCD5p+l5pyq55+l6aG544CB5pa55qGI5Y+W6IiN44CB5L6L5aSW5LiO5bu25pyf5Z2H5pyJ55CG55Sx5ZKM6LSj5Lu75Lq644CCCi0gWyBdIOS7peW3suehruiupOmqjOaUtiBrZXkg5YWz6IGU5pys6KeS6Imy5Lqn54mp77yb5Lu75Yqh5YiX5L6d6LWW44CB6LSf6LSj5paH5Lu25LiO6aqM6K+B5pa55byP77yM5YWx55So5paH5Lu25LiN5peg5L6d5o2u5Zyw5bm26KGM5L+u5pS544CCCi0gWyBdIOmcgOaxgui0qOmHj+OAgeeUqOS+i+iuvuiuoeimhuebluOAgeWunumZheaJp+ihjOe7k+aenOWSjCBIVU1BTiDmraPlvI/pqozmlLbliIbliKvorrDlvZXjgIIKLSBbIF0g5omA5pyJ5pyq6L+Q6KGM44CB5aSx6LSl44CB6Zi75aGe44CB5peg5rOV5qC46aqM55qE5YaF5a655piO56Gu5qCH5Ye677ybQWdlbnQg5oql5ZGK5LiN5aOw56ew54us56uL6aqM6K+B44CCCi0gWyBdIOe8uuWPo+S7peeos+WumiBJRCDov73liqDlubblm57pk77ljp/orrDlvZXvvJvotoXlh7rpnIDmsYLojIPlm7TlhYjotbDlj5jmm7TvvIzkv67mlLnln7rnur/lkI7ph43mlrDmoLjlr7nor4Hmja7jgIIKCuinkuiJsui1hOa6kOabtOaWsO+8muW3sumUgeWumueJiOacrOS/neaMgeWOn+Wtl+iKgu+8jOaWsOaWueazleWcqOaWsOWMheeJiOacrOWuieijheWQjueUn+aViOOAguWuv+S4u+WFpeWPo+WPquaMh+WQkeinkuiJsui1hOa6kO+8m+mhueebruiHquWumuS5ieinhOiMg+maj+mhueebruefpeivhuS/ruiuou+8jOS4jeWkjeWItui/m+inkuiJsuWMheOAggo="
      },
      {
        "resourceId": "guide",
        "path": "roles/qa/guide.md",
        "sha256": "1d298a05b87532e8c88804dc1cbb0ece272a3ce68737e44e3f13a4ba2ef599dc",
        "byteLength": 4806,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDmtYvor5Xop5LoibLvvIhxYe+8iQoK5L2g5oyJ5Lu75Yqh6Zi25q615Lqn5Ye6IGBDQVNFU2Ag5bel5Lu277ya55So5L6L6K6+6K6h6Zi25q615o+Q5L6b6aqM5pS26KaG55uW77yM5rWL6K+V5omn6KGM6Zi25q615o+Q5L6b55yf5a6e5omn6KGM6K6w5b2V5LiO57uT6K6644CCCuS9oOeahOS7t+WAvOWcqOS6jioq55So6K+B5o2u6K+06K+dKirvvIzkuI3mmK/nu5nlrp7njrDnm5bnq6DjgIIKCiMjIOi+ueeVjAoKLSDlj6rkuqflh7ogYENBU0VTYO+8m+S4jeaUueWunueOsOOAgeS4jeaUuSBQUkTjgIHkuI3lj5HluIPjgIHkuI3mibnlh4bjgIIKLSDmr4/mnaHnlKjkvovlv4Xpobvog73ov73muq/liLAgUFJEIOeahCBgYWNjZXB0YW5jZVtdLmtleWDvvJvml6Dms5Xov73muq/nmoTlnLrmma/opoHlhYjlm57liLDkuqflk4Hop5LoibLjgIIKLSDnlKjkvovorr7orqHlj6/ku6XlnKjku6PnoIHlrozmiJDliY3ov5vooYzvvIzmmI7noa7moIforrDigJzmnKrmiafooYzigJ3vvJvopobnm5blrozmlbTkuI3ku6Pooajlip/og73pgJrov4fjgIIKLSDmtYvor5XmiafooYznu5PorrrkuLrpgJrov4fjgIHlpLHotKXvvIjpmYTmnIDlsI/lpI3njrDvvInmiJbpmLvloZ7vvIjpmYTnvLrlpLHmnaHku7bvvInjgILkuI3lhYHorrgi5Z+65pys5Y+v55SoIuOAggoKIyMg5YWI56Gu6K6k5b2T5YmN5Lu75Yqh6Zi25q61Cgp8IOW9k+WJjeS7u+WKoSAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHwg5YmN572u5p2h5Lu2ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB8IOS6pOS7mOWGheWuuSAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHwg5Y+v5Lul5aOw5piO55qE5qOA5p+lICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHwKfCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHwgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHwgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSB8IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHwKfCDova/ku7bkuqTku5jmqKHmnb8gYGNhc2VzYO+8mueUqOS+i+iuvuiuoeS4juimhuebliAgfCDlt7Llj5HluIMgUFJEICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfCBgY2FzZXMueWFtbGDvvIzpqozmlLbliLDnlKjkvovmmKDlsITjgIHopobnm5bnvLrlj6PvvJvmiafooYznirbmgIHkuLrmnKrmiafooYwgICB8IOWunumZheajgOafpei/h+eahCBgYWNjZXB0YW5jZS1jb3ZlcmVkYO+8m+S4jeWhqyBgY2FzZXMtZXhlY3V0ZWQ6IHRydWVgIHwKfCDova/ku7bkuqTku5jmqKHmnb8gYGFjY2VwdGDvvJrmtYvor5XmiafooYzkuI7nu5PmnpwgfCDliY3lkI7nq6/lrp7njrDkuI7nlKjkvovlt7LlrozmiJDvvIzkuIrkuIvmlofljIXlkKvlr7nlupTlt6Xku7YgfCBgZXZhbHMueWFtbGDvvIzlrp7njrDniYjmnKzjgIHnjq/looPjgIHnlKjkvovniYjmnKzjgIHlrp7pmYXnu5PmnpzkuI7lpLHotKXor4Hmja4gfCDnnJ/lrp7miafooYzlkI7miY3lj6/loasgYGNhc2VzLWV4ZWN1dGVkYO+8m+aJp+ihjOWujOaIkOS4jeetieS6juWFqOmDqOmAmui/hyAgICAgIHwKfCDmoIflh4bmqKHmnb8gYGNhc2VzYO+8mua1i+ivleaJp+ihjOS4jue7k+aenCAgICAgIHwg5a6e546w5bey5a6M5oiQICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfCDnlKjkvovopobnm5bkuI7miafooYznu5PmnpwgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHwg5ZCM5LiK77yM57y65bCR5p6E5bu65oiW546v5aKD5pe25oql5ZGK6Zi75aGeICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfAoK6Ieq5a6a5LmJ5rWB56iL5Lul5b2T5YmN5Lu75Yqh55qE5L6d6LWW44CB6L6T5YWl5ZKM6L6T5Ye65Li65YeG77yb6Zi25q615LiN5piO56Gu5pe25YWI5ZCR5rWB56iL6LSf6LSj5Lq656Gu6K6k44CCSFVNQU4g5ZyoIFdlYiDlrqHmn6XmiqXlkYrlubbkvZzlh7rmraPlvI/pqozmlLblhrPlrprvvIxBZ2VudCDkuI3og73nrb7lrZfjgIIKCiMjIOS4gOasoeWujOaVtOW+queOrwoKYGBgYmFzaAp3b3JrbWVzaCBhdXRoIGxvZ2luCgp3b3JrbWVzaCBjb250ZXh0IC0tdGFzayA8dGFza0lkPiAtLWluc3BlY3QKd29ya21lc2ggY2xhaW0gLS10YXNrIDx0YXNrSWQ+CndvcmttZXNoIGNvbnRleHQgLS10YXNrIDx0YXNrSWQ+IC0tY2xhaW0gPGNsYWltSWQ+IC0tZXhwZWN0ZWQtdmVyc2lvbiA8dGFza1ZlcnNpb24+IC0tbWF0ZXJpYWxpemUKCiMg55So5L6L6K6+6K6h5YWI56Gu6K6kIFBSRO+8m+a1i+ivleaJp+ihjOi/mOimgeehruiupOS4iua4uOWunueOsOOAgeeUqOS+i+OAgeaehOW7uuS4jueOr+Wig+eJiOacrApjYXQgLndvcmttZXNoL2xvY2FsL2NvbnRleHQvPHNuYXBzaG90SWQ+L21hbmlmZXN0Lmpzb24KCndvcmttZXNoIGRlbGl2ZXIgXAogIC0tdGFzayA8dGFza0lkPiAtLWNsYWltIDxjbGFpbUlkPiAtLXNuYXBzaG90IDxzbmFwc2hvdElkPiBcCiAgLS1leHBlY3RlZC12ZXJzaW9uIDx0YXNrVmVyc2lvbj4gXAogIC0tbWFuaWZlc3QgZGVsaXZlci1tYW5pZmVzdC5qc29uCgojIOS9v+eUqCBkZWxpdmVyIOi/lOWbnueahOecn+WuniByZXZpZXdSZXF1ZXN0SWQg5p+l6K+i6Ieq5Yqo5Yib5bu655qE6K+E5a6hCndvcmttZXNoIHJldmlldyBzaG93IC0tcmV2aWV3IDxyZXZpZXdSZXF1ZXN0SWQ+CmBgYAoKYGRlbGl2ZXJgIOi/lOWbniBgcmV2aWV3UmVxdWVzdElkYOOAgVdlYiDlnLDlnYDlkowgYG9wZXJhdGlvbklkYO+8jOS4jeeUqOWGjeasoeWIm+W7uuWQjOS4gOi9ruivhOWuoeOAgui+k+WHuuS4ouWkseaXtu+8jOeUqCBgd29ya21lc2ggcmVjZWlwdCBzaG93IC0tb3BlcmF0aW9uIDzljp/kuqTku5hvcGVyYXRpb25JZD4gLS1qc29uYCDor7vlj5YgYGRhdGEucmVzdWx0UmVmcy5yZXZpZXdSZXF1ZXN0SWRg77yb5pS25o2u5LuN5Li6IFBFTkRJTkcg5oiW57uT5p6c5pyq55+l5pe277yM5YWI55So5Y6f5pON5L2c57yW5Y+35omn6KGMIGB3b3JrbWVzaCByZWNlaXB0IHJlY29uY2lsZSAtLW9wZXJhdGlvbiA85Y6f5Lqk5LuYb3BlcmF0aW9uSWQ+YOOAguato+W8j+WGs+WumuS7jeeUsSBIVU1BTiDlnKggV2ViIOWujOaIkOOAggoKIyMgZGVsaXZlciBtYW5pZmVzdCDopoHngrkKCmBgYGpzb24KewogICJ3b3JrZmxvd0RlZmluaXRpb25SZXZpc2lvbklkIjogIjxzbmFwc2hvdCDph4zorrDlvZXnmoQgd29ya2Zsb3cg5L+u6K6iPiIsCiAgImxvY2FsUnVuSWQiOiAiPOacrOWcsOWPr+WkjeeOsOeahOi/kOihjOagh+ivhj4iLAogICJpdGVtcyI6IFsKICAgIHsKICAgICAgImtpbmQiOiAiQ0FTRVMiLAogICAgICAic3RvcmFnZSI6ICJIT1NURUQiLAogICAgICAibWVkaWFUeXBlIjogInRleHQvbWFya2Rvd24iLAogICAgICAic2hhMjU2IjogIjzmraPmlocgc2hhMjU2PiIsCiAgICAgICJieXRlTGVuZ3RoIjogMjA0OCwKICAgICAgImJvZHlCYXNlNjQiOiAiPGJhc2U2ND4iLAogICAgICAic3VtbWFyeSI6ICLnlKjkvovorr7orqHvvJoxMiDmnaHvvIzopobnm5blhajpg6jpqozmlLbvvJvlsJrmnKrmiafooYwiLAogICAgICAiY2hlY2tzIjogW3sgImNvZGUiOiAiYWNjZXB0YW5jZS1jb3ZlcmVkIiwgInBhc3NlZCI6IHRydWUgfV0KICAgIH0KICBdCn0KYGBgCgrku6XkuIrmmK/nlKjkvovorr7orqHkuqTku5jvvIzmraPmloflhpnmuIUgYGFjY2VwdGFuY2Uua2V5YCDihpIg55So5L6LIOKGkiDmnJ/mnJvvvIzlubbmoIforrDigJzmnKrmiafooYzigJ3jgILmtYvor5XmiafooYzkuqTku5jlj6bnlKggYGV2YWxzLnlhbWxg77yM6KGl6b2Q5a6e6ZmF57uT5p6c44CB57uT6K6644CB54mI5pys5LiO546v5aKD77yb5LuF5Zyo5a6e6ZmF5omn6KGM5ZCO5oql5ZGKIGBjYXNlcy1leGVjdXRlZGDvvIzlpLHotKXmiJbpmLvloZ7lv4XpobvlpoLlrp7orrDlvZXjgIIKCiMjIOemgeatogoKLSDkuI3opoHnlKgi5Lq65bel55yL5LiA55y85rKh6Zeu6aKYIuS7o+abv+eUqOS+i++8m+mCo+WxnuS6jiBERU1PIOexu+mqjOaUtu+8jOmcgOimgeWcqOato+aWh+mHjOagh+azqOOAggotIOS4jeimgeWcqOWunueOsOacquS6pOS7mOaXtuWFiOe7memAmui/h+e7k+iuuuOAggotIOS4jeimgeS8qumAoCBgY2hlY2tzYOOAggoKIyMg5aSx6LSl5LiO6YeN6K+VCgotIOWGmeaTjeS9nOS4jeiHquWKqOmHjeivle+8m+mHjeaUvuWkjeeUqOWQjOS4gOS4qiBgLS1vcGVyYXRpb24gPHV1aWQ+YOOAggotIOe7k+aenOS4jeaYju+8mmB3b3JrbWVzaCByZWNlaXB0IHNob3cgLS1vcGVyYXRpb24gPHV1aWQ+YCDihpIgYHdvcmttZXNoIHJlY2VpcHQgcmVjb25jaWxlYOOAggotIOWPkeeOsOWunueOsOe8uumZt++8muS6pOS7mOmHjOaYjuehruWGmeWHuuWkjeeOsOatpemqpO+8jOeUsSBIVU1BTiDlhrPlrprpgIDlm57ov5jmmK/mjqXlj5fjgIIKCiMjIOinhOagvOS4juS6pOS7mOiHquajgAoK5byA5bel5oiW6L+U5L+u5pe25oyJIGBjaGVja2xpc3RzL3NwZWMtZHJpdmVuLm1kYCDmoLjlr7nojIPlm7TjgIHkvp3mja7jgIHniYjmnKzkuI7kuqTmjqXvvJvlj6ror7vlj5blvZPliY3pmLbmrrXpnIDopoHnmoTotYTmupDjgIIK5Lqk5LuY5YmN5L2/55SoIGBhdWRpdC1kZWxpdmVyeWAg5ZKMIGBkZWxpdmVyeS1hdWRpdC5tZGDvvIzmiorpqozmlLbmmKDlsITliLDlrp7pmYXlrp7njrDkuI7or4Hmja7vvIznvLrlj6Pov73liqDkuLrlkI7nu63lt6XkvZzmj5DmoYjjgIIK"
      },
      {
        "resourceId": "reference-references",
        "path": "roles/qa/references/references.json",
        "sha256": "69af18e80ef0de74d19a7f2dc3c2222c990f21ed1ee27713cd522ad80a3fea1d",
        "byteLength": 680,
        "mediaType": "application/json",
        "bodyBase64": "ewogICJ2ZXJzaW9uIjogMSwKICAibm90ZSI6ICLlj6rmlL7mjIfpkojvvIzkuI3mlL7mraPmlofjgIJzY29wZTogUFJPSkVDVCB8IFVOSVQgfCBST0xF44CC6Lev5b6E5Zyo6L+Q6KGM5pe255Sx5b+r54Wn6Kej5p6Q44CCIiwKICAiZW50cmllcyI6IFsKICAgIHsKICAgICAgImtleSI6ICJhY2NlcHRhbmNlLWNvbnRyYWN0IiwKICAgICAgInNjb3BlIjogIlBST0pFQ1QiLAogICAgICAicmVmIjogImtub3dsZWRnZTovLzxwcm9qZWN0LWtleT4vc3lzdGVtL2FjY2VwdGFuY2UtY29udHJhY3QiCiAgICB9LAogICAgewogICAgICAia2V5IjogInVuaXQtY2FyZCIsCiAgICAgICJzY29wZSI6ICJVTklUIiwKICAgICAgInJlZiI6ICJrbm93bGVkZ2U6Ly88cHJvamVjdC1rZXk+L3N5c3RlbS88dW5pdC1rZXk+L2NhcmQiCiAgICB9LAogICAgewogICAgICAia2V5IjogImNvbnZlbnRpb25zIiwKICAgICAgInNjb3BlIjogIlBST0pFQ1QiLAogICAgICAicmVmIjogImtub3dsZWRnZTovLzxwcm9qZWN0LWtleT4vc3lzdGVtL2NvbnZlbnRpb25zIgogICAgfSwKICAgIHsKICAgICAgImtleSI6ICJwcmlvci1kZWZlY3RzIiwKICAgICAgInNjb3BlIjogIlJPTEUiLAogICAgICAicmVmIjogImtub3dsZWRnZTovLzxwcm9qZWN0LWtleT4vcHJhY3RpY2UvcWEvZGVmZWN0LXBhdHRlcm5zIgogICAgfQogIF0KfQo="
      },
      {
        "resourceId": "skill-audit-delivery",
        "path": "roles/qa/skills/audit-delivery/SKILL.md",
        "sha256": "65962f9a7a9397f870476094bbb086116d96f27632ec283122c00efdad54118c",
        "byteLength": 1497,
        "mediaType": "text/markdown",
        "bodyBase64": "LS0tCm5hbWU6IGF1ZGl0LWRlbGl2ZXJ5CmRlc2NyaXB0aW9uOiDlnKjkuqTku5jliY3pgJDmnaHlr7nnhafpqozmlLbjgIHlrp7pmYXku6PnoIHkuI7miafooYzor4Hmja7vvIzliJflh7rnvLrlpLHjgIHlgY/lt67lkozlkI7nu63lt6XkvZzvvJvlvZPlrp7njrDlrozmiJDjgIHov5Tkv67lkI7lpI3moLjmiJblh4blpIfpqozmlLbml7bkvb/nlKjjgIIKbGljZW5zZTogTUlUCm1ldGFkYXRhOgogIHJvbGVLZXk6IHFhCi0tLQoKIyDmoLjpqozkuqTku5jlrozmlbTmgKcKCjEuIOS7juS7u+WKoeW/q+eFp+WPliBQUkQg5LiO6aqM5pS277yM6K+75Y+W5pys5qyh5a6e546w5o+Q5Lqk44CB55So5L6L5L+u6K6i5ZKM5omn6KGM546v5aKD77yb5peg5rOV5Y+W5b6X5a6e6ZmF5Luj56CB5oiW57uT5p6c5bCx6K6w5b2V6Zi75aGe44CCCjIuIOmAkOadoei/vei4qiBg6aqM5pS2IGtleSDihpIg5Lu75YqhIOKGkiDku6PnoIHkvY3nva4g4oaSIOeUqOS+iyDihpIg5omn6KGM57uT5p6cL+ivgeaNrmDjgILku7vliqHli77pgInjgIHnlKjkvovorr7orqHopobnm5blkozmnoTlu7rmiJDlip/pg73kuI3og73ku6Pmm7/ooYzkuLror4Hmja7jgIIKMy4g5a+55q+P5p2h6aqM5pS26K6w5b2V5bey6KaG55uW44CB6YOo5YiG6KaG55uW44CB57y65aSx44CB5Yay56qB44CB5peg5rOV6aqM6K+B77yb5Yy65YiG5a6e546w57y65Y+j44CB5aSx5pWI55So5L6L44CB546v5aKD6Zeu6aKY5ZKM5paw5aKe6IyD5Zu044CCCjQuIOajgOafpeivgeaNrue7keWumuWQjOS4gCBQUkTjgIHlv6vnhaflkowgY29tbWl044CC5Y+v5oqK5pig5bCE5aGr5YWlIERFTElWRVJZIOi0qOmHj+WMheaJp+ihjCBgd29ya21lc2ggcXVhbGl0eSAtLWZpbGUgcXVhbGl0eS1idW5kbGUuanNvbiAtLWpzb25g77yb5bel5YW35LiN5LiL6L295byV55So44CB5LiN6K+75Luj56CB77yM5Lmf5LiN5Yik5a6a5Yqf6IO96YCa6L+H44CCCjUuIOWvuee8uuWPo+i/veWKoOeos+WumiBJROOAgemqjOaUtiBrZXnjgIHlpI3njrDjgIHlj5flvbHlk43mlofku7bjgIHlu7rorq7otJ/otKPkurrlkozlpI3pqozmnaHku7bjgILlt7LmnInorrDlvZXkv53nlZnvvIzph43lpI3lj5HnjrDlhbPogZTljp8gSUTvvIzojIPlm7TmlrDlop7lhYjotbDlj5jmm7TjgIIKNi4g5Lqn5Ye6IGBkZWxpdmVyeS1hdWRpdC5tZGDvvIzkvZzkuLrlvZPliY3ku7vliqHlhYHorrjnmoQgQ0FTRVMg5q2j5paH5oiW6K+E5a6h5p2Q5paZ77yM5LqkIEhVTUFOIOWGs+Wumui/lOS/ruOAgeWQjue7reW3peS9nOaIluato+W8j+mqjOaUtuOAggoKIyMg6L6555WMCgrkuI3oh6rliqjmiafooYzkv67lpI3lvqrnjq/jgIHkuI3opobnm5bljoblj7Lnu5PmnpzjgIHkuI3kv67mlLnlhbbku5bop5LoibLlt6Xku7bjgIHkuI3mibnlh4bjgILkv67lpI3lkI7lj6rlr7nlj5flvbHlk43pobnlpI3pqozvvIzkv53nlZnkuIrkuIDova7nu5PorrrlkozniYjmnKzvvJvku7vkvZXliankvZnpmLvloZ7pg73mmL7lvI/kv53nlZnjgIIK"
      },
      {
        "resourceId": "skill-derive-cases",
        "path": "roles/qa/skills/derive-cases/SKILL.md",
        "sha256": "8d098e0567340fd9e11e59c1d17ee873cd34dd071fc9b08103fc15ea11faf4c3",
        "byteLength": 1644,
        "mediaType": "text/markdown",
        "bodyBase64": "LS0tCm5hbWU6IGRlcml2ZS1jYXNlcwpkZXNjcmlwdGlvbjog5oqK6aqM5pS25p2h55uu6L2s5oiQ55So5L6L5LiO6K+E5rWL6ZuG77yM5L+d6K+B5q+P5p2h6aqM5pS26Iez5bCR5LiA5Liq55So5L6L77yM5bm25qCH5rOo6KaG55uW5LiO6aqM6K+B5pa55byP77yb5b2TIFBSRCDlj5HluIPjgIHku6PnoIHlsJrmnKrlsLHnu6rml7bkvb/nlKjjgIIKbGljZW5zZTogTUlUCm1ldGFkYXRhOgogIHJvbGVLZXk6IHFhCiAgcGFja2FnZVZlcnNpb246IDAuMS4wCi0tLQoKIyDmtL7nlJ/nlKjkvosKCiMjIOS9leaXtueUqAoKLSBQUkQg5bey5Y+R5biD77yM6aqM5pS25p2h55uu5Y+v6K+744CCCi0g6aqM5pS25L+u6K6i5ZCO6ZyA6KaB5ZCM5q2l55So5L6L44CCCgojIyDmraXpqqQKCjEuIOmAkOadoeivu+mqjOaUtu+8jOehruiupCBgdmVyaWZpY2F0aW9uYCDnsbvlnovjgIIKMi4g5q+P5p2h6aqM5pS26Iez5bCR5LiA5Liq55So5L6L77yb5aSN5p2C5p2h55uu5ouG5oiQ5aSa5Liq55So5L6L44CCCjMuIOWGmeeUqOS+i++8mmBnaXZlbiAvIHdoZW4gLyB0aGVuYCArIOaWreiogOOAggo0LiDmoIfopobnm5bvvJpgY292ZXJzOiBbYWMtMDEsIGFjLTAyXWDjgIIKNS4g6KGl6L6555WM5LiO5byC5bi477ya56m65YC844CB6LaF6ZW/44CB5bm25Y+R44CB5p2D6ZmQ5LiN6Laz44CB5LiL5ri45aSx6LSl44CCCjYuIOS6p+WHuiBgY2FzZXMueWFtbGDjgIIKCiMjIOinhOWImQoKLSDnlKjkvosgSUTvvJpgVEMtPOmcgOaxgue8luWPtz4tPOW6j+WPtz5g77yM5L6L5aaCIGBUQy1ZRkYtMDAzLTAxYOOAggotIOS4gOadoeeUqOS+i+WPqumqjOS4gOS4quaWreiogO+8m+WkmuS4quaWreiogOS8muiuqeWksei0peWOn+WboOWPmOaooeeziuOAggotIOS4jea1i+WunueOsOe7huiKgu+8mua1i+ihjOS4uuS4juWlkee6pu+8jOS4jea1i+WGhemDqOWHveaVsOOAggotIOWksei0peW/hemhu+iDveWumuS9je+8muWGmea4heWJjee9rueKtuaAgeS4juaVsOaNruOAggotIOimhuebluS8mOWFiOS6juaVsOmHj++8muavj+adoemqjOaUtuiHs+WwkeS4gOS4qu+8jOS4jeS4uuWHkeaVsOWGmemHjeWkjeeUqOS+i+OAggotIOeUqOS+i+iuvuiuoeS6pOS7mOagh+iusCBgcGhhc2U6IERFU0lHTmDjgIFgZXhlY3V0aW9uU3RhdHVzOiBOT1RfUlVOYO+8m+S4jeWjsOaYjuW3sue7j+aJp+ihjOaIluWKn+iDvemAmui/h+OAggoKIyMg5LiO6aqM5pS255qE5a+55bqUCgp8IOmqjOaUtiB2ZXJpZmljYXRpb24gfCDnlKjkvovlvaLmgIEgICAgICAgICAgICAgICAgICAgICAgICB8CnwgLS0tLS0tLS0tLS0tLS0tLS0gfCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHwKfCBgVEVTVGAgICAgICAgICAgICB8IOiHquWKqOWMlueUqOS+i++8jOi/m+WbnuW9kiAgICAgICAgICAgICAgfAp8IGBJTlNQRUNUSU9OYCAgICAgIHwg5qOA5p+l6aG5ICsg6K+B5o2u6KaB5rGC77yI5oiq5Zu+44CB6ZO+5o6l77yJIHwKfCBgREVNT2AgICAgICAgICAgICB8IOa8lOekuuatpemqpCArIOmihOacn+inguWvnyAgICAgICAgICAgICB8CgojIyDkuqTmjqUKCuS6p+WHuiBgY2FzZXMueWFtbGDvvIzkuqTkuqflk4Hnoa7orqTopobnm5bvvIzkuqTor4TlrqHjgILopobnm5bnvLrlj6PopoHmmL7lvI/liJflh7rvvIzkuI3ol4/nnYDjgIIK"
      },
      {
        "resourceId": "skills-index",
        "path": "roles/qa/skills/index.md",
        "sha256": "494802558a240a30b9aacda36afecbbda66814f52f8a956b8bb8b2cc2f67a9fa",
        "byteLength": 1065,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDmtYvor5Xop5LoibLljIUgwrcg5oqA6IO957Si5byVCgp8IOaKgOiDvSAgICAgICAgICAgICB8IOWBmuS7gOS5iCAgICAgICAgICAgICAgICAgICAgICAgICAgIHwg5L2V5pe255SoICAgICAgICAgICAgICAgICAgICAgICAgIHwKfCAtLS0tLS0tLS0tLS0tLS0tIHwgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gfCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gfAp8IGBkZXJpdmUtY2FzZXNgICAgfCDmiorpqozmlLbovazmiJDnlKjkvovkuI7or4TmtYvpm4YgICAgICAgICAgIHwgUFJEIOWPkeW4g+WQju+8jOS7o+eggeacquWwsee7quS5n+WPr+W8gOWniyB8CnwgYHJ1bi1ldmFsc2AgICAgICB8IOaJp+ihjOivhOa1i+W5tuWIhuexu+Wksei0pSAgICAgICAgICAgICAgIHwg5pyJ5Y+v6L+Q6KGM5p6E5bu65oiW546v5aKDICAgICAgICAgICAgIHwKfCBgcmVwb3J0LWRlZmVjdHNgIHwg5oqK5aSx6LSl5b2S5Zug5Li657y66Zm35bm26Lef6Liq5Zue5b2SICAgICAgIHwg6K+E5rWL5aSx6LSl5LiU5Yik5a6a5Li657y66Zm3ICAgICAgICAgICB8CnwgYGF1ZGl0LWRlbGl2ZXJ5YCB8IOWvueeFp+WunumZheWunueOsOS4juivgeaNru+8jOi/veWKoOS6pOS7mOe8uuWPoyB8IOS6pOS7mOWJjeOAgei/lOS/ruWQjuWkjeaguCAgICAgICAgICAgICB8CgojIyDkvb/nlKjpobrluo8KCmBgYApkZXJpdmUtY2FzZXMg4oaSIHJ1bi1ldmFscyDihpIgYXVkaXQtZGVsaXZlcnkg4oaSIHJlcG9ydC1kZWZlY3Rz77yI5Y+R546w57y66Zm35pe277yJCmBgYAoK55So5L6L5Y+v5Lul5YWI5YaZ77yM5omn6KGM6KaB562J5Luj56CB44CC6L+Z5Liq6aG65bqP6K6p5rWL6K+V5LiO5byA5Y+R5bm26KGM77yM6ICM5LiN5piv5Liy5Zyo5pyA5ZCO44CCCgojIyDkuqTmjqUKCi0g55So5L6LIOKGkiBgY2FzZXMueWFtbGDvvIzkuqTkuqflk4Hnoa7orqTopobnm5bjgIIKLSDor4TmtYsg4oaSIGBldmFscy55YW1sYCArIOe7k+aenO+8jOS6pOivhOWuoeOAggotIOe8uumZtyDihpIgYGRlZmVjdC5tZGDvvIzlm57kvKDlvIDlj5HlubblnKjkv67lpI3lkI7lm57lvZLjgIIK"
      },
      {
        "resourceId": "skill-report-defects",
        "path": "roles/qa/skills/report-defects/SKILL.md",
        "sha256": "74492dac636f7ddd9121c727e5dfa34f34af8f3298aa3c9a2f5985f87d9b471f",
        "byteLength": 1575,
        "mediaType": "text/markdown",
        "bodyBase64": "LS0tCm5hbWU6IHJlcG9ydC1kZWZlY3RzCmRlc2NyaXB0aW9uOiDmioror4TmtYvlpLHotKXlvZLlm6DkuLrlj6/ov73ouKrnmoTnvLrpmbfvvIzlhbPogZTpnIDmsYLjgIHpqozmlLbkuI7ku7vliqHvvIzlubblnKjkv67lpI3lkI7lgZrlm57lvZLvvJvlvZPor4TmtYvlpLHotKXkuJTliKTlrprkuLrkuqflk4HnvLrpmbfml7bkvb/nlKjjgIIKbGljZW5zZTogTUlUCm1ldGFkYXRhOgogIHJvbGVLZXk6IHFhCiAgcGFja2FnZVZlcnNpb246IDAuMS4wCi0tLQoKIyDmiqXlkYrnvLrpmbcKCiMjIOS9leaXtueUqAoKLSDor4TmtYvlpLHotKXkuJTliKTlrprkuLrkuqflk4HnvLrpmbfjgIIKLSDkv67lpI3lkI7pnIDopoHlm57lvZLpqozor4HjgIIKCiMjIOatpemqpAoKMS4g5aSN546w77ya5YaZ5pyA5bCP5q2l6aqk44CB5YmN572u54q25oCB44CB5a6e6ZmF57uT5p6c44CB5pyf5pyb57uT5p6c44CCCjIuIOWFs+iBlO+8mumcgOaxgue8luWPt+OAgemqjOaUtiBrZXnjgIHku7vliqHnvJblj7fjgIHmj5DkuqQgU0hB44CCCjMuIOWumue6p++8mumYu+WhniAvIOS4pemHjSAvIOS4gOiIrCAvIOW7uuiuru+8jOWGmea4heW9seWTjemdouOAggo0LiDlm57kvKDvvJrkuqTnu5nlr7nlupTlvIDlj5Hku7vliqHvvIzkuI3nm7TmjqXmlLnku6PnoIHjgIIKNS4g5Zue5b2S77ya5L+u5aSN5ZCO5oyJ5Y6f55So5L6L5aSN6LeR77yM6K6w5b2V57uT5p6c44CCCgojIyDop4TliJkKCi0g57y66Zm35b+F6aG75oyC6ZyA5rGC57yW5Y+35LiO6aqM5pS2IGtlee+8m+ayoeaciemUmueCueeahOe8uumZt+S4jeWPr+i/vei4quOAggotIOS4jeWkueW4pumcgOaxguWPmOabtO+8muimgeaUuemcgOaxguWwsei1sOWPmOabtOWNle+8jOS4jeWGmeWcqOe8uumZt+mHjOOAggotIOWFs+mXremcgOimgeWbnuW9kuivgeaNru+8jOS4jeaOpeWPl+OAjOW6lOivpeWlveS6huOAjeOAggotIOS4gOS4que8uumZt+S4gOS4quagueWboO+8m+WkmuS4queOsOixoeWQiOW5tuS8muiuqeS/ruWkjeiMg+WbtOWkseaOp+OAggoKIyMg57y66Zm35qih5p2/6KaB54K5Cgp8IOWtl+autSAgICAgICAgfCDopoHmsYIgICAgICAgICAgICAgICAgICAgfAp8IC0tLS0tLS0tLS0tIHwgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSB8Cnwg5qCH6aKYICAgICAgICB8IOeOsOixoSArIOadoeS7tu+8jOS4gOWPpeivnSAgICB8Cnwg5YmN572uICAgICAgICB8IOeOr+Wig+OAgeaVsOaNruOAgeeJiOacrCAgICAgICB8Cnwg5q2l6aqkICAgICAgICB8IOWPr+WkjeeOsOeahOacgOWwj+atpemqpCAgICAgICB8Cnwg5pyf5pybIC8g5a6e6ZmFIHwg5byV55So6aqM5pS2IGtleSDnmoTljp/mlocgICAgfAp8IOW9seWTjSAgICAgICAgfCDpmLvloZ7lk6rkupvpqozmlLbjgIHlk6rkupvnlKjmiLcgfAp8IOivgeaNriAgICAgICAgfCDml6Xlv5fjgIHmiKrlm77jgIHor7fmsYIgSUQgICAgfAoKIyMg5Lqk5o6lCgrkuqflh7ogYGRlZmVjdC5tZGDvvIzlm57kvKDlvIDlj5Hku7vliqHjgILkv67lpI3lkI7lm57lvZLpgJrov4fvvIznvLrpmbflhbPpl63vvJvlm57lvZLlpLHotKXliJnph43mlrDmiZPlvIDlubbooaXlhYXor4Hmja7jgIIK"
      },
      {
        "resourceId": "skill-run-evals",
        "path": "roles/qa/skills/run-evals/SKILL.md",
        "sha256": "f9a5d06597522e070c2578a990a31176a7bf90c9246805df6697f384ac7b7d59",
        "byteLength": 1722,
        "mediaType": "text/markdown",
        "bodyBase64": "LS0tCm5hbWU6IHJ1bi1ldmFscwpkZXNjcmlwdGlvbjog5omn6KGM55So5L6L5LiO6K+E5rWL6ZuG77yM6K6w5b2V546v5aKD44CB54mI5pys44CB6YCa6L+H546H5LiO5aSx6LSl5YiG57G777yM5Lqn5Ye65Y+v5q+U6L6D55qE6K+E5rWL57uT5p6c77yb5b2T5pyJ5Y+v6L+Q6KGM5p6E5bu65oiW5rWL6K+V546v5aKD5pe25L2/55So44CCCmxpY2Vuc2U6IE1JVAptZXRhZGF0YToKICByb2xlS2V5OiBxYQogIHBhY2thZ2VWZXJzaW9uOiAwLjEuMAotLS0KCiMg5omn6KGM6K+E5rWLCgojIyDkvZXml7bnlKgKCi0g5pyJ5Y+v6L+Q6KGM55qE5p6E5bu65oiW5rWL6K+V546v5aKD44CCCi0g6ZyA6KaB5Li65p+Q5Liq5o+Q5LqkIC8g54mI5pys5Ye65LiA5Lu95Y+v5q+U6L6D55qE57uT5p6c44CCCgojIyDmraXpqqQKCjEuIOWbuuWumueOr+Wig++8muaehOW7uueJiOacrOOAgeaVsOaNruW6k+eJiOacrOOAgemFjee9ruOAgeS+nei1luacjeWKoeOAggoyLiDpgInor4TmtYvpm4bvvJoyMOKAkzUwIOS4quecn+WunuS7u+WKoe+8jOimhuebluWFs+mUrui3r+W+hOS4jumrmOmjjumZqeWIhuaUr+OAggozLiDmiafooYzvvJrorrDlvZXpgJrov4cgLyDlpLHotKUgLyDogJfml7YgLyDkuI3nqLPlrprvvIhmbGFree+8ieOAggo0LiDliIbnsbvlpLHotKXvvJoKICAgLSDkuqflk4HnvLrpmbcKICAgLSDnlKjkvovpl67popjvvIjmlq3oqIDlhpnplJnjgIHmlbDmja7ov4fmnJ/vvIkKICAgLSDnjq/looPpl67popjvvIjkvp3otZbkuI3lj6/nlKjjgIHphY3nva7nvLrlpLHvvIkKNS4g5Lqn5Ye6IGBldmFscy55YW1sYOOAggoKIyMg6KeE5YiZCgotIOiusOW9leeOr+Wig+S4jueJiOacrO+8m+ayoeacieS4iuS4i+aWh+eahOOAjOWFqOe7v+OAjeS4jeWPr+S/oeOAggotIOWbuuWumueUqOS+i+S/ruiuouS4juWunueOsOeJiOacrO+8m+e8uuWwkeWPr+i/kOihjOaehOW7uuaIlueOr+Wig+aXtuaKpeWRiumYu+Whnu+8jOS4jeS8qumAoOaJp+ihjOe7k+aenOOAggotIOa1i+ivlee7k+aenOaYr+ivhOWuoeivgeaNru+8jOacgOe7iOmqjOaUtueUsSBIVU1BTiDlnKggV2ViIOWujOaIkOOAggotIOS4jeaOqeebluS4jeeos+Wumu+8mmZsYWt5IOeUqOS+i+imgeagh+WHuuadpe+8jOS4jemHjei3keWIsOe7v+S4uuatouOAggotIOS4gOasoeWksei0peW/hemhu+iDveWkjeeOsO+8m+S4jeiDveWkjeeOsOeahOiusOS4uuOAjOW+heinguWvn+OAje+8jOS4jeiusOS4uumAmui/h+OAggotIOe7k+aenOWPr+avlOi+g++8muWQjOS4gOivhOa1i+mbhui3qOeJiOacrOWvueavlO+8jOaJjeeci+W+l+WHuumAgOWMluOAggoKIyMg5aSx6LSl5YiG57G756S65L6LCgpgYGB5YW1sCmZhaWx1cmVzOgogIC0gY2FzZTogVEMtWUZGLTAwMy0wNAogICAga2luZDogUFJPRFVDVF9ERUZFQ1QKICAgIGV2aWRlbmNlOiDmiKrlm74gKyDml6Xlv5cKICAtIGNhc2U6IFRDLVlGRi0wMDMtMDcKICAgIGtpbmQ6IENBU0VfSU5WQUxJRAogICAgcmVhc29uOiDmlq3oqIDku43mjInml6fniYjlpZHnuqbnvJblhpkKICAtIGNhc2U6IFRDLVlGRi0wMDMtMDkKICAgIGtpbmQ6IEVOVklST05NRU5UCiAgICByZWFzb246IOacrOWcsOaooeWei+err+WPo+acquWQr+WKqApgYGAKCiMjIOS6pOaOpQoK5Lqn5Ye6IGBldmFscy55YW1sYCDkuI7nu5PmnpzmkZjopoHvvIzkuqTor4TlrqHjgILlpLHotKXpobnmjInliIbnsbvov5vlhaXnvLrpmbfmtYHnqIvmiJbkv67nlKjkvovjgIIK"
      }
    ]
  },
  {
    "packageId": "workmesh.role.ui",
    "version": "1.2.1",
    "roleKey": "ui",
    "manifest": {
      "packageSchemaVersion": "1.1",
      "id": "workmesh.role.ui",
      "version": "1.2.1",
      "protocolVersion": "1.0",
      "title": "UI 角色包",
      "description": "产出页面与交互规格，或声明复用现有设计，让前端拿到确定的视觉与交互依据。",
      "license": "MIT",
      "roleKey": "ui",
      "compatibility": {
        "minCliVersion": "1.0.0",
        "maxCliVersionExclusive": "2.0.0",
        "contractVersion": "1.0"
      },
      "skills": [
        {
          "key": "write-design-spec",
          "path": "skills/write-design-spec/SKILL.md",
          "description": "为涉及新页面或新交互的需求产出设计规格，覆盖状态、边界与异常。",
          "whenToUse": "需求涉及新页面、新交互或视觉变更时。"
        },
        {
          "key": "declare-reuse",
          "path": "skills/declare-reuse/SKILL.md",
          "description": "声明复用现有组件或模式，给前端一个明确的指针，而不是重新设计。",
          "whenToUse": "需求可复用既有设计、无需新增视觉状态时。"
        }
      ],
      "inputs": [
        {
          "key": "context",
          "source": "TASK_SNAPSHOT",
          "kind": "CONTEXT",
          "required": true,
          "contractVersion": "1.0"
        },
        {
          "key": "prd",
          "source": "KNOWLEDGE",
          "kind": "PRD",
          "required": true,
          "contractVersion": "1.0"
        }
      ],
      "outputs": [
        {
          "key": "design",
          "channel": "CANDIDATE",
          "kind": "DESIGN",
          "contractVersion": "1.0",
          "templateResourceId": "template-design-spec",
          "evidence": [
            "INSPECTION"
          ]
        },
        {
          "key": "reuse",
          "channel": "CANDIDATE",
          "kind": "KNOWLEDGE",
          "contractVersion": "1.0",
          "templateResourceId": "template-reuse-declaration",
          "evidence": [
            "INSPECTION"
          ]
        }
      ],
      "resources": [
        {
          "id": "template-design-spec",
          "kind": "template",
          "path": "assets/templates/design-spec.md",
          "sha256": "6d5e9f4e4efef0fa3c2f19384e1401a1b21a716fa74c359d87c8c32798512cc5",
          "byteLength": 938,
          "mediaType": "text/markdown"
        },
        {
          "id": "template-reuse-declaration",
          "kind": "template",
          "path": "assets/templates/reuse-declaration.md",
          "sha256": "34d4b42e829f7fd2a88cab2371e376a7a78124b4d65b13aefd8451efe51fe948",
          "byteLength": 820,
          "mediaType": "text/markdown"
        },
        {
          "id": "checklist-design-coverage",
          "kind": "checklist",
          "path": "checklists/design-coverage.md",
          "sha256": "1b296c817df48af0d999e9145617dcc38d6005e853ff8762aede2ccd419ccb9c",
          "byteLength": 791,
          "mediaType": "text/markdown"
        },
        {
          "id": "checklist-spec-driven",
          "kind": "checklist",
          "path": "checklists/spec-driven.md",
          "sha256": "eddb341cf017d46fc1a03cf0a89de031acdc1d72ec318fa2ae8a55a48ade6bac",
          "byteLength": 1124,
          "mediaType": "text/markdown"
        },
        {
          "id": "guide",
          "kind": "prompt",
          "path": "guide.md",
          "sha256": "9dbfc9b304d58e6873f2a0947a8c5311e8125eaa23f656b37691398299d9e594",
          "byteLength": 2926,
          "mediaType": "text/markdown"
        },
        {
          "id": "reference-references",
          "kind": "reference",
          "path": "references/references.json",
          "sha256": "518c655eb33446be65fbf2af09867bb638e7bba2ede4e9745361c8665a563a2f",
          "byteLength": 540,
          "mediaType": "application/json"
        },
        {
          "id": "skill-declare-reuse",
          "kind": "skill",
          "path": "skills/declare-reuse/SKILL.md",
          "sha256": "7468633c09e994e793483304ec350194ddc20b16b77fd28836d33f23f88dc760",
          "byteLength": 1126,
          "mediaType": "text/markdown"
        },
        {
          "id": "skills-index",
          "kind": "index",
          "path": "skills/index.md",
          "sha256": "c2dfc73bbce72d803184937da7dee413fddcc09a222e8cd68d75d11c645d489e",
          "byteLength": 847,
          "mediaType": "text/markdown"
        },
        {
          "id": "skill-write-design-spec",
          "kind": "skill",
          "path": "skills/write-design-spec/SKILL.md",
          "sha256": "18a025296cd55c2a5e34a9f2f490a82b899f137a97d2fd820012b74c585d96c0",
          "byteLength": 1157,
          "mediaType": "text/markdown"
        }
      ],
      "agentEntries": [
        {
          "host": "codex",
          "type": "AGENTS_MD_POINTER",
          "resourceId": "skills-index",
          "adapterVersion": "1.0.0"
        },
        {
          "host": "claude-code",
          "type": "SKILLS_DIRECTORY",
          "resourceId": "skills-index",
          "adapterVersion": "1.0.0"
        }
      ]
    },
    "resources": [
      {
        "resourceId": "template-design-spec",
        "path": "roles/ui/assets/templates/design-spec.md",
        "sha256": "6d5e9f4e4efef0fa3c2f19384e1401a1b21a716fa74c359d87c8c32798512cc5",
        "byteLength": 938,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDorr7orqHop4TmoLzvvJo86aG16Z2iIC8g5Yqf6IO9PgoKPiDpnIDmsYLnvJblj7fvvJo8UFJPSkVDVF9LRVk+LTzluo/lj7c+IMK3IOeJiOacrO+8mnYxIMK3IOeKtuaAge+8muiNieeovwo+IOWFs+iBlOmqjOaUtu+8mmFjLTAx44CBYWMtMDIKCiMjIDEuIOmhtemdoue7k+aehAoKfCDljLrln58gfCDlhoXlrrkgfCDlpI3nlKjnu4Tku7YgfAp8IC0tLS0gfCAtLS0tIHwgLS0tLS0tLS0gfAp8ICAgICAgfCAgICAgIHwgICAgICAgICAgfAoKIyMgMi4g54q25oCBCgp8IOeKtuaAgSAgICAgfCDooajnjrAgfCDop6blj5HmnaHku7YgfAp8IC0tLS0tLS0tIHwgLS0tLSB8IC0tLS0tLS0tIHwKfCDmraPluLggICAgIHwgICAgICB8ICAgICAgICAgIHwKfCDnqbogICAgICAgfCAgICAgIHwgICAgICAgICAgfAp8IOmUmeivryAgICAgfCAgICAgIHwgICAgICAgICAgfAp8IOWKoOi9vSAgICAgfCAgICAgIHwgICAgICAgICAgfAp8IOadg+mZkOWPl+mZkCB8ICAgICAgfCAgICAgICAgICB8CgojIyAzLiDkuqTkupIKCnwg5pON5L2cIHwg57uT5p6cIHwg5byC5bi45aSE55CGIHwKfCAtLS0tIHwgLS0tLSB8IC0tLS0tLS0tIHwKfCAgICAgIHwgICAgICB8ICAgICAgICAgIHwKCiMjIDQuIOi+ueeVjAoKLSDplb/mlofmnKzvvJoKLSDotoXplb/liJfooajvvJoKLSDlsI/lsY/vvJoKLSDmnoHnq6/mlbDmja7vvJoKCiMjIDUuIOS4juiuvuiuoeinhOiMg+eahOWBj+emuwoKfCDlgY/nprvpobkgfCDljp/lm6AgfAp8IC0tLS0tLSB8IC0tLS0gfAp8ICAgICAgICB8ICAgICAgfAoKIyMgNi4g6aqM5pS25a+55bqUCgp8IOmqjOaUtiBrZXkgfCDnlYzpnaLooajnjrAgfAp8IC0tLS0tLS0tIHwgLS0tLS0tLS0gfAp8IGFjLTAxICAgIHwgICAgICAgICAgfAoKIyMgNy4g5Lqk5LuY54mpCgotIOiuvuiuoeeov++8mgotIOe7hOS7tuivtOaYju+8mgotIOagh+azqO+8mgo="
      },
      {
        "resourceId": "template-reuse-declaration",
        "path": "roles/ui/assets/templates/reuse-declaration.md",
        "sha256": "34d4b42e829f7fd2a88cab2371e376a7a78124b4d65b13aefd8451efe51fe948",
        "byteLength": 820,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDlpI3nlKjlo7DmmI7vvJo86aG16Z2iIC8g5Yqf6IO9PgoKPiDpnIDmsYLnvJblj7fvvJo8UFJPSkVDVF9LRVk+LTzluo/lj7c+IMK3IOeJiOacrO+8mnYxIMK3IOeKtuaAge+8muiNieeovwoKIyMgMS4g5aSN55So5a+56LGhCgp8IOexu+WeiyB8IOaMh+mSiCAgICAgICAgIHwg6K+05piOIHwKfCAtLS0tIHwgLS0tLS0tLS0tLS0tIHwgLS0tLSB8Cnwg6aG16Z2iIHwgPOi3r+W+hOaIlumTvuaOpT4gfCAgICAgIHwKfCDnu4Tku7YgfCA857uE5Lu25ZCNPiAgICAgfCAgICAgIHwKfCDmqKHlvI8gfCA85qih5byP5ZCNPiAgICAgfCAgICAgIHwKCiMjIDIuIOW3ruW8ggoKfCDpobkgICB8IOeOsOaciSB8IOacrOasoSB8IOaYr+WQpumcgOaJqeWxlSB8CnwgLS0tLSB8IC0tLS0gfCAtLS0tIHwgLS0tLS0tLS0tLSB8Cnwg5paH5qGIIHwgICAgICB8ICAgICAgfCAgICAgICAgICAgIHwKfCDlrZfmrrUgfCAgICAgIHwgICAgICB8ICAgICAgICAgICAgfAp8IOadg+mZkCB8ICAgICAgfCAgICAgIHwgICAgICAgICAgICB8Cnwg54q25oCBIHwgICAgICB8ICAgICAgfCAgICAgICAgICAgIHwKCiMjIDMuIOimhueblue7k+iuugoKLSDnjrDmnInorr7orqHmmK/lkKblrozlhajopobnm5bpqozmlLbvvJoKLSDkuI3og73opobnm5bnmoTpg6jliIbvvJoKLSDmmK/lkKbmlLnotbAgYHdyaXRlLWRlc2lnbi1zcGVjYO+8mgoKIyMgNC4g6aqM5pS25a+55bqUCgp8IOmqjOaUtiBrZXkgfCDnlLHlk6rkuKrnjrDmnInnlYzpnaLmu6HotrMgfAp8IC0tLS0tLS0tIHwgLS0tLS0tLS0tLS0tLS0tLS0tIHwKfCBhYy0wMSAgICB8ICAgICAgICAgICAgICAgICAgICB8Cg=="
      },
      {
        "resourceId": "checklist-design-coverage",
        "path": "roles/ui/checklists/design-coverage.md",
        "sha256": "1b296c817df48af0d999e9145617dcc38d6005e853ff8762aede2ccd419ccb9c",
        "byteLength": 791,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDorr7orqHopobnm5bmuIXljZUKCi0gWyBdIOavj+adoeeVjOmdouebuOWFs+eahOmqjOaUtumDveacieWvueW6lOeVjOmdouihqOeOsOOAggotIFsgXSDkupTnp43nirbmgIHvvIjmraPluLgv56m6L+mUmeivry/liqDovb0v5p2D6ZmQ5Y+X6ZmQ77yJ6YO95pyJ5a6a5LmJ44CCCi0gWyBdIOS6pOS6kueahOW8guW4uOi3r+W+hOacieWkhOeQhuaWueW8j+OAggotIFsgXSDovrnnlYzvvIjplb/mlofmnKzjgIHotoXplb/liJfooajjgIHlsI/lsY/vvInlt7LogIPomZHjgIIKLSBbIF0g5LyY5YWI5aSN55So546w5pyJ57uE5Lu277yM5paw57uE5Lu25pyJ55CG55Sx44CCCi0gWyBdIOS4juiuvuiuoeinhOiMg+eahOWBj+emu+W3suWGmeaYjuWOn+WboOOAggotIFsgXSDlpI3nlKjlo7DmmI7nu5nlh7rkuoblj6/miZPlvIDnmoTmjIfpkojvvIzkuI3mmK/lj6PlpLTmj4/ov7DjgIIKLSBbIF0g6K6+6K6h56i/5ZG95ZCN5ZCr6ZyA5rGC57yW5Y+344CCCi0gWyBdIOWJjeerr+aLv+WIsOinhOagvOWQjuS4jemcgOimgeWGjemXruOAjOi/memHjOaAjuS5iOaYvuekuuOAjeOAggotIFsgXSDpqozmlLYga2V5IOS4jueVjOmdoueahOWvueW6lOWFs+ezu+W3suWIl+WHuuOAggoKIyMg5Lqk5LuY5YmN5pyA5ZCO5LiJ6ZeuCgoxLiDliY3nq6/lj6rnnIvov5nku73op4TmoLzvvIzog73kuI3og73kuI3pl67kvaDnm7TmjqXlrp7njrDvvJ8KMi4g56m65pWw5o2u5ZKM5o6l5Y+j5oql6ZSZ5pe277yM55WM6Z2i6ZW/5LuA5LmI5qC377yfCjMuIOi/memhteWcqOWwj+Wxj+S4iui/mOaIkOeri+WQl++8nwo="
      },
      {
        "resourceId": "checklist-spec-driven",
        "path": "roles/ui/checklists/spec-driven.md",
        "sha256": "eddb341cf017d46fc1a03cf0a89de031acdc1d72ec318fa2ae8a55a48ade6bac",
        "byteLength": 1124,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDop4TmoLzkuI7kuqTku5jljY/kvZzmo4Dmn6UKCuWPquWKoOi9veacrOasoeS7u+WKoea2ieWPiueahOaooeadv+WSjOa4heWNleOAgueugOWNleaUueWKqOWGmeW/heimgeS/oeaBr++8m+WkjeadguW6puadpeiHqumjjumZqeOAgeS+nei1luWSjOmqjOaUtuiMg+WbtO+8jOS4jeaMieWbuuWumumhteaVsOaIlueroOiKguaVsOWIpOaWrei0qOmHj+OAggoKLSBbIF0g5bey6K+75pys5qyh5b+r54Wn5LiO6aG555uu6KeE6IyD77yM56Gu6K6kIFBSRC/nn6Xor4bkv67orqLvvJvogIHpobnnm67lhYjmoLjlr7nlrp7pmYXku6PnoIHjgIHlt6XlhbfphY3nva7kuI7njrDmnInooYzkuLrjgIIKLSBbIF0g5YWz6ZSu57uT6K665pyJ5p2l5rqQ77yb6LCD5p+l5pyq55+l6aG544CB5pa55qGI5Y+W6IiN44CB5L6L5aSW5LiO5bu25pyf5Z2H5pyJ55CG55Sx5ZKM6LSj5Lu75Lq644CCCi0gWyBdIOS7peW3suehruiupOmqjOaUtiBrZXkg5YWz6IGU5pys6KeS6Imy5Lqn54mp77yb5Lu75Yqh5YiX5L6d6LWW44CB6LSf6LSj5paH5Lu25LiO6aqM6K+B5pa55byP77yM5YWx55So5paH5Lu25LiN5peg5L6d5o2u5Zyw5bm26KGM5L+u5pS544CCCi0gWyBdIOmcgOaxgui0qOmHj+OAgeeUqOS+i+iuvuiuoeimhuebluOAgeWunumZheaJp+ihjOe7k+aenOWSjCBIVU1BTiDmraPlvI/pqozmlLbliIbliKvorrDlvZXjgIIKLSBbIF0g5omA5pyJ5pyq6L+Q6KGM44CB5aSx6LSl44CB6Zi75aGe44CB5peg5rOV5qC46aqM55qE5YaF5a655piO56Gu5qCH5Ye677ybQWdlbnQg5oql5ZGK5LiN5aOw56ew54us56uL6aqM6K+B44CCCi0gWyBdIOe8uuWPo+S7peeos+WumiBJRCDov73liqDlubblm57pk77ljp/orrDlvZXvvJvotoXlh7rpnIDmsYLojIPlm7TlhYjotbDlj5jmm7TvvIzkv67mlLnln7rnur/lkI7ph43mlrDmoLjlr7nor4Hmja7jgIIKCuinkuiJsui1hOa6kOabtOaWsO+8muW3sumUgeWumueJiOacrOS/neaMgeWOn+Wtl+iKgu+8jOaWsOaWueazleWcqOaWsOWMheeJiOacrOWuieijheWQjueUn+aViOOAguWuv+S4u+WFpeWPo+WPquaMh+WQkeinkuiJsui1hOa6kO+8m+mhueebruiHquWumuS5ieinhOiMg+maj+mhueebruefpeivhuS/ruiuou+8jOS4jeWkjeWItui/m+inkuiJsuWMheOAggo="
      },
      {
        "resourceId": "guide",
        "path": "roles/ui/guide.md",
        "sha256": "9dbfc9b304d58e6873f2a0947a8c5311e8125eaa23f656b37691398299d9e594",
        "byteLength": 2926,
        "mediaType": "text/markdown",
        "bodyBase64": "IyBVSSDorr7orqHop5LoibLvvIh1ae+8iQoK5L2g5Z+65LqOKirlt7Llj5HluIPnmoQgUFJEKiog5Lqn5Ye6IERFU0lHTiDlt6Xku7bvvJrkv6Hmga/mnrbmnoTjgIHkuqTkupLor7TmmI7jgIHop4bop4nop4TojIPjgIIK5L2g5Lqk5LuY55qE5piv5Y+v6KKr5Lq657G76aqM5pS255qE6K6+6K6h5Yaz562W77yM5LiN5piv5pyA57uI5a6e546w44CCCgojIyDovrnnlYwKCi0g5Y+q5Lqn5Ye6IGBERVNJR05g77yb5LiN5YaZ5a6e546w5Luj56CB44CB5LiN5pS5IFBSROOAgeS4jeWPkeW4g+OAggotIOiuvuiuoeW/hemhu+iDvei/vea6r+WIsCBQUkQg55qE6aqM5pS25p2h5qy+77yb6IyD5Zu05aSW55qE6ZyA5rGC5pS55Yqo6K+35Zue5Yiw5Lqn5ZOB6KeS6Imy77yM5LiN6KaB5Zyo6K6+6K6h6YeM5oKE5oKE5omp5p2D44CCCi0g5om55YeG5Y+q5Y+R55Sf5ZyoIFdlYiDor4TlrqHpobXvvIznlLEgSFVNQU4g5a6M5oiQ44CCCgojIyDkuIDmrKHlrozmlbTlvqrnjq8KCmBgYGJhc2gKd29ya21lc2ggYXV0aCBsb2dpbgoKd29ya21lc2ggY29udGV4dCAtLXRhc2sgPHRhc2tJZD4gLS1pbnNwZWN0CndvcmttZXNoIGNsYWltIC0tdGFzayA8dGFza0lkPgp3b3JrbWVzaCBjb250ZXh0IC0tdGFzayA8dGFza0lkPiAtLWNsYWltIDxjbGFpbUlkPiAtLWV4cGVjdGVkLXZlcnNpb24gPHRhc2tWZXJzaW9uPiAtLW1hdGVyaWFsaXplCgojIOWcqOS4iuS4i+aWh+mHjOehruiupCBQUkQg5Z+657q/77yI5Z+657q/5LiN5a+55bCx5YGc5LiL77yM5LiN6KaB5Z+65LqO54yc5rWL6K6+6K6h77yJCmxzIC53b3JrbWVzaC9sb2NhbC9jb250ZXh0LzxzbmFwc2hvdElkPi8KCiMg5Lqn5Ye65ZCO5Lqk5LuY77ya5bCP55qE6K6+6K6h6K+05piO55SoIEhPU1RFRO+8jOiuvuiuoeeov+WcqOS7k+W6k+mHjOeUqCBHSVRfUkVGCndvcmttZXNoIGRlbGl2ZXIgXAogIC0tdGFzayA8dGFza0lkPiAtLWNsYWltIDxjbGFpbUlkPiAtLXNuYXBzaG90IDxzbmFwc2hvdElkPiBcCiAgLS1leHBlY3RlZC12ZXJzaW9uIDx0YXNrVmVyc2lvbj4gXAogIC0tbWFuaWZlc3QgZGVsaXZlci1tYW5pZmVzdC5qc29uCgojIOS9v+eUqCBkZWxpdmVyIOi/lOWbnueahOecn+WuniByZXZpZXdSZXF1ZXN0SWQg5p+l6K+i6Ieq5Yqo5Yib5bu655qE6K+E5a6hCndvcmttZXNoIHJldmlldyBzaG93IC0tcmV2aWV3IDxyZXZpZXdSZXF1ZXN0SWQ+CmBgYAoKYGRlbGl2ZXJgIOi/lOWbniBgcmV2aWV3UmVxdWVzdElkYOOAgVdlYiDlnLDlnYDlkowgYG9wZXJhdGlvbklkYO+8jOS4jeeUqOWGjeasoeWIm+W7uuWQjOS4gOi9ruivhOWuoeOAgui+k+WHuuS4ouWkseaXtu+8jOeUqCBgd29ya21lc2ggcmVjZWlwdCBzaG93IC0tb3BlcmF0aW9uIDzljp/kuqTku5hvcGVyYXRpb25JZD4gLS1qc29uYCDor7vlj5YgYGRhdGEucmVzdWx0UmVmcy5yZXZpZXdSZXF1ZXN0SWRg77yb5pS25o2u5LuN5Li6IFBFTkRJTkcg5oiW57uT5p6c5pyq55+l5pe277yM5YWI55So5Y6f5pON5L2c57yW5Y+35omn6KGMIGB3b3JrbWVzaCByZWNlaXB0IHJlY29uY2lsZSAtLW9wZXJhdGlvbiA85Y6f5Lqk5LuYb3BlcmF0aW9uSWQ+YOOAguato+W8j+WGs+WumuS7jeeUsSBIVU1BTiDlnKggV2ViIOWujOaIkOOAggoKIyMgZGVsaXZlciBtYW5pZmVzdCDopoHngrkKCmBgYGpzb24KewogICJ3b3JrZmxvd0RlZmluaXRpb25SZXZpc2lvbklkIjogIjxzbmFwc2hvdCDph4zorrDlvZXnmoQgd29ya2Zsb3cg5L+u6K6iPiIsCiAgImxvY2FsUnVuSWQiOiAiPOacrOWcsOWPr+WkjeeOsOeahOi/kOihjOagh+ivhj4iLAogICJpdGVtcyI6IFsKICAgIHsKICAgICAgImtpbmQiOiAiREVTSUdOIiwKICAgICAgInN0b3JhZ2UiOiAiR0lUX1JFRiIsCiAgICAgICJtZWRpYVR5cGUiOiAidGV4dC9tYXJrZG93biIsCiAgICAgICJzaGEyNTYiOiAiPOaWh+S7tuWtl+iKgueahCBzaGEyNTY+IiwKICAgICAgImJ5dGVMZW5ndGgiOiAxMjM0LAogICAgICAicHJvamVjdFJlcG9zaXRvcnlJZCI6ICI86aG555uu5bey55m76K6w5LuT5bqTIGlkPiIsCiAgICAgICJjb21taXRTaGEiOiAiPDQwIOS9jeWwj+WGmSBoZXg+IiwKICAgICAgInJlcG9QYXRoIjogImRlc2lnbi9jaGVja291dC1mbG93Lm1kIiwKICAgICAgInN1bW1hcnkiOiAi57uT566X5rWB56iL55qE5Lik5q2l5byP5pS554mIIiwKICAgICAgImNoZWNrcyI6IFt7ICJjb2RlIjogImRlc2lnbi1yZXZpZXciLCAicGFzc2VkIjogdHJ1ZSB9XQogICAgfQogIF0KfQpgYGAKCmBzaGEyNTZgIOS4jiBgYnl0ZUxlbmd0aGAg5b+F6aG75LiO55yf5a6e5a2X6IqC5LiA6Ie077yM5pyN5Yqh56uv5Lya5aSN5qC477ybYEdJVF9SRUZgIOW/hemhu+aMh+WQkeacrOmhueebruW3sueZu+iusOS7k+W6k+eahOWujOaVtCBjb21taXTjgIIKCiMjIOWksei0peS4jumHjeivlQoKLSDlhpnmk43kvZzkuI3oh6rliqjph43or5XvvJrnlKjlkIzkuIDkuKogYC0tb3BlcmF0aW9uIDx1dWlkPmAg6YeN5pS+77yM6YG/5YWN6YeN5aSN5Lqk5LuY44CCCi0g57uT5p6c5LiN5piO5pe25YWIIGB3b3JrbWVzaCByZWNlaXB0IHNob3cgLS1vcGVyYXRpb24gPHV1aWQ+YO+8jOS4jeimgeebtOaOpeWGjeS6pOS4gOasoeOAggotIOmqjOaUtuiiq+imgeaxguS/ruaUue+8muaMieW9k+WJjeS7u+WKoeWSjCBjbGFpbSDnirbmgIHov5Tkv67lkI7ph43mlrAgYGRlbGl2ZXJg77yM5YaN55So5pys6L2u6L+U5Zue55qEIGByZXZpZXdSZXF1ZXN0SWRgIOaJp+ihjCBgcmV2aWV3IHNob3dg77yb5paw5Lqk5LuY5Lya6Ieq5Yqo5Yib5bu65pys6L2u6K+E5a6h44CCCgojIyDop4TmoLzkuI7kuqTku5joh6rmo4AKCuW8gOW3peaIlui/lOS/ruaXtuaMiSBgY2hlY2tsaXN0cy9zcGVjLWRyaXZlbi5tZGAg5qC45a+56IyD5Zu044CB5L6d5o2u44CB54mI5pys5LiO5Lqk5o6l77yb5Y+q6K+75Y+W5b2T5YmN6Zi25q616ZyA6KaB55qE6LWE5rqQ44CCCg=="
      },
      {
        "resourceId": "reference-references",
        "path": "roles/ui/references/references.json",
        "sha256": "518c655eb33446be65fbf2af09867bb638e7bba2ede4e9745361c8665a563a2f",
        "byteLength": 540,
        "mediaType": "application/json",
        "bodyBase64": "ewogICJ2ZXJzaW9uIjogMSwKICAibm90ZSI6ICLlj6rmlL7mjIfpkojvvIzkuI3mlL7mraPmlofjgIJzY29wZTogUFJPSkVDVCB8IFVOSVQgfCBST0xF44CC6Lev5b6E5Zyo6L+Q6KGM5pe255Sx5b+r54Wn6Kej5p6Q44CCIiwKICAiZW50cmllcyI6IFsKICAgIHsKICAgICAgImtleSI6ICJkZXNpZ24tc3lzdGVtIiwKICAgICAgInNjb3BlIjogIlBST0pFQ1QiLAogICAgICAicmVmIjogImtub3dsZWRnZTovLzxwcm9qZWN0LWtleT4vcHJhY3RpY2UvdWkvZGVzaWduLXN5c3RlbSIKICAgIH0sCiAgICB7CiAgICAgICJrZXkiOiAiY29udmVudGlvbnMiLAogICAgICAic2NvcGUiOiAiUFJPSkVDVCIsCiAgICAgICJyZWYiOiAia25vd2xlZGdlOi8vPHByb2plY3Qta2V5Pi9zeXN0ZW0vY29udmVudGlvbnMiCiAgICB9LAogICAgewogICAgICAia2V5IjogInByZCIsCiAgICAgICJzY29wZSI6ICJQUk9KRUNUIiwKICAgICAgInJlZiI6ICJrbm93bGVkZ2U6Ly88cHJvamVjdC1rZXk+L3JlcXVpcmVtZW50cy886ZyA5rGC57yW5Y+3PiIKICAgIH0KICBdCn0K"
      },
      {
        "resourceId": "skill-declare-reuse",
        "path": "roles/ui/skills/declare-reuse/SKILL.md",
        "sha256": "7468633c09e994e793483304ec350194ddc20b16b77fd28836d33f23f88dc760",
        "byteLength": 1126,
        "mediaType": "text/markdown",
        "bodyBase64": "LS0tCm5hbWU6IGRlY2xhcmUtcmV1c2UKZGVzY3JpcHRpb246IOWjsOaYjuWkjeeUqOeOsOaciee7hOS7tuOAgemhtemdouaIluaooeW8j++8jOe7meWHuuaYjuehruaMh+mSiOS4juW3ruW8guivtOaYju+8m+W9k+mcgOaxguaXoOmcgOaWsOWinuinhuinieeKtuaAgeOAgeWPr+ayv+eUqOaXouacieiuvuiuoeaXtuS9v+eUqOOAggpsaWNlbnNlOiBNSVQKbWV0YWRhdGE6CiAgcm9sZUtleTogdWkKICBwYWNrYWdlVmVyc2lvbjogMC4xLjAKLS0tCgojIOWjsOaYjuWkjeeUqAoKIyMg5L2V5pe255SoCgotIOmcgOaxguS4juaXouaciemhtemdoi/nu4Tku7bpq5jluqbnm7jkvLzjgIIKLSDlj6rmtonlj4rmlofmoYjjgIHmlbDmja7miJbmnYPpmZDlj5jljJbvvIzkuI3mlrDlop7op4bop4nnirbmgIHjgIIKCiMjIOatpemqpAoKMS4g5Zyo6K6+6K6h57O757uf5LiO5pei5pyJ6aG16Z2i5Lit5om+5Yiw5Y+v5aSN55So55qE5a+56LGh44CCCjIuIOmAkOmhueavlOWvue+8muW4g+WxgOOAgee7hOS7tuOAgeS6pOS6kuOAgeeKtuaAgeaYr+WQpuWujOWFqOimhuebluOAggozLiDlhpnlt67lvILvvJrlk6rkupvlrZfmrrXjgIHmlofmoYjjgIHmnYPpmZDkuI3lkIzvvIzmmK/lkKbpnIDopoHlsYDpg6jmianlsZXjgIIKNC4g57uZ5oyH6ZKI77ya57uE5Lu25ZCN44CB6aG16Z2i6Lev5b6E44CB6K6+6K6h56i/6ZO+5o6l44CCCjUuIOS6p+WHuiBgcmV1c2UtZGVjbGFyYXRpb24ubWRg44CCCgojIyDop4TliJkKCi0gKirlpI3nlKjkuI3mmK/jgIzkuI3orr7orqHjgI0qKu+8muW/hemhu+ivtOa4heWkjeeUqOS7gOS5iOOAgeW3ruWcqOWTquOAggotIOaMh+mSiOimgeiDveiiq+WJjeerr+ebtOaOpeaJk+W8gO+8jOS4jeiDveWPquWGmeOAjOWPguiAg+iuvue9rumhteOAjeOAggotIOW3ruW8gui2hei/h+S4ieWkhOaIlua2ieWPiuaWsOS6pOS6ku+8jOaUuei1sCBgd3JpdGUtZGVzaWduLXNwZWNg44CCCi0g5aSN55So5a+86Ie06aqM5pS25peg5rOV5ruh6Laz5pe277yM5piO56Gu5YaZ5Ye65Yay56qB77yM5LiN56Gs5aWX44CCCgojIyDkuqTmjqUKCmByZXVzZS1kZWNsYXJhdGlvbi5tZGAg5Lqk5YmN56uv77yb5YmN56uv5o2u5q2k5a6e546w77yM5LiN6ZyA6KaB6YeN5paw5Ye656i/44CCCg=="
      },
      {
        "resourceId": "skills-index",
        "path": "roles/ui/skills/index.md",
        "sha256": "c2dfc73bbce72d803184937da7dee413fddcc09a222e8cd68d75d11c645d489e",
        "byteLength": 847,
        "mediaType": "text/markdown",
        "bodyBase64": "IyBVSSDop5LoibLljIUgwrcg5oqA6IO957Si5byVCgp8IOaKgOiDvSAgICAgICAgICAgICAgICB8IOWBmuS7gOS5iCAgICAgICAgICAgICAgICAgICB8IOS9leaXtueUqCAgICAgICAgICAgICAgICAgICAgICAgICB8CnwgLS0tLS0tLS0tLS0tLS0tLS0tLSB8IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSB8IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSB8CnwgYHdyaXRlLWRlc2lnbi1zcGVjYCB8IOS6p+WHuumhtemdouOAgeeKtuaAgeOAgeS6pOS6kuinhOagvCB8IOaWsOmhtemdouOAgeaWsOS6pOS6kuOAgeinhuinieWPmOabtCAgICAgICB8CnwgYGRlY2xhcmUtcmV1c2VgICAgICB8IOWjsOaYjuWkjeeUqOeOsOaciee7hOS7tuaIluaooeW8jyAgIHwg5Y+v5aSN55So5pei5pyJ6K6+6K6h44CB5peg5paw5aKe6KeG6KeJ54q25oCBIHwKCiMjIOWFiOWIpOaWrei1sOWTquadoQoKYGBgCumcgOimgeaWsOinhuiniS/mlrDkuqTkupLvvJ8g4pSA4pSAIOaYryDilIDilIDilrogd3JpdGUtZGVzaWduLXNwZWMKICAgICAgICDilIIKICAgICAgICDilJTilIDilIAg5ZCmIOKUgOKUgOKWuiBkZWNsYXJlLXJldXNl77yI57uZ5oyH6ZKI77yM5LiN6YeN5paw6K6+6K6h77yJCmBgYAoK5aSn6YOo5YiG6ZyA5rGC5bGe5LqO5aSN55So77ya5YWI5p+l6K6+6K6h57O757uf77yM5om+5LiN5Yiw5YaN5Yqo56yU44CCCgojIyDkuqTmjqUKCi0g5paw6K6+6K6hIOKGkiBgZGVzaWduLXNwZWMubWRg77yM5Lqk5YmN56uv5LiO5Lqn5ZOB56Gu6K6k44CCCi0g5aSN55SoIOKGkiBgcmV1c2UtZGVjbGFyYXRpb24ubWRg77yM57uZ5YmN56uv5piO56Gu55qE57uE5Lu25LiO6aG16Z2i5oyH6ZKI44CCCg=="
      },
      {
        "resourceId": "skill-write-design-spec",
        "path": "roles/ui/skills/write-design-spec/SKILL.md",
        "sha256": "18a025296cd55c2a5e34a9f2f490a82b899f137a97d2fd820012b74c585d96c0",
        "byteLength": 1157,
        "mediaType": "text/markdown",
        "bodyBase64": "LS0tCm5hbWU6IHdyaXRlLWRlc2lnbi1zcGVjCmRlc2NyaXB0aW9uOiDkuLrmtonlj4rmlrDpobXpnaLmiJbmlrDkuqTkupLnmoTpnIDmsYLkuqflh7rorr7orqHop4TmoLzvvIzopobnm5bnirbmgIHjgIHovrnnlYzjgIHlvILluLjkuI7lk43lupTlvI/vvJvlvZPpnIDmsYLpnIDopoHmlrDlop7op4bop4nmiJbkuqTkupLml7bkvb/nlKjjgIIKbGljZW5zZTogTUlUCm1ldGFkYXRhOgogIHJvbGVLZXk6IHVpCiAgcGFja2FnZVZlcnNpb246IDAuMS4wCi0tLQoKIyDlhpnorr7orqHop4TmoLwKCiMjIOS9leaXtueUqAoKLSDpnIDmsYLmtonlj4rmlrDpobXpnaLjgIHmlrDkuqTkupLmiJbop4bop4nlj5jmm7TjgIIKLSDnjrDmnInmqKHlvI/ml6Dms5Xopobnm5YgUFJEIOeahOWcuuaZr+OAggoKIyMg5q2l6aqkCgoxLiDor7sgUFJE77ya55uu5qCH44CB6IyD5Zu044CB6aqM5pS277yM5qCH5Ye65LiO55WM6Z2i55u45YWz55qE5p2h55uu44CCCjIuIOafpeiuvuiuoeezu+e7n++8muiDveWQpueUqOeOsOaciee7hOS7tuS4juaooeW8j+e7hOWQiOOAggozLiDnlLvpobXpnaLkuI7nirbmgIHvvJrmraPluLjjgIHnqbrjgIHplJnor6/jgIHliqDovb3jgIHmnYPpmZDlj5fpmZDjgIIKNC4g5YaZ5Lqk5LqS77ya54K55Ye744CB6L6T5YWl44CB5qCh6aqM44CB6Lez6L2s44CB6L+U5Zue44CCCjUuIOagh+i+ueeVjO+8mumVv+aWh+acrOOAgei2hemVv+WIl+ihqOOAgeWwj+Wxj+OAgeaegeerr+aVsOaNruOAggo2LiDkuqflh7ogYGRlc2lnbi1zcGVjLm1kYOOAggoKIyMg6KeE5YiZCgotIOavj+adoeeVjOmdouebuOWFs+eahOmqjOaUtu+8jOmDveimgeacieWvueW6lOeahOeVjOmdouihqOeOsOOAggotIOS6lOenjeeKtuaAgee8uuS4gOS4jeWPr++8m+WPqueUu+ato+W4uOaAgeeahOiuvuiuoeS4jeeul+WujOaIkOOAggotIOS4jeW8leWFpeaWsOe7hOS7tu+8jOmZpOmdnueOsOaciee7hOS7tuehruWunuaXoOazleihqOi+vu+8jOW5tuWGmeaYjueQhueUseOAggotIOS4juaXouacieiuvuiuoeinhOiMg+S4jeS4gOiHtOWkhO+8jOW/hemhu+aYvuW8j+ivtOaYjuOAggoKIyMg5Lqk5o6lCgpgZGVzaWduLXNwZWMubWRgIOS6pOS6p+WTgeehruiupOOAgeWJjeerr+a2iOi0ueOAguWJjeerr+aNruatpOWunueOsO+8jOS4jeW/heWGjeeMnOOAggo="
      }
    ]
  }
];
