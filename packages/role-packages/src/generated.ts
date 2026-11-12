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
          "sha256": "357604e6251d8a477a26263067ddbe9f8096a79ba3873a3bf1ee3362b5e21e14",
          "byteLength": 1560,
          "mediaType": "text/markdown"
        },
        {
          "id": "template-contract",
          "kind": "template",
          "path": "assets/templates/contract.md",
          "sha256": "c086d25db18b0b855d35d8ee2ff6ad23aca79cfa33c007d6fb06e7b19b328f62",
          "byteLength": 1379,
          "mediaType": "text/markdown"
        },
        {
          "id": "template-impl",
          "kind": "template",
          "path": "assets/templates/impl.md",
          "sha256": "fab3b3d7ca14e415f88635ac28260b1f2fb5ba094c26b3f3c77b23929749f902",
          "byteLength": 954,
          "mediaType": "text/markdown"
        },
        {
          "id": "checklist-contract-quality",
          "kind": "checklist",
          "path": "checklists/contract-quality.md",
          "sha256": "f7c00f5af385bc32cc2f6b47ee66b969eb6cbe56119454ec0cfb0f18f54415fa",
          "byteLength": 945,
          "mediaType": "text/markdown"
        },
        {
          "id": "checklist-spec-driven",
          "kind": "checklist",
          "path": "checklists/spec-driven.md",
          "sha256": "5caddca3baed2471f6b8ab97dbac3c0b07278c7a66ffeb6b35bdb93261ef77c9",
          "byteLength": 1266,
          "mediaType": "text/markdown"
        },
        {
          "id": "guide",
          "kind": "prompt",
          "path": "guide.md",
          "sha256": "b62c509417267920fc3ecb9f91d09124439932dda2586674ee5b84568a163fd8",
          "byteLength": 4054,
          "mediaType": "text/markdown"
        },
        {
          "id": "reference-references",
          "kind": "reference",
          "path": "references/references.json",
          "sha256": "896c6298825f963e086416acbf7d361edd9c4a0768e87490fb053ea2744b6798",
          "byteLength": 672,
          "mediaType": "application/json"
        },
        {
          "id": "skill-attach-evidence",
          "kind": "skill",
          "path": "skills/attach-evidence/SKILL.md",
          "sha256": "c89b895f6b2ff66c17c6c6759425a196199f67ada65f9e1dd02bd6a6b1e6b6cd",
          "byteLength": 1572,
          "mediaType": "text/markdown"
        },
        {
          "id": "skill-design-contract",
          "kind": "skill",
          "path": "skills/design-contract/SKILL.md",
          "sha256": "e544e5b367f3e9b47e39fef78e97157993289c0629ce8959b287ccf10fe3216a",
          "byteLength": 1837,
          "mediaType": "text/markdown"
        },
        {
          "id": "skill-diagnose-bug",
          "kind": "skill",
          "path": "skills/diagnose-bug/SKILL.md",
          "sha256": "c44f5165655f55118567a642ce6f780239545010c88f4cdd6d92aa6bf2074e47",
          "byteLength": 1252,
          "mediaType": "text/markdown"
        },
        {
          "id": "skill-implement-change",
          "kind": "skill",
          "path": "skills/implement-change/SKILL.md",
          "sha256": "2617ab24c9474a3f18fec4d90572838d5cda31e7feeca972a77f4e142c39d444",
          "byteLength": 1445,
          "mediaType": "text/markdown"
        },
        {
          "id": "skills-index",
          "kind": "index",
          "path": "skills/index.md",
          "sha256": "4ec83d2910edaf0179fc5c1bbc6c3d8e7ccc77cdebb95e83ba49820e6848a8f3",
          "byteLength": 1448,
          "mediaType": "text/markdown"
        },
        {
          "id": "skill-plan-change",
          "kind": "skill",
          "path": "skills/plan-change/SKILL.md",
          "sha256": "7152371369b1eeeab14f2a2ee06e2f316b387aab15815a0180bb4da45fb9312d",
          "byteLength": 1964,
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
        "sha256": "357604e6251d8a477a26263067ddbe9f8096a79ba3873a3bf1ee3362b5e21e14",
        "byteLength": 1560,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDlrp7njrDorqHliJLvvJo86ZyA5rGC57yW5Y+35LiO5qCH6aKYPg0KDQo+IFBSRCDkv67orqLvvJo8aWQ+IMK3IOW/q+eFp++8mjxpZD4gwrcg5Luj56CB5Z+657q/77yaPOWujOaVtCBjb21taXQgU0hBPg0KDQojIyDnjrDnirbkuI7nuqbmnZ8NCg0K546w5pyJ6KGM5Li644CB55u46YK75qih5Z2X44CB5b+F6aG75L+d55WZ55qE5YW85a655oCn44CB6aG555uu6KeE6IyD54mI5pys77yb5paw6aG555uu5rOo5piO5peg5pei5pyJ5a6e546w44CCDQoNCiMjIOWinumHj+S6pOS7mOmhuuW6j++8iOWkmuWcuuaZr+aXtu+8iQ0KDQrmjInnlKjmiLfku7flgLzmoIcgUDEvUDIvUDPvvIzpgInlh7rmnIDlsI/lj6/nlKjkuJTnq6/liLDnq6/nmoTpppbkuKrliIfniYfvvIhNVlDvvInvvIzms6jmmI7lroPni6znq4vkuqTku5jml7bnmoTpqozor4Hmo4Dmn6XngrnjgILorrDlvZUgUDIvUDMg5bu25pyf55CG55Sx5LiO5oGi5aSN5p2h5Lu277yb5Z+656GA5L6d6LWW5Y+v5Lul5YWI5a6e546w77yM5L2G5LiN5b6X5Zug5q2k5oqK57qv5oqA5pyv6ZO65Z6r6K+v5oql5oiQ55So5oi35Lu35YC844CC5LyY5YWI57qn5ZKMIE1WUCDmmK/mlrnmoYjlu7rorq7vvIznlLHkuJrliqHotJ/otKPkurrnoa7orqTvvJvkuI3oh6rliqjmlLnlj5jlubPlj7DojIPlm7TjgILnroDljZXmlLnliqjlj6/nnIHnlaXjgIINCg0KIyMg6LCD5p+l5LiO5Y+W6IiNDQoNCnwg6Zeu6aKYIHwg5p2l5rqQ5L2N572uIHwg6YCJ5oup5LiO5Y6f5ZugIHwg5aSH6YCJ5Y+K5pS+5byD5Y6f5ZugIHwg5pyq5Yaz6aG5L+W9seWTjSB8DQp8IC0tLS0gfCAtLS0tLS0tLSB8IC0tLS0tLS0tLS0gfCAtLS0tLS0tLS0tLS0tLSB8IC0tLS0tLS0tLS0tIHwNCnwgICAgICB8ICAgICAgICAgIHwgICAgICAgICAgICB8ICAgICAgICAgICAgICAgIHwgICAgICAgICAgICAgfA0KDQojIyDorr7orqHkuI7pqozor4ENCg0K5pWw5o2u44CB5o6l5Y+j44CB6ZSZ6K+v6Lev5b6E44CB6L+B56e7L+aBouWkjeOAgeacgOWwj+i/kOihjOmqjOivge+8m+S4jea2ieWPiueahOmDqOWIhuazqOaYjuWOn+WboOOAgg0KDQojIyDlj6/ni6znq4vpqozmlLbnmoTku7vliqENCg0KfCDmnKzlnLDku7vliqEgSUQgfCDlnLrmma8v6aqM5pS2IGtleSB8IOS+nei1liB8IOi0n+i0o+aWh+S7tiB8IOWPr+W5tuihjOWPiuS+neaNriB8IOmqjOivgeaWueazlSB8DQp8IC0tLS0tLS0tLS0tIHwgLS0tLS0tLS0tLS0tLSB8IC0tLS0gfCAtLS0tLS0tLSB8IC0tLS0tLS0tLS0tLSB8IC0tLS0tLS0tIHwNCnwgaW1wbC0wMSAgICAgfCBhYy0wMSAgICAgICAgIHwgICAgICB8ICAgICAgICAgIHwgICAgICAgICAgICAgIHwgICAgICAgICAgfA0KDQojIyDkuqTmjqXkuI7kvovlpJYNCg0K5o6l5pS26KeS6Imy44CB5YmN572u5p2h5Lu244CB5b6FIEhVTUFOIOWGs+WumueahOS6i+mhueOAgeWBj+emu+inhOiMg+eahOeQhueUseS4juWkjeafpeadoeS7tuOAgg0K5pys6K6h5YiS5YaF5Lu75Yqh5Li65o+Q5qGI77yM5q2j5byP5Lu75Yqh44CB5Z+657q/5LiO5om55YeG5LulIFdvcmtNZXNoIOW9k+WJjeS6i+WunuS4uuWHhuOAgg0K"
      },
      {
        "resourceId": "template-contract",
        "path": "roles/backend/assets/templates/contract.md",
        "sha256": "c086d25db18b0b855d35d8ee2ff6ad23aca79cfa33c007d6fb06e7b19b328f62",
        "byteLength": 1379,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDlpZHnuqbvvJo86ZyA5rGC5qCH6aKYPg0KDQo+IOmcgOaxgue8luWPt++8mjxQUk9KRUNUX0tFWT4tPOW6j+WPtz4gwrcg54mI5pys77yadjEgwrcg54q25oCB77ya6I2J56i/DQo+IOa2ieWPiuWNleWFg++8mjx1bml0LWtleT4gLyA8dW5pdC1rZXk+DQoNCiMjIDEuIOiMg+WbtA0KDQrmnKzmrKHmlrDlop7miJblj5jmm7Tlk6rkupvmjqXlj6PvvIzmtonlj4rlk6rkupvmlbDmja7jgIINCg0KIyMgMi4g5o6l5Y+jDQoNCiMjIyA8TUVUSE9EPiA8cGF0aD4NCg0KLSDnlKjpgJTvvJoNCi0g5YWl5Y+C77yaDQoNCnwg5a2X5q61IHwg57G75Z6LIHwg5b+F5aGrIHwg6K+05piOIHwNCnwgLS0tLSB8IC0tLS0gfCAtLS0tIHwgLS0tLSB8DQp8ICAgICAgfCAgICAgIHwgICAgICB8ICAgICAgfA0KDQotIOWHuuWPgu+8mg0KDQp8IOWtl+autSB8IOexu+WeiyB8IOivtOaYjiB8DQp8IC0tLS0gfCAtLS0tIHwgLS0tLSB8DQp8ICAgICAgfCAgICAgIHwgICAgICB8DQoNCi0g6ZSZ6K+v56CB77yaDQoNCnwg56CBICB8IEhUVFAgfCDlkKvkuYkgfCDop6blj5HmnaHku7YgfA0KfCAtLS0gfCAtLS0tIHwgLS0tLSB8IC0tLS0tLS0tIHwNCnwgICAgIHwgICAgICB8ICAgICAgfCAgICAgICAgICB8DQoNCiMjIDMuIOaVsOaNruWPmOabtA0KDQp8IOihqCAgfCDlj5jmm7QgfCDov4Hnp7vmlrnlvI8gfCDlm57mu5rmlrnlvI8gfA0KfCAtLS0gfCAtLS0tIHwgLS0tLS0tLS0gfCAtLS0tLS0tLSB8DQp8ICAgICB8ICAgICAgfCAgICAgICAgICB8ICAgICAgICAgIHwNCg0KIyMgNC4g5YW85a655oCnDQoNCi0g5pen5a6i5oi356uv5piv5ZCm5Y+X5b2x5ZON77yaDQotIOaYr+WQpumcgOimgeW5s+ihjOWPmOabtO+8iGV4cGFuZCAvIG1pZ3JhdGUgLyBjb250cmFjdO+8ie+8mg0KLSDkuIvnur/ml6fniYjnmoTmnaHku7bvvJoNCg0KIyMgNS4g5aSx6LSl5qih5byPDQoNCnwg5Zy65pmvICAgICAgIHwg6KGM5Li6IHwg5a+56LCD55So5pa555qE5Y+v6KeB5b2x5ZONIHwNCnwgLS0tLS0tLS0tLSB8IC0tLS0gfCAtLS0tLS0tLS0tLS0tLS0tLS0gfA0KfCDotoXml7YgICAgICAgfCAgICAgIHwgICAgICAgICAgICAgICAgICAgIHwNCnwg6ZmQ5rWBICAgICAgIHwgICAgICB8ICAgICAgICAgICAgICAgICAgICB8DQp8IOS4i+a4uOS4jeWPr+eUqCB8ICAgICAgfCAgICAgICAgICAgICAgICAgICAgfA0KDQojIyA2LiDmtojotLnmlrkNCg0KfCDop5LoibIgICAgIHwg55So6YCUIHwg5L2V5pe25Y+v5byA5belIHwNCnwgLS0tLS0tLS0gfCAtLS0tIHwgLS0tLS0tLS0tLSB8DQp8IGZyb250ZW5kIHwgICAgICB8ICAgICAgICAgICAgfA0KfCBxYSAgICAgICB8ICAgICAgfCAgICAgICAgICAgIHwNCnwgb3BzICAgICAgfCAgICAgIHwgICAgICAgICAgICB8DQo="
      },
      {
        "resourceId": "template-impl",
        "path": "roles/backend/assets/templates/impl.md",
        "sha256": "fab3b3d7ca14e415f88635ac28260b1f2fb5ba094c26b3f3c77b23929749f902",
        "byteLength": 954,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDlrp7njrDor7TmmI7vvJo86ZyA5rGC5qCH6aKYPg0KDQo+IOmcgOaxgue8luWPt++8mjxQUk9KRUNUX0tFWT4tPOW6j+WPtz4gwrcg5Lu75Yqh77yaPHRhc2sgY29kZT4NCj4g5o+Q5Lqk77yaPGNvbW1pdCBzaGE+IMK3IOWlkee6pueJiOacrO+8mnYxDQoNCiMjIDEuIOaUueWKqOiMg+WbtA0KDQp8IOWNleWFgyB8IOaooeWdlyB8IOaUueWKqCAgICAgICAgICAgICAgIHwNCnwgLS0tLSB8IC0tLS0gfCAtLS0tLS0tLS0tLS0tLS0tLS0gfA0KfCAgICAgIHwgICAgICB8IOaWsOWiniAvIOS/ruaUuSAvIOWIoOmZpCB8DQoNCiMjIDIuIOaOpeWPo+WPmOWMlg0KDQrkuI7lpZHnuqbkuIDoh7TnmoTpg6jliIbkuI3ph43lpI3vvJvmnInlgY/lt67nmoTlv4XpobvlnKjmraTor7TmmI7ljp/lm6DjgIINCg0KfCDmjqXlj6MgfCDlj5jljJYgfCDmmK/lkKblt7LmlLnlpZHnuqYgfA0KfCAtLS0tIHwgLS0tLSB8IC0tLS0tLS0tLS0tLSB8DQp8ICAgICAgfCAgICAgIHwgICAgICAgICAgICAgIHwNCg0KIyMgMy4g5pWw5o2u5Y+Y5pu0DQoNCi0g6L+B56e76ISa5pys77yaDQotIOWbnua7muiEmuacrO+8mg0KLSDmmK/lkKbmvJTnu4PvvJoNCg0KIyMgNC4g5rWL6K+VDQoNCnwg57G75Z6LIHwg6KaG55uWIHwg57uT5p6cIHwNCnwgLS0tLSB8IC0tLS0gfCAtLS0tIHwNCnwg5Y2V5YWDIHwgICAgICB8ICAgICAgfA0KfCDpm4bmiJAgfCAgICAgIHwgICAgICB8DQp8IOaJi+W3pSB8ICAgICAgfCAgICAgIHwNCg0KIyMgNS4g6aqM5pS26KaG55uWDQoNCnwg6aqM5pS2IGtleSB8IOivgeaNriB8DQp8IC0tLS0tLS0tIHwgLS0tLSB8DQp8IGFjLTAxICAgIHwgICAgICB8DQoNCiMjIDYuIOW3suefpemZkOWItg0KDQrvvIjmsqHmnInlsLHlhpnjgIzml6DjgI3vvIzkuI3opoHnlZnnqbrvvIkNCg0KIyMgNy4g5Zue5ruaDQoNCuinpuWPkeadoeS7tuOAgeatpemqpOOAgemqjOivgeaWueW8j+OAgg0K"
      },
      {
        "resourceId": "checklist-contract-quality",
        "path": "roles/backend/checklists/contract-quality.md",
        "sha256": "f7c00f5af385bc32cc2f6b47ee66b969eb6cbe56119454ec0cfb0f18f54415fa",
        "byteLength": 945,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDlpZHnuqbotKjph4/muIXljZUNCg0KLSBbIF0g5q+P5Liq5o6l5Y+j6YO95YaZ5LqG55So6YCU44CB5YWl5Y+C44CB5Ye65Y+C44CB6ZSZ6K+v56CB44CCDQotIFsgXSDlh7rlj4Llj6rmmrTpnLLosIPnlKjmlrnpnIDopoHnmoTlrZfmrrXvvIzmsqHmnInlhoXpg6jnu5PmnoTms4TmvI/jgIINCi0gWyBdIOmUmeivr+eggeWkjeeUqOS8mOWFiO+8m+aWsOWinueahOWGmeS6huWQq+S5ieS4juinpuWPkeadoeS7tuOAgg0KLSBbIF0g6Iez5bCR5YaZ5LqG5LiA5p2h5aSx6LSl6Lev5b6E77yI6LaF5pe2IC8g6ZmQ5rWBIC8g5LiL5ri45LiN5Y+v55So77yJ44CCDQotIFsgXSDmlbDmja7lj5jmm7TluKbov4Hnp7vkuI7lm57mu5rvvIzkuJTlm57mu5rmvJTnu4Pov4fjgIINCi0gWyBdIOWFvOWuueaAp+e7k+iuuuaYjuehru+8muaXp+WuouaIt+err+aYr+WQpuWPl+W9seWTje+8jOaYr+WQpumcgOimgeW5s+ihjOWPmOabtOOAgg0KLSBbIF0g5LiL57q/5pen54mI55qE5p2h5Lu25YaZ5riF5LqG44CCDQotIFsgXSDmtojotLnmlrnvvIjliY3nq6/jgIFRQeOAgei/kOe7tO+8ieS4juW8gOW3peadoeS7tuWGmea4heS6huOAgg0KLSBbIF0g5aWR57qm5LiOIFBSRCDnmoTpqozmlLblr7nlvpfkuIrvvIzmsqHmnInlpJrlgZrmiJblsJHlgZrjgIINCi0gWyBdIOWlkee6pumHjOeahOWtl+auteWRveWQjeS4jumhueebruinhOiMg+S4gOiHtOOAgg0KDQojIyDkuqTku5jliY3mnIDlkI7kuInpl64NCg0KMS4g5YmN56uv5Y+q55yL6L+Z5Lu95aWR57qm77yM6IO95LiN6IO95LiN6Zeu6Zeu6aKY5bCx5YaZ5Luj56CB77yfDQoyLiDnur/kuIrlh7rpl67popjml7bvvIzov5nku73lpZHnuqbog73kuI3og73op6Pph4rjgIzlupTor6XmmK/ku4DkuYjooYzkuLrjgI3vvJ8NCjMuIOWNiuW5tOWQjuimgeS4i+e6v+aXp+eJiO+8jOadoeS7tuWGmeW+l+Wkn+a4healmuWQl++8nw0K"
      },
      {
        "resourceId": "checklist-spec-driven",
        "path": "roles/backend/checklists/spec-driven.md",
        "sha256": "5caddca3baed2471f6b8ab97dbac3c0b07278c7a66ffeb6b35bdb93261ef77c9",
        "byteLength": 1266,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDop4TmoLzkuI7kuqTku5jljY/kvZzmo4Dmn6UNCg0K5Y+q5Yqg6L295pys5qyh5Lu75Yqh5raJ5Y+K55qE5qih5p2/5ZKM5riF5Y2V44CC566A5Y2V5pS55Yqo5YaZ5b+F6KaB5L+h5oGv77yb5aSN5p2C5bqm5p2l6Ieq6aOO6Zmp44CB5L6d6LWW5ZKM6aqM5pS26IyD5Zu077yM5LiN5oyJ5Zu65a6a6aG15pWw5oiW56ug6IqC5pWw5Yik5pat6LSo6YeP44CCDQoNCi0gWyBdIOW3suivu+acrOasoeW/q+eFp+S4jumhueebruinhOiMg++8jOehruiupCBQUkQv55+l6K+G5L+u6K6i77yb6ICB6aG555uu5YWI5qC45a+55a6e6ZmF5Luj56CB44CB5bel5YW36YWN572u5LiO546w5pyJ6KGM5Li644CCDQotIFsgXSDlhbPplK7nu5PorrrmnInmnaXmupDvvJvosIPmn6XmnKrnn6XpobnjgIHmlrnmoYjlj5boiI3jgIHkvovlpJbkuI7lu7bmnJ/lnYfmnInnkIbnlLHlkozotKPku7vkurrjgIINCi0gWyBdIOS7peW3suehruiupOmqjOaUtiBrZXkg5YWz6IGU5pys6KeS6Imy5Lqn54mp77yb5Lu75Yqh5YiX5L6d6LWW44CB6LSf6LSj5paH5Lu25LiO6aqM6K+B5pa55byP77yM5YWx55So5paH5Lu25LiN5peg5L6d5o2u5Zyw5bm26KGM5L+u5pS544CCDQotIFsgXSDlpJrlnLrmma/orqHliJLmmI7noa7mnIDlsI/nq6/liLDnq68gUDEvTVZQIOWIh+eJh+OAgeeLrOeri+mqjOivgeajgOafpeeCueWSjOW7tuacn+adoeS7tu+8m+eugOWNleS7u+WKoeS4jeW8uuWItuWIhuacn+OAgg0KLSBbIF0g6ZyA5rGC6LSo6YeP44CB55So5L6L6K6+6K6h6KaG55uW44CB5a6e6ZmF5omn6KGM57uT5p6c5ZKMIEhVTUFOIOato+W8j+mqjOaUtuWIhuWIq+iusOW9leOAgg0KLSBbIF0g5omA5pyJ5pyq6L+Q6KGM44CB5aSx6LSl44CB6Zi75aGe44CB5peg5rOV5qC46aqM55qE5YaF5a655piO56Gu5qCH5Ye677ybQWdlbnQg5oql5ZGK5LiN5aOw56ew54us56uL6aqM6K+B44CCDQotIFsgXSDnvLrlj6Pku6XnqLPlrpogSUQg6L+95Yqg5bm25Zue6ZO+5Y6f6K6w5b2V77yb6LaF5Ye66ZyA5rGC6IyD5Zu05YWI6LWw5Y+Y5pu077yM5L+u5pS55Z+657q/5ZCO6YeN5paw5qC45a+56K+B5o2u44CCDQoNCuinkuiJsui1hOa6kOabtOaWsO+8muW3sumUgeWumueJiOacrOS/neaMgeWOn+Wtl+iKgu+8jOaWsOaWueazleWcqOaWsOWMheeJiOacrOWuieijheWQjueUn+aViOOAguWuv+S4u+WFpeWPo+WPquaMh+WQkeinkuiJsui1hOa6kO+8m+mhueebruiHquWumuS5ieinhOiMg+maj+mhueebruefpeivhuS/ruiuou+8jOS4jeWkjeWItui/m+inkuiJsuWMheOAgg0K"
      },
      {
        "resourceId": "guide",
        "path": "roles/backend/guide.md",
        "sha256": "b62c509417267920fc3ecb9f91d09124439932dda2586674ee5b84568a163fd8",
        "byteLength": 4054,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDlkI7nq6/op5LoibLvvIhiYWNrZW5k77yJDQoNCuS9oOaMieW9k+WJjeS7u+WKoeWjsOaYjueahOi+k+WHuuS6p+WHuuaOpeWPo+Wlkee6puWAmemAie+8iGBLTk9XTEVER0Vg77yJ5oiW5a6e546w77yIYElNUExg77yJ77ya5o6l5Y+j44CB5pWw5o2u5Y+Y5pu044CB6L+B56e75LiO5Zue5rua6K+05piO44CCDQrkvaDnmoTkuqTku5jlv4Xpobvog73ooqvkurrnsbvnlKjmj5DkuqTnuqfor4Hmja7lpI3moLjjgIINCg0KIyMg6L6555WMDQoNCi0g6KeS6Imy5YyF5pSv5oyB5aWR57qm5YCZ6YCJIGBLTk9XTEVER0VgIOS4juWunueOsCBgSU1QTGDvvJvmnKzmrKHlj6rog73kuqTku5jlvZPliY3mtYHnqIvmraXpqqTlo7DmmI7nmoTnsbvlnovvvIzkuI3og73lnKjlj6rlo7DmmI4gYElNUExgIOeahOS7u+WKoeS4reaTheiHquWinuWKoOWlkee6puW3peS7tuOAgg0KLSDlpZHnuqborr7orqHlkI7kuqQgSFVNQU4g5a6h5p+l44CB5Y+R5biD5bm257uR5a6a57uZ5YmN56uv562J5o6l5pS26KeS6Imy77yb5o+Q5Lqk5YCZ6YCJ5LiN5Luj6KGo5aWR57qm5bey57uP55Sf5pWI44CC5LiN5pS5IFBSROOAgeS4jeaUuea1geeoi+WumuS5ieOAgeS4jeWPkeW4g+OAgeS4jeaJueWHhuOAgg0KLSDmtonlj4rmlbDmja7lupPml7bvvIzkuqTku5jlv4XpobvljIXlkKsqKuWPr+Wbnua7mioq55qE6L+B56e75LiO6aqM6K+B5pa55byP77yb5LiN5Y+v6YCG5pON5L2c6KaB5pi+5byP5YaZ6L+bIHN1bW1hcnnjgIINCi0g5om55YeG5Y+q5Y+R55Sf5ZyoIFdlYiDor4TlrqHpobXvvIznlLEgSFVNQU4g5a6M5oiQ44CCDQoNCiMjIOS4gOasoeWujOaVtOW+queOrw0KDQpgYGBiYXNoDQp3b3JrbWVzaCBhdXRoIGxvZ2luDQoNCndvcmttZXNoIGNvbnRleHQgLS10YXNrIDx0YXNrSWQ+IC0taW5zcGVjdA0Kd29ya21lc2ggY2xhaW0gLS10YXNrIDx0YXNrSWQ+DQp3b3JrbWVzaCBjb250ZXh0IC0tdGFzayA8dGFza0lkPiAtLWNsYWltIDxjbGFpbUlkPiAtLWV4cGVjdGVkLXZlcnNpb24gPHRhc2tWZXJzaW9uPiAtLW1hdGVyaWFsaXplDQoNCmNhdCAud29ya21lc2gvbG9jYWwvY29udGV4dC88c25hcHNob3RJZD4vbWFuaWZlc3QuanNvbiAgICMg56Gu6K6k5Z+657q/DQpnaXQgcmV2LXBhcnNlIEhFQUQgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIyDlj5blrozmlbQgY29tbWl0IHNoYQ0KDQp3b3JrbWVzaCBkZWxpdmVyIFwNCiAgLS10YXNrIDx0YXNrSWQ+IC0tY2xhaW0gPGNsYWltSWQ+IC0tc25hcHNob3QgPHNuYXBzaG90SWQ+IFwNCiAgLS1leHBlY3RlZC12ZXJzaW9uIDx0YXNrVmVyc2lvbj4gXA0KICAtLW1hbmlmZXN0IGRlbGl2ZXItbWFuaWZlc3QuanNvbg0KDQojIOS9v+eUqCBkZWxpdmVyIOi/lOWbnueahOecn+WuniByZXZpZXdSZXF1ZXN0SWQg5p+l6K+i6Ieq5Yqo5Yib5bu655qE6K+E5a6hDQp3b3JrbWVzaCByZXZpZXcgc2hvdyAtLXJldmlldyA8cmV2aWV3UmVxdWVzdElkPg0KYGBgDQoNCmBkZWxpdmVyYCDov5Tlm54gYHJldmlld1JlcXVlc3RJZGDjgIFXZWIg5Zyw5Z2A5ZKMIGBvcGVyYXRpb25JZGDvvIzkuI3nlKjlho3mrKHliJvlu7rlkIzkuIDova7or4TlrqHjgILovpPlh7rkuKLlpLHml7bvvIznlKggYHdvcmttZXNoIHJlY2VpcHQgc2hvdyAtLW9wZXJhdGlvbiA85Y6f5Lqk5LuYb3BlcmF0aW9uSWQ+IC0tanNvbmAg6K+75Y+WIGBkYXRhLnJlc3VsdFJlZnMucmV2aWV3UmVxdWVzdElkYO+8m+aUtuaNruS7jeS4uiBQRU5ESU5HIOaIlue7k+aenOacquefpeaXtu+8jOWFiOeUqOWOn+aTjeS9nOe8luWPt+aJp+ihjCBgd29ya21lc2ggcmVjZWlwdCByZWNvbmNpbGUgLS1vcGVyYXRpb24gPOWOn+S6pOS7mG9wZXJhdGlvbklkPmDjgILmraPlvI/lhrPlrprku43nlLEgSFVNQU4g5ZyoIFdlYiDlrozmiJDjgIINCg0KIyMgZGVsaXZlciBtYW5pZmVzdCDopoHngrkNCg0KYGBganNvbg0Kew0KICAid29ya2Zsb3dEZWZpbml0aW9uUmV2aXNpb25JZCI6ICI8c25hcHNob3Qg6YeM6K6w5b2V55qEIHdvcmtmbG93IOS/ruiuoj4iLA0KICAibG9jYWxSdW5JZCI6ICI85pys5Zyw5Y+v5aSN546w55qE6L+Q6KGM5qCH6K+GPiIsDQogICJpdGVtcyI6IFsNCiAgICB7DQogICAgICAia2luZCI6ICJJTVBMIiwNCiAgICAgICJzdG9yYWdlIjogIkdJVF9SRUYiLA0KICAgICAgIm1lZGlhVHlwZSI6ICJ0ZXh0L3BsYWluIiwNCiAgICAgICJzaGEyNTYiOiAiPOaWh+S7tuaIluihpeS4geeahCBzaGEyNTY+IiwNCiAgICAgICJieXRlTGVuZ3RoIjogODE5MiwNCiAgICAgICJwcm9qZWN0UmVwb3NpdG9yeUlkIjogIjzpobnnm67lt7LnmbvorrDku5PlupMgaWQ+IiwNCiAgICAgICJjb21taXRTaGEiOiAiPDQwIOS9jeWwj+WGmSBoZXg+IiwNCiAgICAgICJyZXBvUGF0aCI6ICJhcHBzL2FwaS9zcmMvb3JkZXJzL29yZGVycy5zZXJ2aWNlLnRzIiwNCiAgICAgICJzdW1tYXJ5IjogIuaWsOWinuiuouWNleWPlua2iOaOpeWPo++8m+i/geenuyAwMDA0IOWPr+Wbnua7miIsDQogICAgICAiY2hlY2tzIjogWw0KICAgICAgICB7ICJjb2RlIjogInR5cGUtY2hlY2siLCAicGFzc2VkIjogdHJ1ZSB9LA0KICAgICAgICB7ICJjb2RlIjogImludGVncmF0aW9uLXRlc3QiLCAicGFzc2VkIjogdHJ1ZSB9DQogICAgICBdDQogICAgfQ0KICBdDQp9DQpgYGANCg0KLSDpnIDopoHmiZjnrqHmraPmlofvvIjkvovlpoLov4Hnp7vohJrmnKzjgIHmjqXlj6PlpZHnuqbvvInml7bnlKggYCJzdG9yYWdlIjogIkhPU1RFRCJgICsgYGJvZHlCYXNlNjRg44CCDQotIOi9r+S7tuS6pOS7mOaooeadv+m7mOiupOWkjeeUqOmhueebruW3suWPkeW4g+eahOaOpeWPo+Wlkee6puWSjOezu+e7n+WNleWFg+ivtOaYjuOAgue8uuWwkei1hOaWmeaXtuWFiOiuqemhueebrueuoeeQhuWRmOWNj+iwg+WHhuWkh+OAgeWPkeW4g+S4juinkuiJsue7keWumu+8m+S4jeimgeaKiuWunueOsOS6pOS7mOW9k+aIkOefpeivhuWPkeW4g+OAgg0KLSBgY2hlY2tzYCDkvJrlsZXnpLrnu5nor4TlrqHkurrvvIzkuI3opoHloavlhpnmnKrmiafooYznmoTmo4Dmn6XjgIINCg0KIyMg56aB5q2iDQoNCi0g5LiN6KaB5Zyo5rKh5pyJ5Zue5rua5pa55qGI55qE5oOF5Ya15LiL5Lqk5LuY56C05Z2P5oCn6L+B56e744CCDQotIOS4jeimgeaKiuWHreaNruOAgei/nuaOpeS4suOAgeWvhumSpeWGmei/myBtYW5pZmVzdCDmiJblt6Xku7bmraPmlofjgIINCi0g5LiN6KaB55So5Yir5Lq655qE5b+r54Wn5oiW6L+H5pyfIGNsYWltIOS6pOS7mOOAgg0KDQojIyDlpLHotKXkuI7ph43or5UNCg0KLSDlhpnmk43kvZzkuI3oh6rliqjph43or5XvvJvph43mlL7lpI3nlKjlkIzkuIDkuKogYC0tb3BlcmF0aW9uIDx1dWlkPmDjgIINCi0g57uT5p6c5LiN5piO77yaYHdvcmttZXNoIHJlY2VpcHQgc2hvdyAtLW9wZXJhdGlvbiA8dXVpZD5gIOKGkiDpnIDopoHml7YgYHdvcmttZXNoIHJlY2VpcHQgcmVjb25jaWxlYOOAgg0KLSDooqvopoHmsYLkv67mlLnvvJrmjInlvZPliY3ku7vliqHlkowgY2xhaW0g54q25oCB6L+U5L+u5ZCO6YeN5pawIGBkZWxpdmVyYO+8jOWGjeeUqOacrOi9rui/lOWbnueahCBgcmV2aWV3UmVxdWVzdElkYCDmiafooYwgYHJldmlldyBzaG93YO+8m+aWsOS6pOS7mOS8muiHquWKqOWIm+W7uuacrOi9ruivhOWuoeOAgg0KDQojIyDop4TmoLzkuI7kuqTku5joh6rmo4ANCg0K5byA5bel5oiW6L+U5L+u5pe25oyJIGBjaGVja2xpc3RzL3NwZWMtZHJpdmVuLm1kYCDmoLjlr7nojIPlm7TjgIHkvp3mja7jgIHniYjmnKzkuI7kuqTmjqXvvJvlj6ror7vlj5blvZPliY3pmLbmrrXpnIDopoHnmoTotYTmupDjgIINCuWkjeadguaUueWKqOS9v+eUqCBgcGxhbi1jaGFuZ2VgIOWSjCBgY2hhbmdlLXBsYW4ubWRg77yM5YWI6LCD5p+l546w54q244CB6K6w5b2V5Y+W6IiN77yM5YaN5oyJ5Y+v54us56uL6aqM5pS255qE5Zy65pmv5a6J5o6S5Lu75Yqh44CCDQrlt7LmnInooYzkuLrmjZ/lnY/kvb/nlKggYGRpYWdub3NlLWJ1Z2DvvJvkv53nlZnljp/lp4vlpI3njrDvvIzpmZDlrprmoLnlm6Dkv67lpI3ojIPlm7TvvIzmnIDlkI7ph43ot5Hljp/lp4vlpI3njrDlkoznm7jlhbPlm57lvZLjgIINCg=="
      },
      {
        "resourceId": "reference-references",
        "path": "roles/backend/references/references.json",
        "sha256": "896c6298825f963e086416acbf7d361edd9c4a0768e87490fb053ea2744b6798",
        "byteLength": 672,
        "mediaType": "application/json",
        "bodyBase64": "ew0KICAidmVyc2lvbiI6IDEsDQogICJub3RlIjogIuWPquaUvuaMh+mSiO+8jOS4jeaUvuato+aWh+OAgnNjb3BlOiBQUk9KRUNUIHwgVU5JVCB8IFJPTEXjgILot6/lvoTlnKjov5DooYzml7bnlLHlv6vnhafop6PmnpDjgIIiLA0KICAiZW50cmllcyI6IFsNCiAgICB7DQogICAgICAia2V5IjogInVuaXQtY2FyZCIsDQogICAgICAic2NvcGUiOiAiVU5JVCIsDQogICAgICAicmVmIjogImtub3dsZWRnZTovLzxwcm9qZWN0LWtleT4vc3lzdGVtLzx1bml0LWtleT4vY2FyZCINCiAgICB9LA0KICAgIHsNCiAgICAgICJrZXkiOiAiY29udmVudGlvbnMiLA0KICAgICAgInNjb3BlIjogIlBST0pFQ1QiLA0KICAgICAgInJlZiI6ICJrbm93bGVkZ2U6Ly88cHJvamVjdC1rZXk+L3N5c3RlbS9jb252ZW50aW9ucyINCiAgICB9LA0KICAgIHsNCiAgICAgICJrZXkiOiAiYXBpLWNvbnRyYWN0IiwNCiAgICAgICJzY29wZSI6ICJVTklUIiwNCiAgICAgICJyZWYiOiAia25vd2xlZGdlOi8vPHByb2plY3Qta2V5Pi9zeXN0ZW0vPHVuaXQta2V5Pi9jb250cmFjdCINCiAgICB9LA0KICAgIHsNCiAgICAgICJrZXkiOiAiYWRyIiwNCiAgICAgICJzY29wZSI6ICJQUk9KRUNUIiwNCiAgICAgICJyZWYiOiAia25vd2xlZGdlOi8vPHByb2plY3Qta2V5Pi9zeXN0ZW0vYWRyIg0KICAgIH0NCiAgXQ0KfQ0K"
      },
      {
        "resourceId": "skill-attach-evidence",
        "path": "roles/backend/skills/attach-evidence/SKILL.md",
        "sha256": "c89b895f6b2ff66c17c6c6759425a196199f67ada65f9e1dd02bd6a6b1e6b6cd",
        "byteLength": 1572,
        "mediaType": "text/markdown",
        "bodyBase64": "LS0tDQpuYW1lOiBhdHRhY2gtZXZpZGVuY2UNCmRlc2NyaXB0aW9uOiDmlLbpm4bmj5DkuqTnuqfor4Hmja7kuI7mo4Dmn6Xnu5PmnpzvvIznu4TmiJDlj6/lpI3moLjnmoTkuqTku5jlt6Xku7bpm4bvvJvlvZPlrp7njrDlrozmiJDjgIHlh4blpIfkuqTku5jml7bkvb/nlKjjgIINCmxpY2Vuc2U6IE1JVA0KbWV0YWRhdGE6DQogIHJvbGVLZXk6IGJhY2tlbmQNCiAgcGFja2FnZVZlcnNpb246IDAuMS4wDQotLS0NCg0KIyDpmYTnnYDor4Hmja4NCg0KIyMg5L2V5pe255SoDQoNCi0g5a6e546w5a6M5oiQ77yM5YeG5aSH5Lqk5LuY44CCDQotIOmcgOimgeihpeS6pOS4iuS4gOi9rue8uuWkseeahOivgeaNruOAgg0KDQojIyDmraXpqqQNCg0KMS4g5YiX6K+B5o2u77ya5o+Q5LqkIFNIQeOAgea1i+ivlee7k+aenOOAgWxpbnTjgIHnsbvlnovmo4Dmn6XjgIHov4Hnp7vpqozor4HjgIINCjIuIOWGmSBgY2hlY2tzW11g77ya5q+P6aG5IGBjb2RlYOOAgWBwYXNzZWRg44CBYG1lc3NhZ2Vg44CCDQozLiDmoLjlr7nopobnm5bvvJrmr4/mnaHooqvmnKzku7vliqHopobnm5bnmoTpqozmlLbvvIzmmK/lkKbpg73mnInlr7nlupTor4Hmja7jgIINCjQuIOS6pOS7mO+8mkhPU1RFRCDkvKDlrZfoioLvvIxHSVRfUkVGIOe7meS7k+W6k+WumuS9jeOAgeaPkOS6pCBTSEEg5LiO6Lev5b6E44CCDQo1LiDlpLHotKXpobnlhpnmmI7ljp/lm6DkuI7lvbHlk43vvIzkuI3pmpDol4/jgIINCg0KIyMg6KeE5YiZDQoNCi0gKirlj6rkuqTlj6/moKHpqoznmoTor4Hmja4qKu+8muiDveWkjei3keeahOa1i+ivleOAgeiDveWumuS9jeeahOaPkOS6pOOAgg0KLSAqKuS4jeS8qumAoOmAmui/hyoq77ya5rKh6LeR55qE5qOA5p+l5qCHIGBwYXNzZWQ6IGZhbHNlYCDlubblhpnljp/lm6DvvIzmr5TnvJbkuIDkuKrpgJrov4flvLrjgIINCi0gKirml6fln7rnur/mi5Lnu50qKu+8muS6pOS7mOW/hemhu+e7keWumuacrOasoeS7u+WKoeeahOW/q+eFp++8m+aNouWfuue6v+imgemHjeaWsOWPluW/q+eFp+OAgg0KLSAqKuivgeaNruS4jumqjOaUtuWvuem9kCoq77yaYElOU1BFQ1RJT05gIOexu+ivgeaNruimgee7meS6uueci++8iOaIquWbvuOAgemTvuaOpe+8ie+8jGBURVNUYCDnsbvnu5nlj6/lpI3ot5HnmoTnu5PmnpzjgIINCg0KIyMgY2hlY2tzIOekuuS+iw0KDQpgYGBqc29uDQpbDQogIHsgImNvZGUiOiAidHlwZS1jaGVjayIsICJwYXNzZWQiOiB0cnVlIH0sDQogIHsgImNvZGUiOiAidW5pdC10ZXN0IiwgInBhc3NlZCI6IHRydWUsICJtZXNzYWdlIjogIjEyOCBwYXNzZWQiIH0sDQogIHsgImNvZGUiOiAibWlncmF0aW9uLXJvbGxiYWNrIiwgInBhc3NlZCI6IHRydWUgfSwNCiAgeyAiY29kZSI6ICJwZXJmLXA5NSIsICJwYXNzZWQiOiBmYWxzZSwgIm1lc3NhZ2UiOiAiUDk1IDEuMnPvvIzotoXov4cgODAwbXMg6ZiI5YC8IiB9DQpdDQpgYGANCg0KIyMg5Lqk5o6lDQoNCuS6pOS7mCBgQXJ0aWZhY3RTZXRg77yM6L+b5YWlIGBSRVZJRVdfUEVORElOR2DvvJvmibnlh4bjgIHov5Tkv67jgIHmkqTplIDpg73nlLHkurrlnKggV2ViIOS9nOWHuu+8jEFnZW50IOS4jeiHquihjOWFs+mXqOOAgg0K"
      },
      {
        "resourceId": "skill-design-contract",
        "path": "roles/backend/skills/design-contract/SKILL.md",
        "sha256": "e544e5b367f3e9b47e39fef78e97157993289c0629ce8959b287ccf10fe3216a",
        "byteLength": 1837,
        "mediaType": "text/markdown",
        "bodyBase64": "LS0tDQpuYW1lOiBkZXNpZ24tY29udHJhY3QNCmRlc2NyaXB0aW9uOiDku44gUFJEIOS4jumqjOaUtuaOqOWvvOaOpeWPo+Wlkee6puOAgeaVsOaNruWPmOabtOS4jumUmeivr+egge+8jOS9nOS4uuWJjeerr+WSjOa1i+ivleW5tuihjOW8gOW3peeahOWFseWQjOWPgueFp++8m+W9kyBQUkQg5bCx57uq44CB6ZyA6KaB5a6a5aWR57qm5pe25L2/55So44CCDQpsaWNlbnNlOiBNSVQNCm1ldGFkYXRhOg0KICByb2xlS2V5OiBiYWNrZW5kDQogIHBhY2thZ2VWZXJzaW9uOiAwLjEuMA0KLS0tDQoNCiMg6K6+6K6h5aWR57qmDQoNCiMjIOS9leaXtueUqA0KDQotIFBSRCDlt7Llj5HluIPvvIzlvIDlt6XliY3pnIDopoHnoa7lrprmjqXlj6PkuI7mlbDmja7lj5jmm7TjgIINCi0g5bey5pyJ5aWR57qm6ZyA6KaB6ZqP6ZyA5rGC5Y+Y5pu05Y2H54mI44CCDQoNCiMjIOatpemqpA0KDQoxLiDor7sgUFJEIOeahOebruagh+OAgeiMg+WbtOS4jumqjOaUtu+8jOWIl+WHuumcgOimgeaatOmcsueahOiDveWKm+OAgg0KMi4g5om+5Y+X5b2x5ZON5Y2V5YWD77ya5pys5pyN5Yqh44CB5LiK5LiL5ri45pyN5Yqh44CB5aSW6YOo57O757uf44CCDQozLiDlrprkuYnmjqXlj6PvvJrot6/lvoTjgIHmlrnms5XjgIHlhaXlj4LjgIHlh7rlj4LjgIHliIbpobXjgIHplJnor6/noIHjgIINCjQuIOWumuS5ieaVsOaNruWPmOabtO+8muihqOe7k+aehOOAgei/geenu+OAgeWbnua7muOAgeWFvOWuueeql+WPo+OAgg0KNS4g5YaZ5aSx6LSl5qih5byP77ya6LaF5pe244CB6ZmQ5rWB44CB5LiL5ri45LiN5Y+v55So5pe255qE6KGM5Li644CCDQo2LiDkuqflh7ogYGNvbnRyYWN0Lm1kYO+8jOWQjOatpee7meWJjeerr+S4jiBRQeOAgg0KDQojIyDop4TliJkNCg0KLSDlpZHnuqblhYjkuo7lrp7njrDvvJrmsqHmnInlpZHnuqbkuI3orqnliY3nq6/lvIDlt6XjgIINCi0g5ZCR5ZCO5YW85a655LyY5YWI77ya56C05Z2P5oCn5Y+Y5pu06LWw5bmz6KGM5Y+Y5pu077yIZXhwYW5kIOKGkiBtaWdyYXRlIOKGkiBjb250cmFjdO+8ieOAgg0KLSDplJnor6/noIHnqLPlrprvvJrlpI3nlKjlt7LmnInplJnor6/noIHvvIzmlrDlop7opoHlhpnmuIXlkKvkuYnkuI7op6blj5HmnaHku7bjgIINCi0g5LiN5rOE6Zyy5YaF6YOo57uT5p6E77ya5Ye65Y+C5Y+q5pq06Zyy6LCD55So5pa56ZyA6KaB55qE5a2X5q6144CCDQotIOavj+S4quaOpeWPo+iHs+WwkeWGmeS4gOadoeWksei0pei3r+W+hO+8jOWPquWGmSBoYXBweSBwYXRoIOeahOWlkee6puS4jeeul+WujOaIkOOAgg0KDQojIyDlubPooYzlj5jmm7QNCg0K56C05Z2P5oCn5Y+Y5pu05YiG5LiJ5q2l77yM5LiN5YWB6K645LiA5q2l5Yiw5L2N77yaDQoNCjEuICoqRXhwYW5kKirvvJrmlrDml6fkuKTniYjlubblrZjvvIzml6fniYjkuI3liqjjgIINCjIuICoqTWlncmF0ZSoq77ya5YmN56uv5LiO6LCD55So5pa55YiG5om56L+B56e744CCDQozLiAqKkNvbnRyYWN0KirvvJrlhajpg6jov4Hnp7vlkI7lho3kuIvnur/ml6fniYjjgIINCg0KIyMg5Lqk5o6lDQoNCuS6p+WHuiBgY29udHJhY3QubWRgIOWAmemAie+8jOS6pOWJjeerr+OAgVFB44CB6L+Q57u056Gu6K6k44CCSFVNQU4g5Y+R5biD5bm257uR5a6a5Yiw5o6l5pS26KeS6Imy5ZCO77yM5YmN56uv5Y+v5Lul54Wn5aWR57qm5YaZ6YC76L6R5LiOIG1vY2vvvIxRQSDlj6/ku6XnhaflpZHnuqblhpnnlKjkvovjgILlj6rmnInmtYHnqIvmraXpqqTlo7DmmI4gYEtOT1dMRURHRWAg6L6T5Ye65pe25omN6IO95L2c5Li66K+l5Lu75Yqh5bel5Lu25Lqk5LuY77yb5Y+q5aOw5piOIGBJTVBMYCDnmoTlrp7njrDku7vliqHkuI3mjojkuojlpZHnuqblj5HluIPmnYPpmZDjgIINCg=="
      },
      {
        "resourceId": "skill-diagnose-bug",
        "path": "roles/backend/skills/diagnose-bug/SKILL.md",
        "sha256": "c44f5165655f55118567a642ce6f780239545010c88f4cdd6d92aa6bf2074e47",
        "byteLength": 1252,
        "mediaType": "text/markdown",
        "bodyBase64": "LS0tDQpuYW1lOiBkaWFnbm9zZS1idWcNCmRlc2NyaXB0aW9uOiDku6Xljp/lp4vlpI3njrDlkozku6PnoIHor4Hmja7or4rmlq3nvLrpmbfjgIHpmZDlrprkv67lpI3ojIPlm7TlubblronmjpLlpI3pqozvvJvlvZPml6LmnInooYzkuLrmjZ/lnY/ogIzpnZ7mlrDlop7kuqflk4HojIPlm7Tml7bkvb/nlKjjgIINCmxpY2Vuc2U6IE1JVA0KbWV0YWRhdGE6DQogIHJvbGVLZXk6IGJhY2tlbmQNCi0tLQ0KDQojIOiviuaWreS4juS/ruWkjee8uumZtw0KDQoxLiDkv53lrZjljp/miqXlkYrjgIHpooTmnJ/kuI7lrp7pmYXooYzkuLrjgIHmnIDlsI/lpI3njrDjgIHniYjmnKzlkoznjq/looPjgILkuI3og73lpI3njrDml7blhpnmnaHku7bkuI7nvLrlj6PvvIzkuI3lhYjnjJzljp/lm6DmlLnku6PnoIHjgIINCjIuIOiviuaWremYtuauteWPquivu+iwg+afpeS7o+eggeOAgeaXpeW/l+WSjOebuOWFs+Wlkee6pu+8jOWMuuWIhuS6p+WTgee8uumZt+OAgeeUqOS+i+mUmeivr+OAgeeOr+Wig+mXrumimOS4juaWsOWinumcgOaxguOAgg0KMy4g6K6w5b2V5qC55Zug6K+B5o2u44CB5Y+X5b2x5ZON5qih5Z2X44CB5pyA5bCP5L+u5aSN44CB5Zue5b2S6aOO6Zmp5Y+K6aqM6K+B5pa55qGI44CC5bey5pyJ6IyD5Zu05LiO5o6I5p2D6Laz5aSf5pe257un57ut5L+u5aSN77yb5paw5aKe6IyD5Zu05Lqk546w5pyJ5Y+Y5pu05rWB56iL5Yaz5a6a44CCDQo0LiDlrp7njrDlj6rkv67lt7LlrprkvY3ljp/lm6DvvIzlgY/nprvorqHliJLnlZnkuIvkvp3mja7jgILmjInpo47pmanooaXmnInmhI/kuYnnmoTlm57lvZLmo4Dmn6XvvJvnm7jlhbPmtYvor5XpgJrov4flkI7lv4Xpobvph43ot5Hljp/lp4vlpI3njrDjgIINCjUuIOiusOW9leWOn+Wni+mXrumimOW3suWkjemqjOOAgemDqOWIhumqjOivgeaIluS7jeWksei0pe+8jOmZhOWunumZheWRveS7pOS4jue7k+aenOOAgua1i+ivleWll+S7tuWFqOe7v+S4jeiDveabv+S7o+WOn+Wni+WkjeeOsO+8m+e8uueOr+Wig+S4jeiDveWGmeW3suS/ruWkjeOAgg0KNi4g5oqK6K+K5pat44CB5L+u5aSN44CB6aqM6K+B6K6w5b2V5ZCI5bm26L+bIGBpbXBsLm1kYO+8jOS6pCBRQSDmjIkgYGF1ZGl0LWRlbGl2ZXJ5YCDlpI3moLjlkowgSFVNQU4g6aqM5pS244CCDQoNCuWwj+iMg+WbtOe8uumZt+S4jeW8uuWItumHjeWGmeWujOaVtCBQUkTvvJvmraPlvI/ku7vliqHku43pnIDlvZPliY3ln7rnur/jgIHorqTpooblkozkuqTku5jvvIzkuI3nu5Xov4fml6LmnInmibnlh4bjgIINCg=="
      },
      {
        "resourceId": "skill-implement-change",
        "path": "roles/backend/skills/implement-change/SKILL.md",
        "sha256": "2617ab24c9474a3f18fec4d90572838d5cda31e7feeca972a77f4e142c39d444",
        "byteLength": 1445,
        "mediaType": "text/markdown",
        "bodyBase64": "LS0tDQpuYW1lOiBpbXBsZW1lbnQtY2hhbmdlDQpkZXNjcmlwdGlvbjog5oyJ5bey5Y+R5biD5aWR57qm5a6e546w5Luj56CB77yM5Zue6ZO+6ZyA5rGC57yW5Y+35bm25a6M5oiQ6Ieq5rWL77yM5Lqn5Ye65a6e546w6K+05piO77yb5b2T5aWR57qm5bey5Y+R5biD44CB5Lu75Yqh5bey6K6k6aKG5pe25L2/55So44CCDQpsaWNlbnNlOiBNSVQNCm1ldGFkYXRhOg0KICByb2xlS2V5OiBiYWNrZW5kDQogIHBhY2thZ2VWZXJzaW9uOiAwLjEuMA0KLS0tDQoNCiMg5a6e546w5Y+Y5pu0DQoNCiMjIOS9leaXtueUqA0KDQotIOWlkee6puW3suWPkeW4g++8jOS7u+WKoeW3suiupOmihuOAgg0KLSDpnIDopoHlnKjml6LmnInmnI3liqHkuIrlgZrlop7ph4/mlLnliqjjgIINCg0KIyMg5q2l6aqkDQoNCjEuIOWPluS4iuS4i+aWh++8mlBSRCDpqozmlLbjgIHlpZHnuqbjgIHljZXlhYPljaHjgIHpobnnm67op4TojIPjgIINCjIuIOWumuS9jeaUueWKqOmdou+8muaooeWdl+OAgeaOpeWPo+OAgeihqOOAgeWPl+W9seWTjeiwg+eUqOaWueOAgg0KMy4g57yW56CB77ya5oyJ5aWR57qm5a6e546w77yM5LiN5pOF6Ieq5omp5bGV5o6l5Y+j44CCDQo0LiDoh6rmtYvvvJrmraPluLjot6/lvoTjgIHovrnnlYzjgIHplJnor6/ot6/lvoTjgIHmnYPpmZDjgIINCjUuIOaPkOS6pO+8mmNvbW1pdCDmraPmlofluKbpnIDmsYLnvJblj7fkuI7ku7vliqHnvJblj7fjgIINCjYuIOS6p+WHuiBgaW1wbC5tZGDjgIINCg0KIyMg6KeE5YiZDQoNCi0g5LiN6IeG6YCg5o6l5Y+j77ya5aWR57qm6YeM5rKh5pyJ55qE5a2X5q615LiN5Yqg77yb56Gu5a6e6ZyA6KaB5bCx5Zue6Zeu77yM6LWw5Y+Y5pu044CCDQotIOS4jei3s+i/h+i/geenu++8muaVsOaNruWPmOabtOW/hemhu+W4pui/geenu+S4juWbnua7muaWueahiOOAgg0KLSDms6jph4rlj6rlhpnjgIzkuLrku4DkuYjjgI3vvIzkuI3lpI3ov7Dku6PnoIHvvJtUT0RPIOW4pui0n+i0o+S6uuWSjOacn+mZkOOAgg0KLSDkuI3mlLnlhbbku5bop5LoibLnmoTlt6Xku7bvvJrlpZHnuqblvZLlkI7nq6/vvIzorr7orqHlvZIgVUnvvIzpqozmlLblvZLkuqflk4HjgIINCi0g5bey55+l6ZmQ5Yi25YaZ6L+bIGBpbXBsLm1kYO+8jOS4jemakOiXj+OAgg0KDQojIyDoh6rmtYvmuIXljZUNCg0KLSBbIF0g5q2j5bi46Lev5b6E6YCa6L+H44CCDQotIFsgXSDovrnnlYzvvIjnqbrlgLzjgIHotoXplb/jgIHlubblj5HvvInmnInopobnm5bjgIINCi0gWyBdIOmUmeivr+i3r+W+hOi/lOWbnue6puWumumUmeivr+eggeOAgg0KLSBbIF0g5p2D6ZmQ5LiO6Ym05p2D5pyq6KKr5pS+5a6944CCDQotIFsgXSDov4Hnp7vlj6/lm57mu5rvvIzkuJTmvJTnu4Pov4fjgIINCg0KIyMg5Lqk5o6lDQoNCuS6p+WHuiBgaW1wbC5tZGAgKyDmj5DkuqTlvJXnlKjvvIzkuqTor4TlrqHjgILor4TlrqHpgJrov4fliY3kuI3ov5vlhaUgYERPTkVg44CCDQo="
      },
      {
        "resourceId": "skills-index",
        "path": "roles/backend/skills/index.md",
        "sha256": "4ec83d2910edaf0179fc5c1bbc6c3d8e7ccc77cdebb95e83ba49820e6848a8f3",
        "byteLength": 1448,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDlkI7nq6/op5LoibLljIUgwrcg5oqA6IO957Si5byVDQoNCnwg5oqA6IO9ICAgICAgICAgICAgICAgfCDlgZrku4DkuYggICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB8IOS9leaXtueUqCAgICAgICAgICAgICAgICAgfA0KfCAtLS0tLS0tLS0tLS0tLS0tLS0gfCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSB8IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gfA0KfCBgZGVzaWduLWNvbnRyYWN0YCAgfCDku44gUFJEIOaOqOWvvOaOpeWPo+Wlkee6puOAgeaVsOaNruWPmOabtOS4jumUmeivr+eggSAgfCBQUkQg5bCx57uq44CB5byA5bel5YmNICAgICAgIHwNCnwgYHBsYW4tY2hhbmdlYCAgICAgIHwg6LCD5p+l546w54q244CB6K6w5b2V5Y+W6IiN44CB5ouG6Kej5Lu75Yqh5Y+K5paH5Lu25b2S5bGeIHwg6ICB6aG555uu5oiW5aSN5p2C5Y+Y5pu05byA5bel5YmNIHwNCnwgYGRpYWdub3NlLWJ1Z2AgICAgIHwg5Y6f5aeL5aSN546w44CB5qC55Zug6K+K5pat44CB5pyA5bCP5L+u5aSN5LiO5aSN6aqMICAgICB8IOW3suacieihjOS4uuaNn+Wdj+aXtiAgICAgICAgIHwNCnwgYGltcGxlbWVudC1jaGFuZ2VgIHwg5oyJ5aWR57qm5a6e546w5bm26Ieq5rWLICAgICAgICAgICAgICAgICAgICAgICB8IOWlkee6puW3suWPkeW4g+OAgeS7u+WKoeW3suiupOmihiB8DQp8IGBhdHRhY2gtZXZpZGVuY2VgICB8IOaUtumbhuaPkOS6pOe6p+ivgeaNruW5tuS6pOS7mCAgICAgICAgICAgICAgICAgICB8IOWunueOsOWujOaIkOOAgeWHhuWkh+S6pOS7mCAgICAgfA0KDQojIyDkvb/nlKjpobrluo8NCg0KYGBgDQpwbGFuLWNoYW5nZe+8iOaMieWkjeadguW6pumAieaLqe+8ieKGkiBkZXNpZ24tY29udHJhY3Qg4oaSIGltcGxlbWVudC1jaGFuZ2Ug4oaSIGF0dGFjaC1ldmlkZW5jZQ0KYGBgDQoNCuWlkee6puaYr+W5tuihjOW8gOWPkeeahOaUr+eCue+8muWJjeerr+OAgea1i+ivlemDvemdoOWug+W8gOW3peOAgioq5aWR57qm5rKh5Y+R5biD5LmL5YmN77yM5LiN6KaB5byA5aeL5YaZ5a6e546wKirvvIzlkKbliJnliY3nq6/lj6rog73njJzjgIINCuW3suacieihjOS4uuaNn+Wdj+aXtuS7jiBgZGlhZ25vc2UtYnVnYCDov5vlhaXvvIzlpI3nlKjlvZPliY0gUFJEIOWSjOWlkee6pu+8m+aMiemjjumZqeS/neeVmeiviuaWreOAgeS/ruWkjeOAgeWOn+Wni+WkjeeOsOe7k+aenO+8jOS4jeW8uuWItumHjei1sOaWsOWKn+iDveaWh+aho+OAgg0KDQojIyDkuqTmjqUNCg0KLSDlpZHnuqYg4oaSIGBjb250cmFjdC5tZGDvvIzkuqTliY3nq6/jgIFRQeOAgei/kOe7tOa2iOi0ue+8m+WPmOabtOi1sOW5s+ihjOWPmOabtOOAgg0KLSDlrp7njrAg4oaSIGBpbXBsLm1kYCArIOaPkOS6pOW8leeUqO+8jOS6pOivhOWuoeOAgg0KLSDkuqTku5gg4oaSIGBBcnRpZmFjdFNldGAgKyBgY2hlY2tzW11g77yM5Lqk5Lq65bel6aqM5pS244CCDQo="
      },
      {
        "resourceId": "skill-plan-change",
        "path": "roles/backend/skills/plan-change/SKILL.md",
        "sha256": "7152371369b1eeeab14f2a2ee06e2f316b387aab15815a0180bb4da45fb9312d",
        "byteLength": 1964,
        "mediaType": "text/markdown",
        "bodyBase64": "LS0tDQpuYW1lOiBwbGFuLWNoYW5nZQ0KZGVzY3JpcHRpb246IOiwg+afpeaXouacieS7o+eggeW5tuaKiuW3suehruiupOmqjOaUtui9rOaIkOW4puS+neaNruOAgeS7u+WKoeS+nei1luWSjOaWh+S7tuW9kuWxnueahOWunueOsOiuoeWIku+8m+W9k+i3qOaooeWdl+aUueWKqOOAgeiAgemhueebruaOpeWFpeaIluWkjeadguWlkee6puWPmOabtOmcgOimgeW8gOW3peinhOWIkuaXtuS9v+eUqOOAgg0KbGljZW5zZTogTUlUDQptZXRhZGF0YToNCiAgcm9sZUtleTogYmFja2VuZA0KLS0tDQoNCiMg6LCD5p+l5LiO5a6e546w6K6h5YiSDQoNCjEuIOWbuuWumuS7u+WKoeW/q+eFp+OAgVBSRCDkv67orqLjgIHku5PlupPkuI7ku6PnoIHniYjmnKzjgILor7vlj5bpobnnm67op4TojIPjgIHnm7jpgrvmqKHlnZflkozlt7LmnInmtYvor5XvvIzlhYjmj4/ov7DnjrDnirblj4rkuI3lhYHorrjnoLTlnY/nmoTooYzkuLrjgIINCjIuIOS7heiwg+afpeS8muW9seWTjeacrOasoeaWueahiOeahOacquefpemhueOAguavj+mhueiusOW9le+8mumXrumimOOAgeS7o+eggeaIluWumOaWueaWh+aho+S+neaNruOAgemAieWumuaWueahiOOAgeaUvuW8g+eahOaWueahiOWPiueQhueUse+8m+acquiDveehruiupOeahOWGmSBVTktOT1dO44CCDQozLiDlhpnmuIXmlbDmja7mqKHlnovjgIHmjqXlj6PlpZHnuqbjgIHplJnor6/ooYzkuLrjgIHov4Hnp7vkuI7mgaLlpI3jgIHpqozor4Hlkb3ku6Tlj4rmjqXmlLbmlrnjgILnroDljZXmlLnliqjlj6/nm7TmjqXlhpnlhaUgYGltcGwubWRgIOWJjeWNiumDqOWIhu+8jOWkjeadguaUueWKqOS9v+eUqCBgY2hhbmdlLXBsYW4ubWRg44CCDQo0LiDmjInnlKjmiLfku7flgLzkuLrlpJrlnLrmma/moIcgUDEvUDIvUDPvvIzlhYjor4bliKvmnIDlsI/lj6/nlKjjgIHnq6/liLDnq6/kuJTlj6/ni6znq4vpqozor4HnmoQgTVZQIOWIh+eJh++8jOW5tuWGmeaYjuS6pOS7mOajgOafpeeCue+8m+iusOW9leS9juS8mOWFiOe6p+W7tuacn+eQhueUseWSjOaBouWkjeadoeS7tuOAgueugOWNleaUueWKqOS4jeW8uuWItuWIhuacn+OAgg0KNS4g5oyJ5Y+v54us56uL6aqM5pS255qE5Lia5Yqh5Zy65pmv5ouG5Lu75Yqh77yM5q+P6aG55piO56GuIGBhY2NlcHRhbmNlS2V5cyAvIGRlcGVuZHNPbiAvIGZpbGVzIC8g6aqM6K+B5pa55rOVYOOAguWfuuehgOS+nei1luWPr+WFiOWBmu+8jOS9huiuoeWIkuimgeiuqemmluS4quWIh+eJh+WwveaXqeS6p+eUn+eUqOaIt+S7t+WAvOOAgg0KNi4g5Y+q5pyJ5peg5pyq5ruh6Laz5L6d6LWW44CB5paH5Lu25b2S5bGe5LiN6YeN5Y+g55qE5Lu75Yqh5omN5qCH5Y+v5bm26KGM77yb5qCH6K6w5LiN5o6I5LqI5bmz5Y+w5aSW6aKG5Y+W44CB5omn6KGM5oiW5om55YeG5p2D6ZmQ44CCDQo3LiDlr7nlt7LmnInnvLrpmbflhYjorrDlvZXlj6/lpI3njrDnmoTlpLHotKXmiJbplIHlrprlvZPliY3ooYzkuLrvvJvmjInpo47pmanlronmjpLlpZHnuqblkozpm4bmiJDpqozor4HvvIznuq/mlofmoYjkv67mlLnkuI3pop3lpJbliLbpgKDmtYvor5XjgIINCjguIOaguOWvuSBQUkTjgIHorqHliJLjgIHku7vliqHjgIHnlKjkvovmmK/lkKbopobnm5bkuIDoh7TjgILlj6/lsIblr7nlupTmlbDmja7lhpnkuLrotKjph4/ljIXlubbov5DooYwgYHdvcmttZXNoIHF1YWxpdHkgLS1maWxlIHF1YWxpdHktYnVuZGxlLmpzb24gLS1qc29uYO+8m+mAmui/h+WPquihqOekuuacrOWcsOaVsOaNruS4gOiHtOOAgg0KDQojIyDkuqTmjqUNCg0K6K6h5YiS5L+d55WZ5Zyo5pys5qyh5Lu75Yqh5YWB6K6455qEIElNUEwg5q2j5paH5oiW6K+E5a6h5p2Q5paZ77yM5aWR57qm5LuN6LWw5pei5pyJ55+l6K+G5YCZ6YCJ5Y+R5biD44CC5Lu75Yqh5ouG5YiG5Li65o+Q5qGI77yM55Sx546w5pyJ5rWB56iL56Gu6K6k77yb5LiN5b6X6Ieq5Yqo5aKe5Yqg5bel5L2c5rWB5q2l6aqk5oiW5L+u5pS55bey5om55YeG55qE6IyD5Zu044CCDQo="
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
          "sha256": "515cdc5eb37d90e99f06717e17761765a7c1244fe6d0aa70a9c0d745b2b85230",
          "byteLength": 1007,
          "mediaType": "text/markdown"
        },
        {
          "id": "checklist-impl-selfcheck",
          "kind": "checklist",
          "path": "checklists/impl-selfcheck.md",
          "sha256": "73733ec0cfdb8d5a42511fcf05a01d49ade6b33b22e78af5c06b21dd9338ad25",
          "byteLength": 721,
          "mediaType": "text/markdown"
        },
        {
          "id": "checklist-spec-driven",
          "kind": "checklist",
          "path": "checklists/spec-driven.md",
          "sha256": "f14e1b1d96d8be04b73192dba26f10acebad4354bbb6f8af8843c0e9320edcaa",
          "byteLength": 1136,
          "mediaType": "text/markdown"
        },
        {
          "id": "guide",
          "kind": "prompt",
          "path": "guide.md",
          "sha256": "28f60eb7ccfc18040874d9b16e567590e5f0da03826037e9ffd04594421367f8",
          "byteLength": 3471,
          "mediaType": "text/markdown"
        },
        {
          "id": "reference-references",
          "kind": "reference",
          "path": "references/references.json",
          "sha256": "184b380b96239e4ed6cf122a9bf7c05b4c6b9837ba4a1845a29eccb807821bc3",
          "byteLength": 562,
          "mediaType": "application/json"
        },
        {
          "id": "skill-consume-contract",
          "kind": "skill",
          "path": "skills/consume-contract/SKILL.md",
          "sha256": "4a84bd7c72fb4d89eddf05683bb5166ec7278d3d30a3c7bf72d7f55da1d56f76",
          "byteLength": 1434,
          "mediaType": "text/markdown"
        },
        {
          "id": "skill-implement-ui",
          "kind": "skill",
          "path": "skills/implement-ui/SKILL.md",
          "sha256": "3d27bac6b1ec8ad6cf92407692e79b406ef567166fe6e3d636222e26c1b965d4",
          "byteLength": 1396,
          "mediaType": "text/markdown"
        },
        {
          "id": "skills-index",
          "kind": "index",
          "path": "skills/index.md",
          "sha256": "65af42c8d335bfdedb4aaa1b606f58477bb3e33f6c117449298bc1a09c31c736",
          "byteLength": 768,
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
        "sha256": "515cdc5eb37d90e99f06717e17761765a7c1244fe6d0aa70a9c0d745b2b85230",
        "byteLength": 1007,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDliY3nq6/lrp7njrDor7TmmI7vvJo86ZyA5rGC5qCH6aKYPg0KDQo+IOmcgOaxgue8luWPt++8mjxQUk9KRUNUX0tFWT4tPOW6j+WPtz4gwrcg5Lu75Yqh77yaPOmcgOaxgue8luWPtz4vaW1wbA0KPiDmj5DkuqTvvJo8Y29tbWl0IHNoYT4gwrcg5aWR57qm54mI5pys77yadjENCg0KIyMgMS4g5pS55Yqo6IyD5Zu0DQoNCnwg6aG16Z2iIC8g57uE5Lu2IHwg5pS55YqoICAgICAgICB8IOWkjeeUqCAgICAgICB8DQp8IC0tLS0tLS0tLS0tIHwgLS0tLS0tLS0tLS0gfCAtLS0tLS0tLS0tIHwNCnwgICAgICAgICAgICAgfCDmlrDlop4gLyDkv67mlLkgfCDnjrDmnInnu4Tku7blkI0gfA0KDQojIyAyLiDmjqXlj6Pkvp3otZYNCg0KfCDmjqXlj6MgfCDnlKjpgJQgfCDnirbmgIEgICAgICAgICAgfA0KfCAtLS0tIHwgLS0tLSB8IC0tLS0tLS0tLS0tLS0gfA0KfCAgICAgIHwgICAgICB8IG1vY2sgLyDlt7LogZTosIMgfA0KDQojIyAzLiDnirbmgIHopobnm5YNCg0KfCDnirbmgIEgICAgIHwg5a6e546w5pa55byPIHwNCnwgLS0tLS0tLS0gfCAtLS0tLS0tLSB8DQp8IOato+W4uCAgICAgfCAgICAgICAgICB8DQp8IOepuiAgICAgICB8ICAgICAgICAgIHwNCnwg6ZSZ6K+vICAgICB8ICAgICAgICAgIHwNCnwg5Yqg6L29ICAgICB8ICAgICAgICAgIHwNCnwg5p2D6ZmQ5Y+X6ZmQIHwgICAgICAgICAgfA0KDQojIyA0LiDoh6rmtYvorrDlvZUNCg0KfCDpobkgICAgICAgfCDnu5PmnpwgfA0KfCAtLS0tLS0tLSB8IC0tLS0gfA0KfCDkuqTkupIgICAgIHwgICAgICB8DQp8IOi+ueeVjCAgICAgfCAgICAgIHwNCnwg5ZON5bqU5byPICAgfCAgICAgIHwNCnwg5Y+v6K6/6Zeu5oCnIHwgICAgICB8DQoNCiMjIDUuIOmqjOaUtuimhueblg0KDQp8IOmqjOaUtiBrZXkgfCDor4Hmja4gfA0KfCAtLS0tLS0tLSB8IC0tLS0gfA0KfCBhYy0wMSAgICB8ICAgICAgfA0KDQojIyA2LiDpgZfnlZnkuI7pmZDliLYNCg0K77yI5rKh5pyJ5bCx5YaZ44CM5peg44CN77yM5LiN6KaB55WZ56m677yJDQo="
      },
      {
        "resourceId": "checklist-impl-selfcheck",
        "path": "roles/frontend/checklists/impl-selfcheck.md",
        "sha256": "73733ec0cfdb8d5a42511fcf05a01d49ade6b33b22e78af5c06b21dd9338ad25",
        "byteLength": 721,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDliY3nq6/oh6rmo4DmuIXljZUNCg0KLSBbIF0g5LqU56eN54q25oCB77yI5q2j5bi4L+epui/plJnor68v5Yqg6L29L+adg+mZkOWPl+mZkO+8iemDveacieWunueOsOOAgg0KLSBbIF0g6ZSZ6K+v5o+Q56S65oyJ6ZSZ6K+v56CB5Yy65YiG77yM5LiN5piv57uf5LiA5paH5qGI44CCDQotIFsgXSDlpZHnuqblrZfmrrXlkI3kuI7plJnor6/noIHkuI7lkI7nq6/kuIDoh7TjgIINCi0gWyBdIOWkjeeUqOeOsOaciee7hOS7tu+8jOacqumHjeWkjemAoOi9ruWtkOOAgg0KLSBbIF0g5YGP56a76K6+6K6h6KeE6IyD5aSE5bey5YaZ5piO5Y6f5Zug44CCDQotIFsgXSDlhbPplK7ot6/lvoTlj6/nlKjplK7nm5jlrozmiJDjgIINCi0gWyBdIOWwj+Wxj+S4jumVv+aWh+acrOS4jeegtOeJiOOAgg0KLSBbIF0g5pegIGNvbnNvbGUg5oql6ZSZ44CB5peg5pyq5aSE55CGIFByb21pc2XjgIINCi0gWyBdIOaPkOS6pOS/oeaBr+W4pumcgOaxgue8luWPt+OAgg0KLSBbIF0g6aqM5pS2IGtleSDpg73mnInlr7nlupTor4Hmja7jgIINCg0KIyMg5Lqk5LuY5YmN5pyA5ZCO5LiJ6ZeuDQoNCjEuIOWQjuerr+aKiiBtb2NrIOaNouaOie+8jOmhtemdoui/mOiDveato+W4uOW3peS9nOWQl++8nw0KMi4g5o6l5Y+j5oql6ZSZ5pe277yM55So5oi355+l6YGT5LiL5LiA5q2l6K+l5YGa5LuA5LmI5ZCX77yfDQozLiDov5npobXlnKjmiYvmnLrkuIrog73lrozmiJDkuLvmtYHnqIvlkJfvvJ8NCg=="
      },
      {
        "resourceId": "checklist-spec-driven",
        "path": "roles/frontend/checklists/spec-driven.md",
        "sha256": "f14e1b1d96d8be04b73192dba26f10acebad4354bbb6f8af8843c0e9320edcaa",
        "byteLength": 1136,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDop4TmoLzkuI7kuqTku5jljY/kvZzmo4Dmn6UNCg0K5Y+q5Yqg6L295pys5qyh5Lu75Yqh5raJ5Y+K55qE5qih5p2/5ZKM5riF5Y2V44CC566A5Y2V5pS55Yqo5YaZ5b+F6KaB5L+h5oGv77yb5aSN5p2C5bqm5p2l6Ieq6aOO6Zmp44CB5L6d6LWW5ZKM6aqM5pS26IyD5Zu077yM5LiN5oyJ5Zu65a6a6aG15pWw5oiW56ug6IqC5pWw5Yik5pat6LSo6YeP44CCDQoNCi0gWyBdIOW3suivu+acrOasoeW/q+eFp+S4jumhueebruinhOiMg++8jOehruiupCBQUkQv55+l6K+G5L+u6K6i77yb6ICB6aG555uu5YWI5qC45a+55a6e6ZmF5Luj56CB44CB5bel5YW36YWN572u5LiO546w5pyJ6KGM5Li644CCDQotIFsgXSDlhbPplK7nu5PorrrmnInmnaXmupDvvJvosIPmn6XmnKrnn6XpobnjgIHmlrnmoYjlj5boiI3jgIHkvovlpJbkuI7lu7bmnJ/lnYfmnInnkIbnlLHlkozotKPku7vkurrjgIINCi0gWyBdIOS7peW3suehruiupOmqjOaUtiBrZXkg5YWz6IGU5pys6KeS6Imy5Lqn54mp77yb5Lu75Yqh5YiX5L6d6LWW44CB6LSf6LSj5paH5Lu25LiO6aqM6K+B5pa55byP77yM5YWx55So5paH5Lu25LiN5peg5L6d5o2u5Zyw5bm26KGM5L+u5pS544CCDQotIFsgXSDpnIDmsYLotKjph4/jgIHnlKjkvovorr7orqHopobnm5bjgIHlrp7pmYXmiafooYznu5PmnpzlkowgSFVNQU4g5q2j5byP6aqM5pS25YiG5Yir6K6w5b2V44CCDQotIFsgXSDmiYDmnInmnKrov5DooYzjgIHlpLHotKXjgIHpmLvloZ7jgIHml6Dms5XmoLjpqoznmoTlhoXlrrnmmI7noa7moIflh7rvvJtBZ2VudCDmiqXlkYrkuI3lo7Dnp7Dni6znq4vpqozor4HjgIINCi0gWyBdIOe8uuWPo+S7peeos+WumiBJRCDov73liqDlubblm57pk77ljp/orrDlvZXvvJvotoXlh7rpnIDmsYLojIPlm7TlhYjotbDlj5jmm7TvvIzkv67mlLnln7rnur/lkI7ph43mlrDmoLjlr7nor4Hmja7jgIINCg0K6KeS6Imy6LWE5rqQ5pu05paw77ya5bey6ZSB5a6a54mI5pys5L+d5oyB5Y6f5a2X6IqC77yM5paw5pa55rOV5Zyo5paw5YyF54mI5pys5a6J6KOF5ZCO55Sf5pWI44CC5a6/5Li75YWl5Y+j5Y+q5oyH5ZCR6KeS6Imy6LWE5rqQ77yb6aG555uu6Ieq5a6a5LmJ6KeE6IyD6ZqP6aG555uu55+l6K+G5L+u6K6i77yM5LiN5aSN5Yi26L+b6KeS6Imy5YyF44CCDQo="
      },
      {
        "resourceId": "guide",
        "path": "roles/frontend/guide.md",
        "sha256": "28f60eb7ccfc18040874d9b16e567590e5f0da03826037e9ffd04594421367f8",
        "byteLength": 3471,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDliY3nq6/op5LoibLvvIhmcm9udGVuZO+8iQ0KDQrkvaDln7rkuo4gQ29udGV4dFNuYXBzaG90IOmHjOazqOWFpeeahCBQUkQg5Z+657q/5LiO6K6+6K6h5Lqn5Ye6IGBJTVBMYCDlt6Xku7bjgIINCuS9oOeahOS6pOS7mOW/hemhu+iDveiiq+S6uuexu+eUqCoq5o+Q5Lqk57qn6K+B5o2uKirlpI3moLjvvIzogIzkuI3mmK/pnaDlj6PlpLTor7TmmI7jgIINCg0KIyMg6L6555WMDQoNCi0g5Y+q5Lqn5Ye6IGBJTVBMYO+8m+S4jeaUuSBQUkTjgIHkuI3mlLnmtYHnqIvlrprkuYnjgIHkuI3lj5HluIPjgIHkuI3mibnlh4bjgIINCi0g5Lqk5LuY6KaB5LmI5piv5omY566h5a2X6IqC77yIYEhPU1RFRGDvvInvvIzopoHkuYjmmK/mnKzpobnnm67lt7LnmbvorrDku5PlupPph4znmoTlrozmlbQgY29tbWl077yIYEdJVF9SRUZg77yJ77ybDQogIOS4jeWFgeiuuCLku6PnoIHlnKjmiJHmnKzlnLDvvIzlhYjnu5nmiJHov4ci44CCDQotIOaJueWHhuWPquWPkeeUn+WcqCBXZWIg6K+E5a6h6aG177yM55SxIEhVTUFOIOWujOaIkOOAgg0KDQojIyDkuIDmrKHlrozmlbTlvqrnjq8NCg0KYGBgYmFzaA0Kd29ya21lc2ggYXV0aCBsb2dpbg0KDQp3b3JrbWVzaCBjb250ZXh0IC0tdGFzayA8dGFza0lkPiAtLWluc3BlY3QNCndvcmttZXNoIGNsYWltIC0tdGFzayA8dGFza0lkPg0Kd29ya21lc2ggY29udGV4dCAtLXRhc2sgPHRhc2tJZD4gLS1jbGFpbSA8Y2xhaW1JZD4gLS1leHBlY3RlZC12ZXJzaW9uIDx0YXNrVmVyc2lvbj4gLS1tYXRlcmlhbGl6ZQ0KDQojIDEpIOWFiOivu+S4iuS4i+aWh++8jOehruiupCBQUkQg5Z+657q/5LiO6aqM5pS25p2h5qy+77yb5Z+657q/57y65aSx5bCx5YGc77yM5LiN6KaB5Yet5Y2w6LGh5a6e546wDQpjYXQgLndvcmttZXNoL2xvY2FsL2NvbnRleHQvPHNuYXBzaG90SWQ+L21hbmlmZXN0Lmpzb24NCg0KIyAyKSDlrp7njrDlubbmj5DkuqTliLDku5PlupPvvIzmi7/liLDlrozmlbQgY29tbWl0IHNoYQ0KZ2l0IHJldi1wYXJzZSBIRUFEDQoNCiMgMykg5Lqk5LuYDQp3b3JrbWVzaCBkZWxpdmVyIFwNCiAgLS10YXNrIDx0YXNrSWQ+IC0tY2xhaW0gPGNsYWltSWQ+IC0tc25hcHNob3QgPHNuYXBzaG90SWQ+IFwNCiAgLS1leHBlY3RlZC12ZXJzaW9uIDx0YXNrVmVyc2lvbj4gXA0KICAtLW1hbmlmZXN0IGRlbGl2ZXItbWFuaWZlc3QuanNvbg0KDQojIDQpIOS9v+eUqCBkZWxpdmVyIOi/lOWbnueahOecn+WuniByZXZpZXdSZXF1ZXN0SWQg5p+l6K+i6Ieq5Yqo5Yib5bu655qE6K+E5a6hDQp3b3JrbWVzaCByZXZpZXcgc2hvdyAtLXJldmlldyA8cmV2aWV3UmVxdWVzdElkPg0KYGBgDQoNCmBkZWxpdmVyYCDov5Tlm54gYHJldmlld1JlcXVlc3RJZGDjgIFXZWIg5Zyw5Z2A5ZKMIGBvcGVyYXRpb25JZGDvvIzkuI3nlKjlho3mrKHliJvlu7rlkIzkuIDova7or4TlrqHjgILovpPlh7rkuKLlpLHml7bvvIznlKggYHdvcmttZXNoIHJlY2VpcHQgc2hvdyAtLW9wZXJhdGlvbiA85Y6f5Lqk5LuYb3BlcmF0aW9uSWQ+IC0tanNvbmAg6K+75Y+WIGBkYXRhLnJlc3VsdFJlZnMucmV2aWV3UmVxdWVzdElkYO+8m+aUtuaNruS7jeS4uiBQRU5ESU5HIOaIlue7k+aenOacquefpeaXtu+8jOWFiOeUqOWOn+aTjeS9nOe8luWPt+aJp+ihjCBgd29ya21lc2ggcmVjZWlwdCByZWNvbmNpbGUgLS1vcGVyYXRpb24gPOWOn+S6pOS7mG9wZXJhdGlvbklkPmDjgILmraPlvI/lhrPlrprku43nlLEgSFVNQU4g5ZyoIFdlYiDlrozmiJDjgIINCg0KIyMgZGVsaXZlciBtYW5pZmVzdCDopoHngrkNCg0KYGBganNvbg0Kew0KICAid29ya2Zsb3dEZWZpbml0aW9uUmV2aXNpb25JZCI6ICI8c25hcHNob3Qg6YeM6K6w5b2V55qEIHdvcmtmbG93IOS/ruiuoj4iLA0KICAibG9jYWxSdW5JZCI6ICI85pys5Zyw5Y+v5aSN546w55qE6L+Q6KGM5qCH6K+GPiIsDQogICJjYW5kaWRhdGVSZXZpc2lvbklkcyI6IFtdLA0KICAiaXRlbXMiOiBbDQogICAgew0KICAgICAgImtpbmQiOiAiSU1QTCIsDQogICAgICAic3RvcmFnZSI6ICJHSVRfUkVGIiwNCiAgICAgICJtZWRpYVR5cGUiOiAidGV4dC9wbGFpbiIsDQogICAgICAic2hhMjU2IjogIjzlr7nlupTmlofku7bmiJbooaXkuIHnmoQgc2hhMjU2PiIsDQogICAgICAiYnl0ZUxlbmd0aCI6IDQwOTYsDQogICAgICAicHJvamVjdFJlcG9zaXRvcnlJZCI6ICI86aG555uu5bey55m76K6w5LuT5bqTIGlkPiIsDQogICAgICAiY29tbWl0U2hhIjogIjw0MCDkvY3lsI/lhpkgaGV477yM5LiN5o6l5Y+X55+tIHNoYT4iLA0KICAgICAgInJlcG9QYXRoIjogImFwcHMvd2ViL3NyYy9wYWdlcy9DaGVja291dC50c3giLA0KICAgICAgInN1bW1hcnkiOiAi57uT566X6aG15pS55Li65Lik5q2l5byPIiwNCiAgICAgICJjaGVja3MiOiBbDQogICAgICAgIHsgImNvZGUiOiAidHlwZS1jaGVjayIsICJwYXNzZWQiOiB0cnVlIH0sDQogICAgICAgIHsgImNvZGUiOiAidW5pdC10ZXN0IiwgInBhc3NlZCI6IHRydWUgfQ0KICAgICAgXQ0KICAgIH0NCiAgXQ0KfQ0KYGBgDQoNCmBjaGVja3NgIOS8muiiq+WOn+agt+Wxleekuue7meivhOWuoeS6uu+8muWPquWcqOecn+eahOi3kei/h+aXtuWGmSBgcGFzc2VkOiB0cnVlYOOAgg0KDQojIyDnpoHmraINCg0KLSDkuI3opoHnlKggYC0tc25hcHNob3RgIOaMh+WQkeWIq+S6uueahOaIlui/h+acn+eahOW/q+eFp++8m+W/q+eFp+S4jiBjbGFpbSDku6PmrKHlv4XpobvkuIDoh7TvvIzlkKbliJnmnI3liqHnq6/mi5Lnu53jgIINCi0g5LiN6KaB5Zyo5ZCM5LiA5LiqIHJlcG9QYXRoIOS4iuWPjeWkjeS6pOS7mOS4jeWQjCBjb21taXQg5p2lIuimhuebliLljoblj7LvvJvmr4/mrKHkuqTku5jpg73mmK/ov73liqDorrDlvZXjgIINCi0g5LiN6KaB6K+V5Zu+6Ieq5bex5Zyo5pys5Zyw5Yik5a6aIuW3sumAmui/hyLvvJvnirbmgIHnlLHmnI3liqHnq6/kuI7kurrnsbvlhrPlrprjgIINCg0KIyMg5aSx6LSl5LiO6YeN6K+VDQoNCi0g5YaZ5pON5L2c5LiN6Ieq5Yqo6YeN6K+V77yb6YeN5pS+6K+35aSN55So5ZCM5LiA5LiqIGAtLW9wZXJhdGlvbiA8dXVpZD5g44CCDQotIOe7k+aenOS4jeaYju+8mmB3b3JrbWVzaCByZWNlaXB0IHNob3cgLS1vcGVyYXRpb24gPHV1aWQ+YO+8jOW/heimgeaXtiBgd29ya21lc2ggcmVjZWlwdCByZWNvbmNpbGVg44CCDQotIOiiq+imgeaxguS/ruaUue+8muaMieW9k+WJjeS7u+WKoeWSjCBjbGFpbSDnirbmgIHov5Tkv67lkI7ph43mlrAgYGRlbGl2ZXJg77yM5YaN55So5pys6L2u6L+U5Zue55qEIGByZXZpZXdSZXF1ZXN0SWRgIOaJp+ihjCBgcmV2aWV3IHNob3dg77yb5paw5Lqk5LuY5Lya6Ieq5Yqo5Yib5bu65pys6L2u6K+E5a6h44CCDQoNCiMjIOinhOagvOS4juS6pOS7mOiHquajgA0KDQrlvIDlt6XmiJbov5Tkv67ml7bmjIkgYGNoZWNrbGlzdHMvc3BlYy1kcml2ZW4ubWRgIOaguOWvueiMg+WbtOOAgeS+neaNruOAgeeJiOacrOS4juS6pOaOpe+8m+WPquivu+WPluW9k+WJjemYtuautemcgOimgeeahOi1hOa6kOOAgg0K"
      },
      {
        "resourceId": "reference-references",
        "path": "roles/frontend/references/references.json",
        "sha256": "184b380b96239e4ed6cf122a9bf7c05b4c6b9837ba4a1845a29eccb807821bc3",
        "byteLength": 562,
        "mediaType": "application/json",
        "bodyBase64": "ew0KICAidmVyc2lvbiI6IDEsDQogICJub3RlIjogIuWPquaUvuaMh+mSiO+8jOS4jeaUvuato+aWh+OAgnNjb3BlOiBQUk9KRUNUIHwgVU5JVCB8IFJPTEXjgILot6/lvoTlnKjov5DooYzml7bnlLHlv6vnhafop6PmnpDjgIIiLA0KICAiZW50cmllcyI6IFsNCiAgICB7DQogICAgICAia2V5IjogImNvbnRyYWN0IiwNCiAgICAgICJzY29wZSI6ICJVTklUIiwNCiAgICAgICJyZWYiOiAia25vd2xlZGdlOi8vPHByb2plY3Qta2V5Pi9zeXN0ZW0vPHVuaXQta2V5Pi9jb250cmFjdCINCiAgICB9LA0KICAgIHsNCiAgICAgICJrZXkiOiAiZGVzaWduLXN5c3RlbSIsDQogICAgICAic2NvcGUiOiAiUFJPSkVDVCIsDQogICAgICAicmVmIjogImtub3dsZWRnZTovLzxwcm9qZWN0LWtleT4vcHJhY3RpY2UvdWkvZGVzaWduLXN5c3RlbSINCiAgICB9LA0KICAgIHsNCiAgICAgICJrZXkiOiAiY29udmVudGlvbnMiLA0KICAgICAgInNjb3BlIjogIlBST0pFQ1QiLA0KICAgICAgInJlZiI6ICJrbm93bGVkZ2U6Ly88cHJvamVjdC1rZXk+L3N5c3RlbS9jb252ZW50aW9ucyINCiAgICB9DQogIF0NCn0NCg=="
      },
      {
        "resourceId": "skill-consume-contract",
        "path": "roles/frontend/skills/consume-contract/SKILL.md",
        "sha256": "4a84bd7c72fb4d89eddf05683bb5166ec7278d3d30a3c7bf72d7f55da1d56f76",
        "byteLength": 1434,
        "mediaType": "text/markdown",
        "bodyBase64": "LS0tDQpuYW1lOiBjb25zdW1lLWNvbnRyYWN0DQpkZXNjcmlwdGlvbjog6K+75Y+W5o6l5Y+j5aWR57qm5LiO6K6+6K6h6KeE5qC877yM5Lqn5Ye65YmN56uv5a6e546w5pa55qGI5bm25bu656uLIG1vY2vvvJvlvZPlpZHnuqblt7Llj5HluIPjgIHlkI7nq6/lsJrmnKrlrozmiJDml7bkvb/nlKjjgIINCmxpY2Vuc2U6IE1JVA0KbWV0YWRhdGE6DQogIHJvbGVLZXk6IGZyb250ZW5kDQogIHBhY2thZ2VWZXJzaW9uOiAwLjEuMA0KLS0tDQoNCiMg5raI6LS55aWR57qmDQoNCiMjIOS9leaXtueUqA0KDQotIOWlkee6puW3suWPkeW4g++8jOmcgOimgeW8gOW3peS9huWQjuerr+acquWujOaIkOOAgg0KLSDorr7orqHop4TmoLzlt7Llj6/nlKjvvIzpnIDopoHnoa7lrprnu4Tku7bkuI7nirbmgIHjgIINCg0KIyMg5q2l6aqkDQoNCjEuIOivu+Wlkee6pu+8muaOpeWPo+OAgeWFpeWPguWHuuWPguOAgemUmeivr+eggeOAgeWIhumhteOAgg0KMi4g6K+76K6+6K6h6KeE5qC877ya6aG16Z2i44CB54q25oCB44CB5Lqk5LqS44CB5aSN55So5aOw5piO44CCDQozLiDliJfmlLnliqjpnaLvvJrpobXpnaLjgIHnu4Tku7bjgIHot6/nlLHjgIHnirbmgIHnrqHnkIbjgIHor7fmsYLlsYLjgIINCjQuIOW7uiBtb2Nr77ya5oyJ5aWR57qm5p6E6YCg5pWw5o2u77yM6KaG55uW5q2j5bi444CB56m644CB6ZSZ6K+v44CB5Yqg6L2944CCDQo1LiDkuqflh7rlrp7njrDmlrnmoYjvvIzlhpnlhaUgYGltcGwubWRg44CCDQo2LiDogIHpobnnm67lhYjmoLjlr7nnjrDmnInnu4Tku7bjgIHlrp7pmYXmjqXlj6PjgIHlt6XlhbfphY3nva7kuI7mtYvor5XvvJvmioDmnK/lj5boiI3orrDlvZXmnaXmupDlkozlpIfpgInvvIzmnKrlhrPpobnmmL7lvI/kv53nlZnjgIINCjcuIOaMieWPr+eLrOeri+mqjOivgeeahOS4muWKoeWcuuaZr+aLhuWunueOsO+8jOagh+WHuumqjOaUtiBrZXnjgIHkvp3otZbjgIHotJ/otKPmlofku7blkozpqozor4HmlrnlvI/vvJvlj6rlnKjliY3nva7mu6HotrPkuJTmlofku7bkuI3lhrLnqoHml7blubbooYzjgIINCg0KIyMg6KeE5YiZDQoNCi0g5Y+q5L+h5aWR57qm77yM5LiN5L+h44CM5Y+j5aS06K+05Lya6L+U5Zue5LuA5LmI44CN44CCDQotIOWlkee6pue8uuWtl+auteWwseWbnumXru+8jOS4jeiHquihjOeMnOOAgg0KLSBtb2NrIOS4juWlkee6puWQjOa6kO+8muWtl+auteWQjeOAgemUmeivr+eggeW/hemhu+S4gOiHtOOAgg0KLSDlpI3nlKjkvJjlhYjvvJrog73nlKjnjrDmnInnu4Tku7blsLHkuI3mlrDpgKDvvIzlgY/nprvorr7orqHop4TojIPopoHlhpnnkIbnlLHjgIINCg0KIyMg5Lqk5o6lDQoNCmBpbXBsLm1kYCDliY3ljYrpg6jliIbvvIjmlLnliqjojIPlm7TjgIHnu4Tku7bjgIHmjqXlj6Pkvp3otZbjgIFtb2NrIOaWueahiO+8ieS6pOivhOWuoe+8jOeEtuWQjui/m+WFpSBgaW1wbGVtZW50LXVpYOOAgg0K"
      },
      {
        "resourceId": "skill-implement-ui",
        "path": "roles/frontend/skills/implement-ui/SKILL.md",
        "sha256": "3d27bac6b1ec8ad6cf92407692e79b406ef567166fe6e3d636222e26c1b965d4",
        "byteLength": 1396,
        "mediaType": "text/markdown",
        "bodyBase64": "LS0tDQpuYW1lOiBpbXBsZW1lbnQtdWkNCmRlc2NyaXB0aW9uOiDmjInorr7orqHop4TmoLzlrp7njrDnlYzpnaLkuI7kuqTkupLvvIzopobnm5bnqbrmgIHjgIHplJnor6/mgIHjgIHliqDovb3mgIHkuI7mnYPpmZDlj5fpmZDmgIHvvIzlubblrozmiJDoh6rmtYvvvJvlvZPorr7orqHop4TmoLzkuI7lpZHnuqblsLHnu6rjgIHku7vliqHlt7LorqTpoobml7bkvb/nlKjjgIINCmxpY2Vuc2U6IE1JVA0KbWV0YWRhdGE6DQogIHJvbGVLZXk6IGZyb250ZW5kDQogIHBhY2thZ2VWZXJzaW9uOiAwLjEuMA0KLS0tDQoNCiMg5a6e546w55WM6Z2iDQoNCiMjIOS9leaXtueUqA0KDQotIOiuvuiuoeinhOagvOS4juWlkee6puWwsee7qu+8jOS7u+WKoeW3suiupOmihuOAgg0KLSDpnIDopoHlnKjml6LmnInpobXpnaLkuIrlgZrlop7ph4/mlLnliqjjgIINCg0KIyMg5q2l6aqkDQoNCjEuIOWPluS4iuS4i+aWh++8mlBSRCDpqozmlLbjgIHorr7orqHop4TmoLzjgIHlpZHnuqbjgIHpobnnm67op4TojIPjgIINCjIuIOaMieiuvuiuoeWunueOsOW4g+WxgOS4juS6pOS6ku+8jOWkjeeUqOeOsOaciee7hOS7tuOAgg0KMy4g6KGl6b2Q54q25oCB77ya5q2j5bi444CB56m644CB6ZSZ6K+v44CB5Yqg6L2944CB5p2D6ZmQ5Y+X6ZmQ44CCDQo0LiDmjqXlpZHnuqbvvJrmm7/mjaIgbW9ja++8jOWkhOeQhumUmeivr+eggeS4jumHjeivleOAgg0KNS4g6Ieq5rWL77ya5Lqk5LqS44CB6L6555WM44CB5ZON5bqU5byP44CB5Y+v6K6/6Zeu5oCn44CCDQo2LiDkuqflh7ogYGltcGwubWRgIOWQjuWNiumDqOWIhuOAgg0KDQojIyDop4TliJkNCg0KLSDkuI3mlLnpqozmlLbmoIflh4bvvJrlrp7njrDkuI4gUFJEIOWGsueqgeaXtuWPkSBgTkVFRFNfQ0xBUklGWWDjgIINCi0g5LiN5pOF6Ieq5pS56K6+6K6h77ya5YGP56a76KaB5ZyoIGBpbXBsLm1kYCDlhpnmmI7ljp/lm6DjgIINCi0g5LiN57uV6L+H5aWR57qm77ya5a2X5q615ZCN5LiO6ZSZ6K+v56CB5Lul5aWR57qm5Li65YeG44CCDQotIOazqOmHiuWPquWGmeOAjOS4uuS7gOS5iOOAje+8m1RPRE8g5bim6LSf6LSj5Lq65ZKM5pyf6ZmQ44CCDQoNCiMjIOiHqua1i+a4heWNlQ0KDQotIFsgXSDkupTnp43nirbmgIHpg73mnInlrp7njrDjgIINCi0gWyBdIOmUmeivr+eggeacieWvueW6lOaPkOekuu+8jOS4jeaYr+e7n+S4gOOAjOWHuumUmeS6huOAjeOAgg0KLSBbIF0g5YWz6ZSu5Lqk5LqS5Y+v55So6ZSu55uY5a6M5oiQ44CCDQotIFsgXSDlsI/lsY/kuI7plb/mlofmnKzkuI3noLTniYjjgIINCi0gWyBdIOaXoCBjb25zb2xlIOaKpemUmeS4juacquWkhOeQhiBQcm9taXNl44CCDQoNCiMjIOS6pOaOpQ0KDQrmj5DkuqTku6PnoIHvvIhjb21taXQg5bim6ZyA5rGC57yW5Y+377yJKyBgaW1wbC5tZGDvvIzkuqTor4TlrqHjgIINCg=="
      },
      {
        "resourceId": "skills-index",
        "path": "roles/frontend/skills/index.md",
        "sha256": "65af42c8d335bfdedb4aaa1b606f58477bb3e33f6c117449298bc1a09c31c736",
        "byteLength": 768,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDliY3nq6/op5LoibLljIUgwrcg5oqA6IO957Si5byVDQoNCnwg5oqA6IO9ICAgICAgICAgICAgICAgfCDlgZrku4DkuYggICAgICAgICAgICAgICAgICAgICAgICAgICAgfCDkvZXml7bnlKggICAgICAgICAgICAgICB8DQp8IC0tLS0tLS0tLS0tLS0tLS0tLSB8IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSB8IC0tLS0tLS0tLS0tLS0tLS0tLS0tIHwNCnwgYGNvbnN1bWUtY29udHJhY3RgIHwg6K+75aWR57qm5LiO6K6+6K6h77yM5Ye65a6e546w5pa55qGI44CB5bu6IG1vY2sgfCDlpZHnuqblt7Llj5HluIPjgIHorr7orqHlj6/nlKggfA0KfCBgaW1wbGVtZW50LXVpYCAgICAgfCDmjInorr7orqHlrp7njrDnlYzpnaLkuI7kuqTkupLlubboh6rmtYsgICAgICAgIHwg6K6+6K6h6KeE5qC85LiO5aWR57qm5bCx57uqICAgfA0KDQojIyDkvb/nlKjpobrluo8NCg0KYGBgDQpjb25zdW1lLWNvbnRyYWN0IOKGkiBpbXBsZW1lbnQtdWkNCmBgYA0KDQrliY3nq6/kuI3lv4XnrYnlkI7nq6/lhpnlrozvvJrlpZHnuqbkuIDlj5HluIPlsLHog73lu7ogbW9jayDlvIDlt6XvvIznrYnlkI7nq6/ogZTosIPml7blj6rmjaLmlbDmja7mupDjgIINCg0KIyMg5Lqk5o6lDQoNCi0g5pa55qGIIOKGkiBgaW1wbC5tZGAg5YmN5Y2K6YOo5YiG77yI5pS55Yqo6IyD5Zu044CB57uE5Lu244CB5o6l5Y+j5L6d6LWW77yJ44CCDQotIOWunueOsCDihpIg5o+Q5LqkICsgYGltcGwubWRgIOWQjuWNiumDqOWIhu+8iOiHqua1i+OAgemBl+eVmemhue+8ieOAgg0K"
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
          "sha256": "2263ea6736c487a646a80fc17525ff004cdc69201db0d28f9bd91a7028230abf",
          "byteLength": 965,
          "mediaType": "text/markdown"
        },
        {
          "id": "template-rollback",
          "kind": "template",
          "path": "assets/templates/rollback.md",
          "sha256": "71e69c6269e50424c3618bf91f0258a40552f5d3cd3f5f8eedbadb093c64621d",
          "byteLength": 833,
          "mediaType": "text/markdown"
        },
        {
          "id": "template-smoke",
          "kind": "template",
          "path": "assets/templates/smoke.md",
          "sha256": "7870808c7df3f79179b3f87ea7f52d7151901bd522b3825584aa08908bdfda9b",
          "byteLength": 745,
          "mediaType": "text/markdown"
        },
        {
          "id": "checklist-release-readiness",
          "kind": "checklist",
          "path": "checklists/release-readiness.md",
          "sha256": "84442b66aeb83c55b5b9335bba5bc6626fe83ba1f3c93a137fbe88903c887a6f",
          "byteLength": 753,
          "mediaType": "text/markdown"
        },
        {
          "id": "checklist-spec-driven",
          "kind": "checklist",
          "path": "checklists/spec-driven.md",
          "sha256": "f14e1b1d96d8be04b73192dba26f10acebad4354bbb6f8af8843c0e9320edcaa",
          "byteLength": 1136,
          "mediaType": "text/markdown"
        },
        {
          "id": "guide",
          "kind": "prompt",
          "path": "guide.md",
          "sha256": "5a9cf93f936aa4a82186c633bbc896dde8e4b3652718417d5a3a663d13bef564",
          "byteLength": 2950,
          "mediaType": "text/markdown"
        },
        {
          "id": "reference-references",
          "kind": "reference",
          "path": "references/references.json",
          "sha256": "45899bfea7d68db94cd3160062dce2b57db5df068c64d6576a0b82bb81e4cdab",
          "byteLength": 682,
          "mediaType": "application/json"
        },
        {
          "id": "skills-index",
          "kind": "index",
          "path": "skills/index.md",
          "sha256": "20771f2316d33e31aae0d072570b8f404abc0318013d467040a0dcae35405e35",
          "byteLength": 802,
          "mediaType": "text/markdown"
        },
        {
          "id": "skill-prepare-release",
          "kind": "skill",
          "path": "skills/prepare-release/SKILL.md",
          "sha256": "1d691ac5ac2982df232107dcc512eee39caa3165785e1e336e5d7b4463a3d617",
          "byteLength": 1163,
          "mediaType": "text/markdown"
        },
        {
          "id": "skill-rollback-plan",
          "kind": "skill",
          "path": "skills/rollback-plan/SKILL.md",
          "sha256": "6cbfdca8f06230f593a5fe45cedfe31863a0d3d89b8327f068075cc5f1eaf93f",
          "byteLength": 1124,
          "mediaType": "text/markdown"
        },
        {
          "id": "skill-smoke-check",
          "kind": "skill",
          "path": "skills/smoke-check/SKILL.md",
          "sha256": "6db69be169dd7fd5e092f4074f368631680daac46c3c879caf6b5eb4f2032ec8",
          "byteLength": 929,
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
        "sha256": "2263ea6736c487a646a80fc17525ff004cdc69201db0d28f9bd91a7028230abf",
        "byteLength": 965,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDlj5HluIPorrDlvZXvvJo86ZyA5rGC5qCH6aKYPg0KDQo+IOmcgOaxgue8luWPt++8mjxQUk9KRUNUX0tFWT4tPOW6j+WPtz4gwrcg54mI5pys77yadjEgwrcg546v5aKD77yaPHByb2QgLyBzdGFnaW5nPg0KPiDlj5HluIPotJ/otKPkurrvvJo8bmFtZT4gwrcg5pe26Ze056qX5Y+j77yaPHN0YXJ0PiDigJMgPGVuZD4NCg0KIyMgMS4g5Y+R5biD6IyD5Zu0DQoNCnwg5Y2V5YWDIHwg5Y+Y5pu0IHwg54mI5pysIHwNCnwgLS0tLSB8IC0tLS0gfCAtLS0tIHwNCnwgICAgICB8ICAgICAgfCAgICAgIHwNCg0KIyMgMi4g5L6d6LWW5LiO6aG65bqPDQoNCnwg6aG65bqPIHwg5a+56LGhIHwg5YmN572u5p2h5Lu2IHwg5piv5ZCm5Y+v5bm26KGMIHwNCnwgLS0tLSB8IC0tLS0gfCAtLS0tLS0tLSB8IC0tLS0tLS0tLS0gfA0KfCAxICAgIHwgICAgICB8ICAgICAgICAgIHwgICAgICAgICAgICB8DQoNCiMjIDMuIOeBsOW6puetlueVpQ0KDQp8IOmYtuautSB8IOiMg+WbtCB8IOinguWvn+aXtumVvyB8IOaUvumHj+adoeS7tiB8DQp8IC0tLS0gfCAtLS0tIHwgLS0tLS0tLS0gfCAtLS0tLS0tLSB8DQp8IDEgICAgfCAgICAgIHwgICAgICAgICAgfCAgICAgICAgICB8DQoNCiMjIDQuIOebkeaOpw0KDQp8IOaMh+aghyB8IOmYiOWAvCB8IOafpeeci+S9jee9riB8DQp8IC0tLS0gfCAtLS0tIHwgLS0tLS0tLS0gfA0KfCAgICAgIHwgICAgICB8ICAgICAgICAgIHwNCg0KIyMgNS4g5Zue5rua6Kem5Y+R5p2h5Lu2DQoNCi0g6ZSZ6K+v546H77yaDQotIOW7tui/n++8mg0KLSDkuJrliqHmjIfmoIfvvJoNCi0g5Lq65bel5Yik5pat77yaDQoNCiMjIDYuIOW9seWTjemcgOaxgg0KDQotIDzpnIDmsYLnvJblj7c+DQoNCiMjIDcuIOWPkeW4g+e7k+iuug0KDQotIFsgXSDlt7Llj5HluIPlubblhpLng5/pgJrov4cNCi0gWyBdIOmDqOWIhuWPkeW4g++8jOWOn+WboO+8mg0KLSBbIF0g5Zue5rua77yM5Y6f5Zug77yaDQo="
      },
      {
        "resourceId": "template-rollback",
        "path": "roles/ops/assets/templates/rollback.md",
        "sha256": "71e69c6269e50424c3618bf91f0258a40552f5d3cd3f5f8eedbadb093c64621d",
        "byteLength": 833,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDlm57mu5rmlrnmoYjvvJo86ZyA5rGC5qCH6aKYPg0KDQo+IOmcgOaxgue8luWPt++8mjxQUk9KRUNUX0tFWT4tPOW6j+WPtz4gwrcg5YWz6IGU5Y+R5biD77yaPHJlbGVhc2Ug6K6w5b2VPg0KPiDmvJTnu4Pml7bpl7TvvJo8dGltZT4gwrcg5ryU57uD546v5aKD77yaPGVudj4gwrcg6ICX5pe277yaPG1pbnV0ZXM+DQoNCiMjIDEuIOWbnua7muWvueixoQ0KDQp8IOWvueixoSB8IOexu+WeiyAgICAgICAgICAgICAgICAgICAgICB8IOWbnua7muaWueW8jyB8DQp8IC0tLS0gfCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHwgLS0tLS0tLS0gfA0KfCAgICAgIHwg5Luj56CBIC8g6YWN572uIC8g5pWw5o2uIC8g5L6d6LWWIHwgICAgICAgICAgfA0KDQojIyAyLiDop6blj5HmnaHku7YNCg0KLSDplJnor6/njocgPg0KLSDlu7bov58gPg0KLSDkuJrliqHmjIfmoIfvvJoNCi0g5Lq65bel5Yik5pat77yaDQoNCiMjIDMuIOatpemqpA0KDQoxLg0KMi4NCjMuDQoNCiMjIDQuIOaVsOaNruWbnua7mg0KDQotIOaYr+WQpuacieWPjeWQkei/geenu++8mg0KLSDml6Dlj43lkJHov4Hnp7vml7bnmoTooaXlgb/mlrnmoYjvvJoNCi0g5b2x5ZON55qE5pWw5o2u6IyD5Zu077yaDQoNCiMjIDUuIOa8lOe7g+iusOW9lQ0KDQp8IOmhuSAgICAgICB8IOe7k+aenCB8DQp8IC0tLS0tLS0tIHwgLS0tLSB8DQp8IOWPr+aJp+ihjCAgIHwgICAgICB8DQp8IOiAl+aXtiAgICAgfCAgICAgIHwNCnwg6aqM6K+B5pa55byPIHwgICAgICB8DQoNCiMjIDYuIOWbnua7muWQjumqjOivgQ0KDQotIOWBpeW6t+ajgOafpe+8mg0KLSDlhbPplK7mjqXlj6PvvJoNCi0g55uR5o6n5oGi5aSN77yaDQo="
      },
      {
        "resourceId": "template-smoke",
        "path": "roles/ops/assets/templates/smoke.md",
        "sha256": "7870808c7df3f79179b3f87ea7f52d7151901bd522b3825584aa08908bdfda9b",
        "byteLength": 745,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDlhpLng5/orrDlvZXvvJo86ZyA5rGC5qCH6aKYPg0KDQo+IOmcgOaxgue8luWPt++8mjxQUk9KRUNUX0tFWT4tPOW6j+WPtz4gwrcg546v5aKD77yaPHByb2Q+IMK3IOaXtumXtO+8mjx0aW1lPg0KPiDmiafooYzkurrvvJo8bmFtZT4NCg0KIyMgMS4g6IyD5Zu0DQoNCnwg6aqM5pS2IGtleSB8IOWGkueDn+mhuSB8IOe7k+aenCAgICAgICAgfA0KfCAtLS0tLS0tLSB8IC0tLS0tLSB8IC0tLS0tLS0tLS0tIHwNCnwgYWMtMDEgICAgfCAgICAgICAgfCDpgJrov4cgLyDlpLHotKUgfA0KDQojIyAyLiDnm5HmjqcNCg0KfCDmjIfmoIcgICB8IOWPkeW4g+WJjSB8IOWPkeW4g+WQjiB8IOWIpOWumiB8DQp8IC0tLS0tLSB8IC0tLS0tLSB8IC0tLS0tLSB8IC0tLS0gfA0KfCDplJnor6/njocgfCAgICAgICAgfCAgICAgICAgfCAgICAgIHwNCnwg5bu26L+fICAgfCAgICAgICAgfCAgICAgICAgfCAgICAgIHwNCg0KIyMgMy4g5byC5bi4DQoNCnwg546w6LGhIHwg5YiG5rWBICAgICAgICAgICAgICAgICAgICAgICB8IOWkhOeQhiB8DQp8IC0tLS0gfCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSB8IC0tLS0gfA0KfCAgICAgIHwg5pys5qyh5Y+Y5pu0IC8g546v5aKDIC8g5Y6G5Y+y6Zeu6aKYIHwgICAgICB8DQoNCiMjIDQuIOe7k+iuug0KDQotIFsgXSDpgJrov4cNCi0gWyBdIOinguWvn++8iOinguWvn+S6uu+8mu+8jOaXtumZkO+8mu+8iQ0KLSBbIF0g5Zue5rua77yI5omn6KGMIGByb2xsYmFjay5tZGDvvIkNCg=="
      },
      {
        "resourceId": "checklist-release-readiness",
        "path": "roles/ops/checklists/release-readiness.md",
        "sha256": "84442b66aeb83c55b5b9335bba5bc6626fe83ba1f3c93a137fbe88903c887a6f",
        "byteLength": 753,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDlj5HluIPlsLHnu6rmuIXljZUNCg0KLSBbIF0g5Y+R5biD6IyD5Zu05LiO5b2x5ZON6ZyA5rGC5bey5YiX5riF44CCDQotIFsgXSDkvp3otZbkuI7lj5HluIPpobrluo/lt7Lnoa7orqTvvIzlkKvmlbDmja7lupPov4Hnp7vjgIINCi0gWyBdIOeBsOW6puetlueVpeS4juaUvumHj+adoeS7tuW3suWGmeOAgg0KLSBbIF0g55uR5o6n6aG544CB6ZiI5YC844CB5p+l55yL5L2N572u5bey5YaZ44CCDQotIFsgXSDlm57mu5rop6blj5HmnaHku7blt7LlhpnvvIzkuJTlj6/liKTlrprjgIINCi0gWyBdIOWbnua7muaWueahiOW3sua8lOe7g++8jOiAl+aXtuW3suefpeOAgg0KLSBbIF0g5LiN5Y+v6YCG5pON5L2c5pyJ6KGl5YG/5pa55qGI44CCDQotIFsgXSDlhpLng5/pobnopobnm5bmnKzmrKHpqozmlLbjgIINCi0gWyBdIOWPkeW4g+eql+WPo+S4juWGu+e7k+e6v+S4jeWGsueqge+8jOaIlui1sCBob3RmaXgg6YCa6YGT5bm26K6w5b2V44CCDQotIFsgXSDlpJbpg6jns7vnu5/kuI3lj6/nlKjml7bvvIzpmY3nuqfmlrnmoYjlt7LlhpnjgIINCg0KIyMg5Lqk5LuY5YmN5pyA5ZCO5LiJ6ZeuDQoNCjEuIOWNiuWknOWHuumXrumimO+8jOWAvOePreeahOS6uuiDveS4jeiDveeFp+edgOi/meS7veaWh+aho+mAgOWbnuWOu++8nw0KMi4g54Gw5bqm5YiwIDEwJSDml7bnnIvlk6rkuKrmjIfmoIflhrPlrprnu6fnu63ov5jmmK/lgZzvvJ8NCjMuIOWPkeW4g+WQjuaAjuS5iOivgeaYjuOAjOi/measoeecn+eahOWlveS6huOAje+8nw0K"
      },
      {
        "resourceId": "checklist-spec-driven",
        "path": "roles/ops/checklists/spec-driven.md",
        "sha256": "f14e1b1d96d8be04b73192dba26f10acebad4354bbb6f8af8843c0e9320edcaa",
        "byteLength": 1136,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDop4TmoLzkuI7kuqTku5jljY/kvZzmo4Dmn6UNCg0K5Y+q5Yqg6L295pys5qyh5Lu75Yqh5raJ5Y+K55qE5qih5p2/5ZKM5riF5Y2V44CC566A5Y2V5pS55Yqo5YaZ5b+F6KaB5L+h5oGv77yb5aSN5p2C5bqm5p2l6Ieq6aOO6Zmp44CB5L6d6LWW5ZKM6aqM5pS26IyD5Zu077yM5LiN5oyJ5Zu65a6a6aG15pWw5oiW56ug6IqC5pWw5Yik5pat6LSo6YeP44CCDQoNCi0gWyBdIOW3suivu+acrOasoeW/q+eFp+S4jumhueebruinhOiMg++8jOehruiupCBQUkQv55+l6K+G5L+u6K6i77yb6ICB6aG555uu5YWI5qC45a+55a6e6ZmF5Luj56CB44CB5bel5YW36YWN572u5LiO546w5pyJ6KGM5Li644CCDQotIFsgXSDlhbPplK7nu5PorrrmnInmnaXmupDvvJvosIPmn6XmnKrnn6XpobnjgIHmlrnmoYjlj5boiI3jgIHkvovlpJbkuI7lu7bmnJ/lnYfmnInnkIbnlLHlkozotKPku7vkurrjgIINCi0gWyBdIOS7peW3suehruiupOmqjOaUtiBrZXkg5YWz6IGU5pys6KeS6Imy5Lqn54mp77yb5Lu75Yqh5YiX5L6d6LWW44CB6LSf6LSj5paH5Lu25LiO6aqM6K+B5pa55byP77yM5YWx55So5paH5Lu25LiN5peg5L6d5o2u5Zyw5bm26KGM5L+u5pS544CCDQotIFsgXSDpnIDmsYLotKjph4/jgIHnlKjkvovorr7orqHopobnm5bjgIHlrp7pmYXmiafooYznu5PmnpzlkowgSFVNQU4g5q2j5byP6aqM5pS25YiG5Yir6K6w5b2V44CCDQotIFsgXSDmiYDmnInmnKrov5DooYzjgIHlpLHotKXjgIHpmLvloZ7jgIHml6Dms5XmoLjpqoznmoTlhoXlrrnmmI7noa7moIflh7rvvJtBZ2VudCDmiqXlkYrkuI3lo7Dnp7Dni6znq4vpqozor4HjgIINCi0gWyBdIOe8uuWPo+S7peeos+WumiBJRCDov73liqDlubblm57pk77ljp/orrDlvZXvvJvotoXlh7rpnIDmsYLojIPlm7TlhYjotbDlj5jmm7TvvIzkv67mlLnln7rnur/lkI7ph43mlrDmoLjlr7nor4Hmja7jgIINCg0K6KeS6Imy6LWE5rqQ5pu05paw77ya5bey6ZSB5a6a54mI5pys5L+d5oyB5Y6f5a2X6IqC77yM5paw5pa55rOV5Zyo5paw5YyF54mI5pys5a6J6KOF5ZCO55Sf5pWI44CC5a6/5Li75YWl5Y+j5Y+q5oyH5ZCR6KeS6Imy6LWE5rqQ77yb6aG555uu6Ieq5a6a5LmJ6KeE6IyD6ZqP6aG555uu55+l6K+G5L+u6K6i77yM5LiN5aSN5Yi26L+b6KeS6Imy5YyF44CCDQo="
      },
      {
        "resourceId": "guide",
        "path": "roles/ops/guide.md",
        "sha256": "5a9cf93f936aa4a82186c633bbc896dde8e4b3652718417d5a3a663d13bef564",
        "byteLength": 2950,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDov5Dnu7Top5LoibLvvIhvcHPvvIkNCg0K5L2g5Lqn5Ye6IGBSRUxFQVNFYCDlt6Xku7bvvJrlj5HluIPorrDlvZXjgIHnjq/looPkuI7phY3nva7lj5jmm7TjgIHlhpLng5/nu5PmnpzjgIHlm57mu5rngrnjgIINCuWPkeW4g+atpemqpOacrOi6q+S7jeeUseS6uuexu+WcqCBXZWIg5LiK5YGa5pyA57uI5pS+6KGM44CCDQoNCiMjIOi+ueeVjA0KDQotIOWPquS6p+WHuiBgUkVMRUFTRWDvvJvkuI3mlLnlrp7njrDjgIHkuI3mlLkgUFJE44CB5LiN5Y+R5biD5rWB56iL5a6a5LmJ44CB5LiN5om55YeG6K+E5a6h44CCDQotIOavj+asoeWPkeW4g+W/hemhu+WGmeaYjioq5Zue5rua54K5KirvvIjkuIrkuIDniYjmnKzmoIfor4bmiJblj6/lm57mu5rov4Hnp7vvvInkuI4qKuWGkueDn+e7k+aenCoq44CCDQotIOeUn+S6p+WPmOabtOeahOWunumZheaJp+ihjOadg+mZkOS4jeWcqOacrOW5s+WPsOWGhe+8m+i/memHjOiusOW9leeahOaYr+WPr+WkjeaguOeahOivgeaNruOAgg0KDQojIyDkuIDmrKHlrozmlbTlvqrnjq8NCg0KYGBgYmFzaA0Kd29ya21lc2ggYXV0aCBsb2dpbg0KDQp3b3JrbWVzaCBjb250ZXh0IC0tdGFzayA8dGFza0lkPiAtLWluc3BlY3QNCndvcmttZXNoIGNsYWltIC0tdGFzayA8dGFza0lkPg0Kd29ya21lc2ggY29udGV4dCAtLXRhc2sgPHRhc2tJZD4gLS1jbGFpbSA8Y2xhaW1JZD4gLS1leHBlY3RlZC12ZXJzaW9uIDx0YXNrVmVyc2lvbj4gLS1tYXRlcmlhbGl6ZQ0KDQp3b3JrbWVzaCBkZWxpdmVyIFwNCiAgLS10YXNrIDx0YXNrSWQ+IC0tY2xhaW0gPGNsYWltSWQ+IC0tc25hcHNob3QgPHNuYXBzaG90SWQ+IFwNCiAgLS1leHBlY3RlZC12ZXJzaW9uIDx0YXNrVmVyc2lvbj4gXA0KICAtLW1hbmlmZXN0IGRlbGl2ZXItbWFuaWZlc3QuanNvbg0KDQojIOS9v+eUqCBkZWxpdmVyIOi/lOWbnueahOecn+WuniByZXZpZXdSZXF1ZXN0SWQg5p+l6K+i6Ieq5Yqo5Yib5bu655qE6K+E5a6hDQp3b3JrbWVzaCByZXZpZXcgc2hvdyAtLXJldmlldyA8cmV2aWV3UmVxdWVzdElkPg0KYGBgDQoNCmBkZWxpdmVyYCDov5Tlm54gYHJldmlld1JlcXVlc3RJZGDjgIFXZWIg5Zyw5Z2A5ZKMIGBvcGVyYXRpb25JZGDvvIzkuI3nlKjlho3mrKHliJvlu7rlkIzkuIDova7or4TlrqHjgILovpPlh7rkuKLlpLHml7bvvIznlKggYHdvcmttZXNoIHJlY2VpcHQgc2hvdyAtLW9wZXJhdGlvbiA85Y6f5Lqk5LuYb3BlcmF0aW9uSWQ+IC0tanNvbmAg6K+75Y+WIGBkYXRhLnJlc3VsdFJlZnMucmV2aWV3UmVxdWVzdElkYO+8m+aUtuaNruS7jeS4uiBQRU5ESU5HIOaIlue7k+aenOacquefpeaXtu+8jOWFiOeUqOWOn+aTjeS9nOe8luWPt+aJp+ihjCBgd29ya21lc2ggcmVjZWlwdCByZWNvbmNpbGUgLS1vcGVyYXRpb24gPOWOn+S6pOS7mG9wZXJhdGlvbklkPmDjgILmraPlvI/lhrPlrprku43nlLEgSFVNQU4g5ZyoIFdlYiDlrozmiJDjgIINCg0KIyMgZGVsaXZlciBtYW5pZmVzdCDopoHngrkNCg0KYGBganNvbg0Kew0KICAid29ya2Zsb3dEZWZpbml0aW9uUmV2aXNpb25JZCI6ICI8c25hcHNob3Qg6YeM6K6w5b2V55qEIHdvcmtmbG93IOS/ruiuoj4iLA0KICAibG9jYWxSdW5JZCI6ICI85pys5Zyw5Y+v5aSN546w55qE6L+Q6KGM5qCH6K+GPiIsDQogICJpdGVtcyI6IFsNCiAgICB7DQogICAgICAia2luZCI6ICJSRUxFQVNFIiwNCiAgICAgICJzdG9yYWdlIjogIkhPU1RFRCIsDQogICAgICAibWVkaWFUeXBlIjogInRleHQvbWFya2Rvd24iLA0KICAgICAgInNoYTI1NiI6ICI85q2j5paHIHNoYTI1Nj4iLA0KICAgICAgImJ5dGVMZW5ndGgiOiAxMDI0LA0KICAgICAgImJvZHlCYXNlNjQiOiAiPGJhc2U2ND4iLA0KICAgICAgInN1bW1hcnkiOiAiY2hlY2tvdXQgMS40LjAg5bey5Y+R5biD77yb5YaS54Of6YCa6L+H77yb5Zue5rua54K5IDEuMy4yIiwNCiAgICAgICJjaGVja3MiOiBbDQogICAgICAgIHsgImNvZGUiOiAicHJlZmxpZ2h0IiwgInBhc3NlZCI6IHRydWUgfSwNCiAgICAgICAgeyAiY29kZSI6ICJzbW9rZSIsICJwYXNzZWQiOiB0cnVlIH0sDQogICAgICAgIHsgImNvZGUiOiAicm9sbGJhY2stcGxhbiIsICJwYXNzZWQiOiB0cnVlIH0NCiAgICAgIF0NCiAgICB9DQogIF0NCn0NCmBgYA0KDQrmraPmlofph4zlhpnmuIXvvJrniYjmnKzlj7fjgIHlj5jmm7Tnqpflj6PjgIHmiafooYzlkb3ku6TjgIHlhpLng5/lkb3ku6TkuI7ovpPlh7rmkZjopoHjgIHlm57mu5rmraXpqqTjgIINCg0KIyMg56aB5q2iDQoNCi0g5LiN6KaB5Zyo5YaS54Of5pyq5omn6KGM5pe25Yu+6YCJIGBzbW9rZWDjgIINCi0g5LiN6KaB55yB55Wl5Zue5rua54K577yb5LiN5Y+v5Zue5rua6KaB5pi+5byP5YaZ5piOIuS4jeWPr+Wbnua7miLlj4rljp/lm6DjgIINCi0g5LiN6KaB5YaZ5YWl5Lu75L2V5a+G6ZKl44CBdG9rZW7jgIHor4Hkuabnp4HpkqXjgIINCg0KIyMg5aSx6LSl5LiO6YeN6K+VDQoNCi0g5YaZ5pON5L2c5LiN6Ieq5Yqo6YeN6K+V77yb6YeN5pS+5aSN55So5ZCM5LiA5LiqIGAtLW9wZXJhdGlvbiA8dXVpZD5g44CCDQotIOe7k+aenOS4jeaYju+8mmB3b3JrbWVzaCByZWNlaXB0IHNob3cgLS1vcGVyYXRpb24gPHV1aWQ+YCDihpIgYHdvcmttZXNoIHJlY2VpcHQgcmVjb25jaWxlYOOAgg0KLSDlj5HluIPooqvpgIDlm57vvJrmjInlvZPliY3ku7vliqHlkowgY2xhaW0g54q25oCB6L+U5L+u5ZCO6YeN5pawIGBkZWxpdmVyYO+8jOWGjeeUqOacrOi9rui/lOWbnueahCBgcmV2aWV3UmVxdWVzdElkYCDmiafooYwgYHJldmlldyBzaG93YO+8m+aWsOS6pOS7mOS8muiHquWKqOWIm+W7uuacrOi9ruivhOWuoeOAgg0KDQojIyDop4TmoLzkuI7kuqTku5joh6rmo4ANCg0K5byA5bel5oiW6L+U5L+u5pe25oyJIGBjaGVja2xpc3RzL3NwZWMtZHJpdmVuLm1kYCDmoLjlr7nojIPlm7TjgIHkvp3mja7jgIHniYjmnKzkuI7kuqTmjqXvvJvlj6ror7vlj5blvZPliY3pmLbmrrXpnIDopoHnmoTotYTmupDjgIINCg=="
      },
      {
        "resourceId": "reference-references",
        "path": "roles/ops/references/references.json",
        "sha256": "45899bfea7d68db94cd3160062dce2b57db5df068c64d6576a0b82bb81e4cdab",
        "byteLength": 682,
        "mediaType": "application/json",
        "bodyBase64": "ew0KICAidmVyc2lvbiI6IDEsDQogICJub3RlIjogIuWPquaUvuaMh+mSiO+8jOS4jeaUvuato+aWh+OAgnNjb3BlOiBQUk9KRUNUIHwgVU5JVCB8IFJPTEXjgILot6/lvoTlnKjov5DooYzml7bnlLHlv6vnhafop6PmnpDjgIIiLA0KICAiZW50cmllcyI6IFsNCiAgICB7DQogICAgICAia2V5IjogInVuaXQtY2FyZCIsDQogICAgICAic2NvcGUiOiAiVU5JVCIsDQogICAgICAicmVmIjogImtub3dsZWRnZTovLzxwcm9qZWN0LWtleT4vc3lzdGVtLzx1bml0LWtleT4vY2FyZCINCiAgICB9LA0KICAgIHsNCiAgICAgICJrZXkiOiAicnVuYm9vayIsDQogICAgICAic2NvcGUiOiAiVU5JVCIsDQogICAgICAicmVmIjogImtub3dsZWRnZTovLzxwcm9qZWN0LWtleT4vc3lzdGVtLzx1bml0LWtleT4vcnVuYm9vayINCiAgICB9LA0KICAgIHsNCiAgICAgICJrZXkiOiAiY29udmVudGlvbnMiLA0KICAgICAgInNjb3BlIjogIlBST0pFQ1QiLA0KICAgICAgInJlZiI6ICJrbm93bGVkZ2U6Ly88cHJvamVjdC1rZXk+L3N5c3RlbS9jb252ZW50aW9ucyINCiAgICB9LA0KICAgIHsNCiAgICAgICJrZXkiOiAicmVsZWFzZS1sb2ciLA0KICAgICAgInNjb3BlIjogIlBST0pFQ1QiLA0KICAgICAgInJlZiI6ICJrbm93bGVkZ2U6Ly88cHJvamVjdC1rZXk+L3N5c3RlbS9yZWxlYXNlLWxvZyINCiAgICB9DQogIF0NCn0NCg=="
      },
      {
        "resourceId": "skills-index",
        "path": "roles/ops/skills/index.md",
        "sha256": "20771f2316d33e31aae0d072570b8f404abc0318013d467040a0dcae35405e35",
        "byteLength": 802,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDov5Dnu7Top5LoibLljIUgwrcg5oqA6IO957Si5byVDQoNCnwg5oqA6IO9ICAgICAgICAgICAgICB8IOWBmuS7gOS5iCAgICAgICAgICAgICAgICAgICAgICAgICAgIHwg5L2V5pe255SoICAgICAgIHwNCnwgLS0tLS0tLS0tLS0tLS0tLS0gfCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSB8IC0tLS0tLS0tLS0tLSB8DQp8IGBwcmVwYXJlLXJlbGVhc2VgIHwg5Y+R5biD6K6h5YiS77ya5L6d6LWW44CB6aG65bqP44CB54Gw5bqm44CB55uR5o6nIHwg6L+b5YWl5Y+R5biD5YCZ6YCJIHwNCnwgYHJvbGxiYWNrLXBsYW5gICAgfCDlm57mu5rmlrnmoYjlubbpqozor4Hlj6/miafooYwgICAgICAgICAgICAgfCDlj5HluIPliY0gICAgICAgfA0KfCBgc21va2UtY2hlY2tgICAgICB8IOeUn+S6p+WGkueDn+W5tue7mee7k+iuuiAgICAgICAgICAgICAgICAgfCDlj5HluIPlkI4gICAgICAgfA0KDQojIyDkvb/nlKjpobrluo8NCg0KYGBgDQpwcmVwYXJlLXJlbGVhc2Ug4oaSIHJvbGxiYWNrLXBsYW4g4oaSIOWPkeW4gyDihpIgc21va2UtY2hlY2sNCmBgYA0KDQrlm57mu5rmlrnmoYjlv4XpobvlnKjlj5HluIMqKuS5i+WJjSoq6aqM6K+B77yM5Y+R5biD5ZCO5YaN5oOz5oCO5LmI6YCA5bey57uP5pma5LqG44CCDQoNCiMjIOS6pOaOpQ0KDQotIOiuoeWIkiDihpIgYHJlbGVhc2UubWRg77yM5Lqk5Y+R5biD6K+E5a6h44CCDQotIOWbnua7miDihpIgYHJvbGxiYWNrLm1kYO+8jOWPkeW4g+WJjea8lOe7g+S4gOasoeOAgg0KLSDlhpLng58g4oaSIGBzbW9rZS5tZGDvvIzkuqTlj5HluIPnoa7orqTjgIINCg=="
      },
      {
        "resourceId": "skill-prepare-release",
        "path": "roles/ops/skills/prepare-release/SKILL.md",
        "sha256": "1d691ac5ac2982df232107dcc512eee39caa3165785e1e336e5d7b4463a3d617",
        "byteLength": 1163,
        "mediaType": "text/markdown",
        "bodyBase64": "LS0tDQpuYW1lOiBwcmVwYXJlLXJlbGVhc2UNCmRlc2NyaXB0aW9uOiDnlJ/miJDlj5HluIPorqHliJLvvIzlhpnmuIXkvp3otZbjgIHlj5HluIPpobrluo/jgIHngbDluqbnrZbnlaXjgIHnm5HmjqfpobnkuI7lm57mu5rop6blj5HmnaHku7bvvJvlvZPpnIDmsYLov5vlhaXlj5HluIPlgJnpgInml7bkvb/nlKjjgIINCmxpY2Vuc2U6IE1JVA0KbWV0YWRhdGE6DQogIHJvbGVLZXk6IG9wcw0KICBwYWNrYWdlVmVyc2lvbjogMC4xLjANCi0tLQ0KDQojIOWHhuWkh+WPkeW4gw0KDQojIyDkvZXml7bnlKgNCg0KLSDpnIDmsYLov5vlhaXlj5HluIPlgJnpgInvvIzmtYvor5XpgJrov4fjgIINCi0g5aSa5pyN5Yqh5a2Y5Zyo5Y+R5biD6aG65bqP5L6d6LWW44CCDQoNCiMjIOatpemqpA0KDQoxLiDor7sgUFJEIOmqjOaUtuS4juWPkeW4g+iMg+WbtO+8jOehruiupOimgeWPkeS7gOS5iOOAgg0KMi4g5YiX5L6d6LWW77ya5pyN5Yqh44CB5pWw5o2u5bqT6L+B56e744CB6YWN572u44CB56ys5LiJ5pa544CCDQozLiDlrprpobrluo/vvJrlhYjlj5Hku4DkuYjjgIHlkI7lj5Hku4DkuYjjgIHog73lkKblubbooYzjgIINCjQuIOWumueBsOW6pu+8muaMieeUqOaIt+OAgeaMiea1gemHj+OAgeaMieenn+aIt++8jOWGmea4heaUvumHj+iKguWlj+OAgg0KNS4g5a6a55uR5o6n77ya55yL5ZOq5Lqb5oyH5qCH44CB6ZiI5YC85aSa5bCR44CB6LCB5p2l55yL44CCDQo2LiDlrprlm57mu5rop6blj5HmnaHku7bvvJrku4DkuYjmg4XlhrXlv4XpobvpgIDjgIINCjcuIOS6p+WHuiBgcmVsZWFzZS5tZGDjgIINCg0KIyMg6KeE5YiZDQoNCi0g5rKh5pyJ5Zue5rua6Kem5Y+R5p2h5Lu255qE5Y+R5biD6K6h5YiS5LiN566X5a6M5oiQ44CCDQotIOaVsOaNruW6k+i/geenu+S4juS7o+eggeWPkeW4g+WIhuW8gO+8muWFiOWFvOWuueOAgeWGjeWIh+aNouOAgeWQjua4heeQhuOAgg0KLSDlj5HluIPnqpflj6PkuI7lhrvnu5Pnur/lhrLnqoHml7bvvIzotbAgaG90Zml4IOmAmumBk+W5tuiusOW9leOAgg0KLSDkvp3otZblpJbpg6jns7vnu5/ml7bvvIzlhpnmuIXlr7nmlrnkuI3lj6/nlKjml7bnmoTpmY3nuqfjgIINCg0KIyMg5Lqk5o6lDQoNCmByZWxlYXNlLm1kYCDkuqTlj5HluIPor4TlrqHvvJvor4TlrqHpgJrov4flkI7ov5vlhaUgYHJvbGxiYWNrLXBsYW5g44CCDQo="
      },
      {
        "resourceId": "skill-rollback-plan",
        "path": "roles/ops/skills/rollback-plan/SKILL.md",
        "sha256": "6cbfdca8f06230f593a5fe45cedfe31863a0d3d89b8327f068075cc5f1eaf93f",
        "byteLength": 1124,
        "mediaType": "text/markdown",
        "bodyBase64": "LS0tDQpuYW1lOiByb2xsYmFjay1wbGFuDQpkZXNjcmlwdGlvbjog57yW5YaZ5bm25ryU57uD5Zue5rua5pa55qGI77yM5piO56Gu6Kem5Y+R5p2h5Lu244CB5q2l6aqk44CB5pWw5o2u5oGi5aSN5LiO6aqM6K+B5pa55byP77yb5b2T5Y+R5biD6K6h5YiS56Gu5a6a44CB5omn6KGM5Y+R5biD5YmN5L2/55So44CCDQpsaWNlbnNlOiBNSVQNCm1ldGFkYXRhOg0KICByb2xlS2V5OiBvcHMNCiAgcGFja2FnZVZlcnNpb246IDAuMS4wDQotLS0NCg0KIyDlm57mu5rmlrnmoYgNCg0KIyMg5L2V5pe255SoDQoNCi0g5Y+R5biD6K6h5YiS5bey5a6a77yM5omn6KGM5Y+R5biD5YmN44CCDQotIOWPmOabtOa2ieWPiuaVsOaNruW6k+aIluS4jeWPr+mAhuaTjeS9nOOAgg0KDQojIyDmraXpqqQNCg0KMS4g5YiX5Zue5rua5a+56LGh77ya5Luj56CB44CB6YWN572u44CB5pWw5o2u44CB5L6d6LWW44CCDQoyLiDlhpnop6blj5HmnaHku7bvvJrplJnor6/njofjgIHlu7bov5/jgIHkuJrliqHmjIfmoIfjgIHkurrlt6XliKTmlq3jgIINCjMuIOWGmeatpemqpO+8muaMiemhuuW6j+OAgeWPr+WkjeWItueymOi0tOOAgeWQq+mqjOivgeWRveS7pOOAgg0KNC4g5pWw5o2u5Zue5rua77ya6L+B56e75piv5ZCm5pyJ5Y+N5ZCR6ISa5pys77yb5peg5YiZ5YaZ6KGl5YG/5pa55qGI44CCDQo1LiDmvJTnu4PvvJrlnKjpmpTnprvnjq/looPot5HkuIDpgY3vvIzorrDlvZXogJfml7bjgIINCjYuIOS6p+WHuiBgcm9sbGJhY2subWRg44CCDQoNCiMjIOinhOWImQ0KDQotICoq5rKh5pyJ5ryU57uD6L+H55qE5Zue5rua5pa55qGI562J5LqO5rKh5pyJKirjgIINCi0g5LiN5Y+v6YCG5pON5L2c77yI5Yig6KGo44CB5Y+R5raI5oGv44CB6LCD56ys5LiJ5pa577yJ5b+F6aG75pyJ6KGl5YG/5pa55qGI44CCDQotIOWbnua7muatpemqpOS4jeiDveS+nei1luOAjOW9k+aXtumCo+S4quS6uui/mOWcqOOAjeOAgg0KLSDlm57mu5rlkI7opoHpqozor4HvvJrlgaXlurfmo4Dmn6XjgIHlhbPplK7mjqXlj6PjgIHnm5HmjqfmgaLlpI3jgIINCg0KIyMg5Lqk5o6lDQoNCmByb2xsYmFjay5tZGAg6ZqP5Y+R5biD6K6h5YiS5LiA6LW36K+E5a6h77yb5Y+R5biD5pe25YC854+t5Lq65ZGY5Y+v55u05o6l5omn6KGM44CCDQo="
      },
      {
        "resourceId": "skill-smoke-check",
        "path": "roles/ops/skills/smoke-check/SKILL.md",
        "sha256": "6db69be169dd7fd5e092f4074f368631680daac46c3c879caf6b5eb4f2032ec8",
        "byteLength": 929,
        "mediaType": "text/markdown",
        "bodyBase64": "LS0tDQpuYW1lOiBzbW9rZS1jaGVjaw0KZGVzY3JpcHRpb246IOaMiemqjOaUtuWBmueUn+S6p+WGkueDn++8jOiusOW9lee7k+aenOOAgeW8guW4uOS4jue7k+iuuu+8m+W9k+WPkeW4g+WujOaIkOWQjuS9v+eUqOOAgg0KbGljZW5zZTogTUlUDQptZXRhZGF0YToNCiAgcm9sZUtleTogb3BzDQogIHBhY2thZ2VWZXJzaW9uOiAwLjEuMA0KLS0tDQoNCiMg55Sf5Lqn5YaS54OfDQoNCiMjIOS9leaXtueUqA0KDQotIOWPkeW4g+WujOaIkO+8jOmcgOimgeehruiupOeUn+S6p+WPr+eUqOOAgg0KLSDlm57mu5rlkI7pnIDopoHnoa7orqTmgaLlpI3jgIINCg0KIyMg5q2l6aqkDQoNCjEuIOmAieWGkueDn+iMg+WbtO+8muWFs+mUrui3r+W+hCArIOacrOasoeWPmOabtOa2ieWPiueahOmqjOaUtuOAgg0KMi4g6YCQ5p2h5omn6KGM77ya6K6w5b2V5pe26Ze044CB57uT5p6c44CB5byC5bi444CCDQozLiDnnIvnm5HmjqfvvJrplJnor6/njofjgIHlu7bov5/jgIHlhbPplK7kuJrliqHmjIfmoIfjgIINCjQuIOWIpOWumu+8mumAmui/hyAvIOinguWvnyAvIOWbnua7muOAgg0KNS4g5Lqn5Ye6IGBzbW9rZS5tZGDjgIINCg0KIyMg6KeE5YiZDQoNCi0g5YaS54Of6KaG55uW6aqM5pS277yM5LiN6KaG55uW44CM5oiR6KeJ5b6X6YeN6KaB44CN44CCDQotIOWksei0peimgeeri+WNs+WIhua1ge+8muacrOasoeWPmOabtCAvIOeOr+WigyAvIOWOhuWPsumXrumimOOAgg0KLSDjgIzop4Llr5/jgI3lv4XpobvmnInop4Llr5/kurrlkozml7bpmZDvvIzkuI3og73mgqznqbrjgIINCi0g5Zue5rua5ZCO5ZCM5qC36KaB5YaS54Of77yM56Gu6K6k55yf55qE5oGi5aSN5LqG44CCDQoNCiMjIOS6pOaOpQ0KDQpgc21va2UubWRgIOS6pOWPkeW4g+ehruiupO+8m+e7k+iuuuS4uuOAjOWbnua7muOAjeaXtueri+WNs+aJp+ihjCBgcm9sbGJhY2subWRg44CCDQo="
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
          "sha256": "86764db80718d9fba9b28bb72aff48c753c6940aef8317f334c04129c22a5282",
          "byteLength": 1597,
          "mediaType": "text/markdown"
        },
        {
          "id": "template-acceptance-json",
          "kind": "template",
          "path": "assets/templates/acceptance.json",
          "sha256": "6ef5c2de8442fcb018eff93fd2608055b958d8473da9a153834643f33b55c608",
          "byteLength": 310,
          "mediaType": "application/json"
        },
        {
          "id": "template-acceptance",
          "kind": "template",
          "path": "assets/templates/acceptance.yaml",
          "sha256": "57823f3e61140a59ee63459682faeb1873d599f187896a3c0789cff231c574ea",
          "byteLength": 802,
          "mediaType": "application/yaml"
        },
        {
          "id": "template-idea-assessment",
          "kind": "template",
          "path": "assets/templates/idea-assessment.md",
          "sha256": "749f21fbbac96a39f73436c5860397c3f6d9e976d7830db58bd765235eeba7ba",
          "byteLength": 848,
          "mediaType": "text/markdown"
        },
        {
          "id": "template-prd",
          "kind": "template",
          "path": "assets/templates/prd.md",
          "sha256": "49f0dd404f834d913a07ea964fe56c7ad271849f9be5afa757f89f4a6673468e",
          "byteLength": 1783,
          "mediaType": "text/markdown"
        },
        {
          "id": "template-understanding",
          "kind": "template",
          "path": "assets/templates/understanding.md",
          "sha256": "d90e0ac274b6b012ce6d3e710d8f40556a05a7b674dc952da25f863a81916bb3",
          "byteLength": 582,
          "mediaType": "text/markdown"
        },
        {
          "id": "checklist-prd-quality",
          "kind": "checklist",
          "path": "checklists/prd-quality.md",
          "sha256": "0d6977e8e110a2b28decb83c89168d4a4cf8ebffeace9baccbde29c9b84a09c3",
          "byteLength": 1620,
          "mediaType": "text/markdown"
        },
        {
          "id": "checklist-spec-driven",
          "kind": "checklist",
          "path": "checklists/spec-driven.md",
          "sha256": "f14e1b1d96d8be04b73192dba26f10acebad4354bbb6f8af8843c0e9320edcaa",
          "byteLength": 1136,
          "mediaType": "text/markdown"
        },
        {
          "id": "guide",
          "kind": "prompt",
          "path": "guide.md",
          "sha256": "74b72042ba10b374d5e0e8b30a3a912e6563ee29111278e9f72013b65fa9f261",
          "byteLength": 4428,
          "mediaType": "text/markdown"
        },
        {
          "id": "reference-references",
          "kind": "reference",
          "path": "references/references.json",
          "sha256": "0421f40552816a85d64f1804ee3f862f9d48ca62c97fe260d287b58ae9e0b34d",
          "byteLength": 562,
          "mediaType": "application/json"
        },
        {
          "id": "skill-assess-idea",
          "kind": "skill",
          "path": "skills/assess-idea/SKILL.md",
          "sha256": "55d1a8a4ffd12449cfe952841f49df700dccdb8bc71249c5b9418011dd8cf348",
          "byteLength": 1186,
          "mediaType": "text/markdown"
        },
        {
          "id": "skill-check-requirements",
          "kind": "skill",
          "path": "skills/check-requirements/SKILL.md",
          "sha256": "47f45ae2549d67f4c0d7bb2d22032844a5ec55d0f0fc939fb1880b097adcd5ee",
          "byteLength": 1662,
          "mediaType": "text/markdown"
        },
        {
          "id": "skill-clarify-intent",
          "kind": "skill",
          "path": "skills/clarify-intent/SKILL.md",
          "sha256": "039509702185badda3518a59b89bb6eedf713264cd3a118e3ca4fe0b1e617f24",
          "byteLength": 1942,
          "mediaType": "text/markdown"
        },
        {
          "id": "skills-index",
          "kind": "index",
          "path": "skills/index.md",
          "sha256": "73e04827b4c439c82a79afe383831ec26713d3d063183ca3080399c0de0fd8a4",
          "byteLength": 1466,
          "mediaType": "text/markdown"
        },
        {
          "id": "skill-map-acceptance",
          "kind": "skill",
          "path": "skills/map-acceptance/SKILL.md",
          "sha256": "4a55c9194e6271027e23822269ca40555157cb1bee1682d849b3b208a901a7e5",
          "byteLength": 2544,
          "mediaType": "text/markdown"
        },
        {
          "id": "skill-write-prd",
          "kind": "skill",
          "path": "skills/write-prd/SKILL.md",
          "sha256": "529702e36cc56b999c3ff74ae91f2828bdf8409bcd957fc15f2c2acc65afc1be",
          "byteLength": 2103,
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
        "sha256": "86764db80718d9fba9b28bb72aff48c753c6940aef8317f334c04129c22a5282",
        "byteLength": 1597,
        "mediaType": "text/markdown",
        "bodyBase64": "IyBQUkQg56S65L6L77ya5pSv5oyB5pys5Zyw5qih5Z6L5o6l5YWlDQoNCj4g6ZyA5rGC57yW5Y+377yaWUZGLTAwMyDCtyDniYjmnKzvvJp2MSDCtyDnirbmgIHvvJrlt7Llj5HluIMNCj4g5L6d5o2u55CG6Kej77yadW5kZXJzdGFuZGluZyB2MQ0KDQojIyAxLiDog4zmma8NCg0K5LyB5Lia5a6i5oi36KaB5rGC5qih5Z6L6LCD55So5LiN5Ye65YaF572R44CC5b2T5YmN5Y+q5pSv5oyB5LqR56uv5qih5Z6L77yM5a+86Ie05Lik5Liq5Zyo6LCI5a6i5oi35peg5rOV6YeH6LSt44CCDQoNCiMjIDIuIOebruaghw0KDQrnlKjmiLflj6/ku6XlnKjorr7nva7pobXliIfmjaLliLDmnKzlnLDmqKHlnovvvIzliIfmjaLlkI7mlrDlu7rnmoTlr7nor53kvb/nlKjmnKzlnLDmqKHlnovvvIzkuJTkuI3pnIDopoHph43lkK/lupTnlKjjgIINCg0KIyMgMy4g6IyD5Zu0DQoNCioq5YGaKioNCg0KLSDorr7nva7pobXmlrDlop7jgIzmqKHlnovmnaXmupDjgI3pgInpobnvvJrkupHnq68gLyDmnKzlnLDjgIINCi0g5pys5Zyw5qih5byP5LiL5qCh6aqM5Zyw5Z2A5Y+v6L6+77yM5LiN5Y+v6L6+5pe257uZ5Ye65piO56Gu5o+Q56S644CCDQotIOWIh+aNouWPquW9seWTjeaWsOWvueivne+8jOW3suacieWvueivneS/neaMgeWOn+aooeWei+OAgg0KDQoqKuS4jeWBmioqDQoNCi0g5LiN5YGa5pys5Zyw5qih5Z6L55qE6YOo572y5LiO6L+Q57u044CCDQotIOS4jeWBmuWkmuacrOWcsOaooeWei+i0n+i9veWdh+ihoeOAgg0KDQojIyA0LiDmlrnmoYjopoHngrkNCg0KLSDmnKzlnLDlnLDlnYDlj6rlhYHorrjlhoXnvZHmrrXvvIznpoHmraLlhaznvZHlnLDlnYDjgIINCi0gQVBJIGtleSDlnKjmnKzlnLDmqKHlvI/kuIvlj6/nlZnnqbrvvIzkvYbnlYzpnaLlv4XpobvljLrliIbjgIzmnKrphY3nva7jgI3kuI7jgIzphY3nva7plJnor6/jgI3jgIINCg0KIyMgNS4g5L6d6LWW5LiO57qm5p2fDQoNCnwg57G75Z6LIHwg5YaF5a65ICAgICAgICAgICAgICAgICAgICAgICAgICAgfCDlvbHlk40gICAgICAgfA0KfCAtLS0tIHwgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHwgLS0tLS0tLS0tLSB8DQp8IOWlkee6piB8IOaooeWei+iwg+eUqOe7n+S4gOi1sCBwcm92aWRlciDpgILphY3lsYIgfCDkuI3mlrDlop7nm7Tov54gfA0KfCDlkIjop4QgfCDmnKzlnLDlnLDlnYDkuI3lvpflpJblj5EgICAgICAgICAgICAgICB8IOaXpeW/l+iEseaVjyAgIHwNCg0KIyMgNi4g6aqM5pS2DQoNCuingSBgYWNjZXB0YW5jZS55YW1sYOOAgueJueWIq+ivtOaYju+8mmFjLTAxIOS4jiBhYy0wMiDnmoTliKTlrprpnIDopoHlnKjlkIzkuIDkvJror53lhoXov57nu63liIfmjaLkuKTmrKHjgIINCg0KIyMg5pyq5Yaz6Zeu6aKYDQoNCnwg6Zeu6aKYICAgICAgICAgICAgICAgICAgICAgICAgICAgfCDpmLvloZ4gfCDotKPku7vkurogfCDnirbmgIEgICAgICAgICB8DQp8IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSB8IC0tLS0gfCAtLS0tLS0gfCAtLS0tLS0tLS0tLS0gfA0KfCDmnKzlnLDmqKHlnovpibTmnYPmlrnlvI/mmK/lkKbkuI7kupHnq6/kuIDoh7QgfCDlkKYgICB8IOWQjuerryAgIHwg5bey5r6E5riF77ya5LiA6Ie0IHwNCg=="
      },
      {
        "resourceId": "template-acceptance-json",
        "path": "roles/product/assets/templates/acceptance.json",
        "sha256": "6ef5c2de8442fcb018eff93fd2608055b958d8473da9a153834643f33b55c608",
        "byteLength": 310,
        "mediaType": "application/json",
        "bodyBase64": "Ww0KICB7ICJrZXkiOiAiYWMtMDEiLCAidGV4dCI6ICI85LiA5Liq5Y+v6KeC5rWL57uT5p6c77yM5LiA5Y+l6K+d77yM5Y+v5Yik5a6aPiIsICJ2ZXJpZmljYXRpb24iOiAiVEVTVCIgfSwNCiAgeyAia2V5IjogImFjLTAyIiwgInRleHQiOiAiPOeVjOmdoi/mlofmoYgv6YWN572u57G757uT5p6cPiIsICJ2ZXJpZmljYXRpb24iOiAiSU5TUEVDVElPTiIgfSwNCiAgeyAia2V5IjogImFjLTAzIiwgInRleHQiOiAiPOmcgOimgeaMieatpemqpOa8lOekuuaJjeiDveWIpOaWreeahOe7k+aenD4iLCAidmVyaWZpY2F0aW9uIjogIkRFTU8iIH0NCl0NCg=="
      },
      {
        "resourceId": "template-acceptance",
        "path": "roles/product/assets/templates/acceptance.yaml",
        "sha256": "57823f3e61140a59ee63459682faeb1873d599f187896a3c0789cff231c574ea",
        "byteLength": 802,
        "mediaType": "application/yaml",
        "bodyBase64": "IyDpqozmlLbmnaHnm67mqKHmnb8NCiMga2V5IOeos+WumuOAgeawuOS4jeWkjeeUqO+8m+WIoOmZpOadoeebrueUqOWik+eikeagh+iusO+8jOS4jeWkjeeUqCBrZXnjgIINCiMgdmVyaWZpY2F0aW9uOiBURVNUIHwgSU5TUEVDVElPTiB8IERFTU8NCiMg5q2j5byPIEFQSSDlrZfmrrXlj6rmnIkga2V5IC8gdGV4dCAvIHZlcmlmaWNhdGlvbu+8m+mjjumZqeWIhuexu+WGmeWcqCBQUkQv6K+E5a6h5p2Q5paZ44CCDQojIGNhbmRpZGF0ZSAtLWFjY2VwdGFuY2Ug6K+75Y+WIEpTT04g5pWw57uE77yb5L2/55So6YWN5aWXIGFjY2VwdGFuY2UuanNvbiDmiJblhYjovazmjaIgYWNjZXB0YW5jZSDmlbDnu4TjgIINCg0KdmVyc2lvbjogMQ0KcmVxdWlyZW1lbnQ6IDxQUk9KRUNUX0tFWT4tPOW6j+WPtz4NCg0KYWNjZXB0YW5jZToNCiAgLSBrZXk6IGFjLTAxDQogICAgdGV4dDogPOS4gOS4quWPr+ingua1i+e7k+aenO+8jOS4gOWPpeivne+8jOWPr+WIpOWumj4NCiAgICB2ZXJpZmljYXRpb246IFRFU1QNCg0KICAtIGtleTogYWMtMDINCiAgICB0ZXh0OiA855WM6Z2iL+aWh+ahiC/phY3nva7nsbvnu5Pmnpw+DQogICAgdmVyaWZpY2F0aW9uOiBJTlNQRUNUSU9ODQoNCiAgLSBrZXk6IGFjLTAzDQogICAgdGV4dDogPOmcgOimgeaMieatpemqpOa8lOekuuaJjeiDveWIpOaWreeahOe7k+aenD4NCiAgICB2ZXJpZmljYXRpb246IERFTU8NCg0KcmVtb3ZlZDogW10NCiMgcmVtb3ZlZCDnpLrkvovvvJotIGtleTogYWMtMDBcbiMgICByZWFzb246IDzkuLrku4DkuYjliKDpmaQ+XG4jICAgcmVwbGFjZWRCeTogYWMtMDENCg=="
      },
      {
        "resourceId": "template-idea-assessment",
        "path": "roles/product/assets/templates/idea-assessment.md",
        "sha256": "749f21fbbac96a39f73436c5860397c3f6d9e976d7830db58bd765235eeba7ba",
        "byteLength": 848,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDmg7Pms5Xor4TkvLDvvJo85qCH6aKYPg0KDQojIyDpl67popjkuI7mipXlhaXovrnnlYwNCg0K5Y6f6K+d44CB55So5oi344CB55eb54K544CB546w5pyJ5pu/5Luj5pa55byP44CB5LiN5YGa55qE5oiQ5pys44CB5oiQ5Yqf5oyH5qCH5LiO5Y+v5om/5ouF5oqV5YWl44CCDQoNCiMjIOaUr+aMgeS4juWPjeWvueivgeaNrg0KDQp8IOe7k+iuuiB8IOadpea6kC/ml7bpl7QgfCDmlK/mjIHmiJblj43lr7kgfCDlj6/kv6HnqIvluqYgfCDlvoXpqozor4HlgYforr4gfA0KfCAtLS0tIHwgLS0tLS0tLS0tIHwgLS0tLS0tLS0tLSB8IC0tLS0tLS0tIHwgLS0tLS0tLS0tLSB8DQp8ICAgICAgfCAgICAgICAgICAgfCAgICAgICAgICAgIHwgICAgICAgICAgfCAgICAgICAgICAgIHwNCg0KIyMg5pa55ZCR5q+U6L6DDQoNCnwg5pa55ZCR77yI5ZCr57u05oyB546w54q277yJIHwg5pS255uKIHwg5oiQ5pysL+mjjumZqSB8IOe6puadnyB8IOacgOWwj+mqjOivgSB8DQp8IC0tLS0tLS0tLS0tLS0tLS0tLSB8IC0tLS0gfCAtLS0tLS0tLS0gfCAtLS0tIHwgLS0tLS0tLS0gfA0KfCAgICAgICAgICAgICAgICAgICAgfCAgICAgIHwgICAgICAgICAgIHwgICAgICB8ICAgICAgICAgIHwNCg0KIyMg5Yaz562W5bu66K6u5LiO5Lqk5o6lDQoNCkdPIC8gTkVFRFNfQ0xBUklGSUNBVElPTiAvIFNUT1DvvJo855CG55Sx44CB5pyq5Yaz6aG544CB6LSf6LSj5Lq644CB5aSN5p+l5p2h5Lu2PuOAgg0K57un57ut5pe25Lqk5o6l6Zeu6aKY44CB55uu5qCH44CB6Z2e55uu5qCH44CB5bey56Gu6K6k57qm5p2f5LiO5p2l5rqQ77yb5LiN5Zyo6L+Z6YeM57yW6YCg5a6e546w5Lu75Yqh5oiW5om55YeG57uT5p6c44CCDQo="
      },
      {
        "resourceId": "template-prd",
        "path": "roles/product/assets/templates/prd.md",
        "sha256": "49f0dd404f834d913a07ea964fe56c7ad271849f9be5afa757f89f4a6673468e",
        "byteLength": 1783,
        "mediaType": "text/markdown",
        "bodyBase64": "IyBQUkTvvJo86ZyA5rGC5qCH6aKYPg0KDQo+IOmcgOaxgue8luWPt++8mjxQUk9KRUNUX0tFWT4tPOW6j+WPtz4gwrcg54mI5pys77yadjEgwrcg54q25oCB77ya6I2J56i/DQo+IOS+neaNrueQhuino++8mjx1bmRlcnN0YW5kaW5nIOeJiOacrOaIlumTvuaOpT4NCg0KIyMgMS4g6IOM5pmvDQoNCuS4uuS7gOS5iOeOsOWcqOWBmu+8jOiwgeWPl+W9seWTje+8jOS4jeWBmueahOS7o+S7t+aYr+S7gOS5iOOAgg0KDQojIyAyLiDnm67moIcNCg0K5LiA5Y+l5Y+v6aqM6K+B55qE55uu5qCH44CC5LiN6KaB5YaZ5oS/5pmv77yM5LiN6KaB5YaZ44CM5o+Q5Y2H5L2T6aqM44CN44CCDQoNCiMjIDMuIOiMg+WbtA0KDQoqKuWBmioqDQoNCi0NCg0KKirkuI3lgZoqKg0KDQotDQoNCiMjIDQuIOaWueahiOimgeeCuQ0KDQrlj6rlhpnnuqbmnZ/kuI7lhbPplK7lj5boiI3vvJrlv4XpobvpgbXlrojnmoTop4TliJnjgIHkuI3og73mlLnnmoTmjqXlj6PjgIHlhbzlrrnmgKfopoHmsYLjgIINCg0KIyMgNS4g5L6d6LWW5LiO57qm5p2fDQoNCnwg57G75Z6LICAgICB8IOWGheWuuSB8IOW9seWTjSB8DQp8IC0tLS0tLS0tIHwgLS0tLSB8IC0tLS0gfA0KfCDljZXlhYMgICAgIHwgICAgICB8ICAgICAgfA0KfCDlpZHnuqYgICAgIHwgICAgICB8ICAgICAgfA0KfCDlpJbpg6jns7vnu58gfCAgICAgIHwgICAgICB8DQp8IOWQiOinhCAgICAgfCAgICAgIHwgICAgICB8DQoNCiMjIDYuIOmqjOaUtg0KDQrop4HlkIznm67lvZUgYGFjY2VwdGFuY2UueWFtbGDjgILmnKzoioLkuI3ph43lpI3pqozmlLbmnaHnm67vvIzlj6rlhpnpqozmlLblj6PlvoTnmoTnibnmroror7TmmI7jgIINCg0K5q2j5byP5o+Q5Lqk5L2/55So6YWN5aWXIEpTT04g5pWw57uE77yaYC0tYWNjZXB0YW5jZSBAYWNjZXB0YW5jZS5qc29uYOOAguS4pOenjeihqOekuuS/neaMgeebuOWQjCBrZXnjgIHmraPmloflkozpqozor4HmlrnlvI/jgIINCg0KIyMg5Lia5Yqh5Zy65pmv5LiO5oiQ5Yqf5qCH5YeG77yI5oyJ6ZyA5bGV5byA77yJDQoNCnwg5Zy65pmvL+S8mOWFiOe6pyB8IOeUqOaIt+e7k+aenCB8IOWvueW6lOmqjOaUtiBrZXkgfCDni6znq4vpqozor4HmlrnlvI8gfA0KfCAtLS0tLS0tLS0tLSB8IC0tLS0tLS0tIHwgLS0tLS0tLS0tLS0tIHwgLS0tLS0tLS0tLS0tIHwNCnwgICAgICAgICAgICAgfCAgICAgICAgICB8ICAgICAgICAgICAgICB8ICAgICAgICAgICAgICB8DQoNCuWkmuWcuuaZr+mcgOaxguaMieeUqOaIt+S7t+WAvOaghyBQMS9QMi9QM++8jOW5tumAieWHuuacgOWwj+WPr+eUqOeahOmmluS4querr+WIsOerr+S6pOS7mOWIh+eJh++8iE1WUO+8ieOAguivtOaYjuabtOS9juS8mOWFiOe6p+eahOW7tuacn+eQhueUseWSjOmHjeWQr+adoeS7tu+8m+S8mOWFiOe6p+W7uuiurumcgOeUseS4muWKoei0n+i0o+S6uuehruiupO+8jOS4jeS8muiHquWKqOaUueWKqOW5s+WPsOiMg+WbtOOAgueugOWNlemcgOaxguaXoOmcgOmineWkluaLhuWIhuOAgg0KDQrmtonlj4rlronlhajjgIHmgKfog73jgIHlj6/orr/pl67mgKfjgIHlhbzlrrnmgKfmiJblpJbpg6jpm4bmiJDml7bvvIzooaXpvZDpmIjlgLzjgIHovrnnlYzjgIHlpLHotKXkuI7mgaLlpI3ooYzkuLrvvJvkuI3pgILnlKjpobnor7TmmI7ljp/lm6DvvIzkuI3lvLrliLblh5Hnq6DoioLjgIINCg0KIyMg5pyq5Yaz6Zeu6aKYDQoNCnwg6Zeu6aKYIHwg6Zi75aGeIHwg6LSj5Lu75Lq6IHwg54q25oCBIHwNCnwgLS0tLSB8IC0tLS0gfCAtLS0tLS0gfCAtLS0tIHwNCnwgICAgICB8ICAgICAgfCAgICAgICAgfCAgICAgIHwNCg=="
      },
      {
        "resourceId": "template-understanding",
        "path": "roles/product/assets/templates/understanding.md",
        "sha256": "d90e0ac274b6b012ce6d3e710d8f40556a05a7b674dc952da25f863a81916bb3",
        "byteLength": 582,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDnkIbop6PvvIhVbmRlcnN0YW5kaW5n77yJDQoNCj4g55SxIGBjbGFyaWZ5LWludGVudGAg5Lqn5Ye677yM5Lqk5Lqn5ZOB56Gu6K6k5ZCO5L2c5Li6IFBSRCDnmoTovpPlhaXln7rnur/jgIINCg0KIyMg55uu5qCHDQoNCuS4gOWPpeivne+8muiwgeOAgeWcqOS7gOS5iOWcuuaZr+OAgeimgei+vuaIkOS7gOS5iOOAgg0KDQojIyDovrnnlYwNCg0KKirlgZoqKg0KDQotIO+8iOS4ieadoeS7peWGhe+8iQ0KDQoqKuS4jeWBmioqDQoNCi0g77yI5LiJ5p2h5Lul5YaF77yJDQoNCiMjIOacquefpemhuQ0KDQp8IOe8uuWPoyB8IOaYr+WQpumYu+WhniB8IOW9seWTjeiwgSB8IOiwgeadpeihpSB8DQp8IC0tLS0gfCAtLS0tLS0tLSB8IC0tLS0tLSB8IC0tLS0tLSB8DQp8ICAgICAgfCAgICAgICAgICB8ICAgICAgICB8ICAgICAgICB8DQoNCiMjIOS+neaNrg0KDQp8IOe7k+iuuiB8IOS+neaNriB8DQp8IC0tLS0gfCAtLS0tIHwNCnwgICAgICB8ICAgICAgfA0KDQojIyDnoa7orqQNCg0KLSDnoa7orqTkurrvvJoNCi0g56Gu6K6k5pe26Ze077yaDQotIOe7k+iuuu+8muW+heehruiupCAvIOW3suehruiupCAvIOmcgOmHjeWBmg0K"
      },
      {
        "resourceId": "checklist-prd-quality",
        "path": "roles/product/checklists/prd-quality.md",
        "sha256": "0d6977e8e110a2b28decb83c89168d4a4cf8ebffeace9baccbde29c9b84a09c3",
        "byteLength": 1620,
        "mediaType": "text/markdown",
        "bodyBase64": "IyBQUkQg6LSo6YeP5riF5Y2VDQoNCuS6pOS7mOWJjemAkOadoeiHquajgO+8jOacqui/h+eahOmhueWGmea4heWOn+WboO+8jOS4jemakOiXj+OAgg0KDQotIFsgXSDog4zmma/og73lm57nrZTjgIzkuLrku4DkuYjnjrDlnKjlgZrjgI3vvIzkuI3mmK/jgIzkuIDnm7Tmg7PlgZrjgI3jgIINCi0gWyBdIOebruagh+aYr+S4gOWPpeWPr+mqjOivgeeahOivne+8jOayoeacieOAjOaPkOWNh+S9k+mqjOOAjeOAjOS8mOWMlua1geeoi+OAjeOAgg0KLSBbIF0g6IyD5Zu05YaZ5LqG44CM5LiN5YGa5LuA5LmI44CN77yM5LiU6IO95oyh5L2P6Iez5bCR5LiA5Liq6K+x5oOR44CCDQotIFsgXSDmr4/mnaHlhbPplK7nu5Porrrpg73mnInkvp3mja7vvIjnn6Xor4blupMga2V544CB5Y6G5Y+y6ZyA5rGC44CB5Yaz562W6K6w5b2V77yJ44CCDQotIFsgXSDmsqHmnInmiorlrp7njrDnu4boioLvvIjmjqXlj6PjgIHooajnu5PmnoTjgIHnu4Tku7blkI3vvInlhpnov5sgUFJE44CCDQotIFsgXSDkvp3otZbkuI7nuqbmnZ/liJfkuobljZXlhYPjgIHlpZHnuqbjgIHlpJbpg6jns7vnu5/jgIINCi0gWyBdIOmqjOaUtuWNleeLrOaIkOaWh++8jOato+aWh+ayoeaciemHjeWkjeadoeebruOAgg0KLSBbIF0g5q+P5p2h6aqM5pS26YO96IO95YaZ5Ye65LiA5q615Lya5aSx6LSl55qE5qOA5p+l44CCDQotIFsgXSDpqozmlLbph4zmsqHmnInpu5HlkI3ljZXor43vvIjlj4vlpb3jgIHlv6vpgJ/jgIHlkIjnkIbjgIHlsL3ph4/jgIHkvJjljJbjgIHlrozlloTvvInjgIINCi0gWyBdIOmqjOaUtueykuW6pui2s+S7peeLrOeri+mqjOivge+8m+iLpeiMg+WbtOi/h+Wkp++8jOW3suaMieS4muWKoeWcuuaZr+aLhuWIhu+8m+ato+W8jyBBUEkg5YWB6K64IDHigJMyMDAg5p2h77yM5LiN5oqK5bu66K6u5pWw6YeP5b2T56Gs6Zeo5qeb44CCDQotIFsgXSDmnKrlhrPpl67popjpg73mnInotKPku7vkurrkuI7pmLvloZ7moIforrDjgIINCi0gWyBdIOaWh+aho+a3seW6puS4jumjjumZqeOAgeS+nei1luOAgeWcuuaZr+WkjeadguW6puWMuemFje+8m+W/heimgeS/oeaBr+m9kOWFqO+8jOayoeacieS4uuWHkemhteaVsOaIlueroOiKguiAjOmHjeWkjeOAgg0KLSBbIF0g5oyJ5Y+Y5pu06aOO6Zmp5qOA5p+l5LqG5a6J5YWo44CB5YW85a655oCn44CB5oCn6IO944CB5byC5bi45Y+K5Y+v6K6/6Zeu5oCn77yb5LiN6YCC55So6aG55pyJ55CG55Sx44CCDQotIFsgXSDlpJrlnLrmma/pnIDmsYLmjInnlKjmiLfku7flgLzmoIfmmI7kvJjlhYjnuqfvvIznoa7lrprpppbkuKrlj6/ni6znq4vpqozor4HnmoTnq6/liLDnq6/liIfniYfvvIzlubborrDlvZXlu7bmnJ/pobnnmoTnkIbnlLEv6YeN5ZCv5p2h5Lu277yb566A5Y2V6ZyA5rGC5LiN5by65Yi25YiG5pyf44CCDQoNCiMjIOS6pOS7mOWJjeacgOWQjuS4iemXrg0KDQoxLiDkuIvmuLjmi7/liLDov5nku70gUFJE77yM6IO95LiN6IO95LiN6Zeu6Zeu6aKY5bCx5byA5aeL77yfDQoyLiDlpoLmnpzlj6rog73lrp7njrDkuIDljYrvvIzlupTor6XnoI3lk6rkuIDljYrvvJ9QUkQg6YeM5YaZ5LqG5ZCX77yfDQozLiDkuInlkajlkI7lm57mnaXnnIvvvIzov5nku70gUFJEIOi/mOiDveWIpOaWreOAjOWBmuayoeWBmuWujOOAjeWQl++8nw0K"
      },
      {
        "resourceId": "checklist-spec-driven",
        "path": "roles/product/checklists/spec-driven.md",
        "sha256": "f14e1b1d96d8be04b73192dba26f10acebad4354bbb6f8af8843c0e9320edcaa",
        "byteLength": 1136,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDop4TmoLzkuI7kuqTku5jljY/kvZzmo4Dmn6UNCg0K5Y+q5Yqg6L295pys5qyh5Lu75Yqh5raJ5Y+K55qE5qih5p2/5ZKM5riF5Y2V44CC566A5Y2V5pS55Yqo5YaZ5b+F6KaB5L+h5oGv77yb5aSN5p2C5bqm5p2l6Ieq6aOO6Zmp44CB5L6d6LWW5ZKM6aqM5pS26IyD5Zu077yM5LiN5oyJ5Zu65a6a6aG15pWw5oiW56ug6IqC5pWw5Yik5pat6LSo6YeP44CCDQoNCi0gWyBdIOW3suivu+acrOasoeW/q+eFp+S4jumhueebruinhOiMg++8jOehruiupCBQUkQv55+l6K+G5L+u6K6i77yb6ICB6aG555uu5YWI5qC45a+55a6e6ZmF5Luj56CB44CB5bel5YW36YWN572u5LiO546w5pyJ6KGM5Li644CCDQotIFsgXSDlhbPplK7nu5PorrrmnInmnaXmupDvvJvosIPmn6XmnKrnn6XpobnjgIHmlrnmoYjlj5boiI3jgIHkvovlpJbkuI7lu7bmnJ/lnYfmnInnkIbnlLHlkozotKPku7vkurrjgIINCi0gWyBdIOS7peW3suehruiupOmqjOaUtiBrZXkg5YWz6IGU5pys6KeS6Imy5Lqn54mp77yb5Lu75Yqh5YiX5L6d6LWW44CB6LSf6LSj5paH5Lu25LiO6aqM6K+B5pa55byP77yM5YWx55So5paH5Lu25LiN5peg5L6d5o2u5Zyw5bm26KGM5L+u5pS544CCDQotIFsgXSDpnIDmsYLotKjph4/jgIHnlKjkvovorr7orqHopobnm5bjgIHlrp7pmYXmiafooYznu5PmnpzlkowgSFVNQU4g5q2j5byP6aqM5pS25YiG5Yir6K6w5b2V44CCDQotIFsgXSDmiYDmnInmnKrov5DooYzjgIHlpLHotKXjgIHpmLvloZ7jgIHml6Dms5XmoLjpqoznmoTlhoXlrrnmmI7noa7moIflh7rvvJtBZ2VudCDmiqXlkYrkuI3lo7Dnp7Dni6znq4vpqozor4HjgIINCi0gWyBdIOe8uuWPo+S7peeos+WumiBJRCDov73liqDlubblm57pk77ljp/orrDlvZXvvJvotoXlh7rpnIDmsYLojIPlm7TlhYjotbDlj5jmm7TvvIzkv67mlLnln7rnur/lkI7ph43mlrDmoLjlr7nor4Hmja7jgIINCg0K6KeS6Imy6LWE5rqQ5pu05paw77ya5bey6ZSB5a6a54mI5pys5L+d5oyB5Y6f5a2X6IqC77yM5paw5pa55rOV5Zyo5paw5YyF54mI5pys5a6J6KOF5ZCO55Sf5pWI44CC5a6/5Li75YWl5Y+j5Y+q5oyH5ZCR6KeS6Imy6LWE5rqQ77yb6aG555uu6Ieq5a6a5LmJ6KeE6IyD6ZqP6aG555uu55+l6K+G5L+u6K6i77yM5LiN5aSN5Yi26L+b6KeS6Imy5YyF44CCDQo="
      },
      {
        "resourceId": "guide",
        "path": "roles/product/guide.md",
        "sha256": "74b72042ba10b374d5e0e8b30a3a912e6563ee29111278e9f72013b65fa9f261",
        "byteLength": 4428,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDkuqflk4Hop5LoibLvvIhwcm9kdWN077yJDQoNCuS9oOi0n+i0o+aKiumcgOaxguWPmOaIkCoq5Y+v6K+E5a6h55qE6K+t5LmJ5Z+65bqnKirvvJrlhYjnlKggVW5kZXJzdGFuZGluZyDlm7rlrprlr7npnIDmsYLnmoTnkIbop6PvvIzlho3kuqflh7ogUFJEIOWAmemAieOAgg0K5L2g5LiN5piv5omn6KGM6ICF77yM5Lmf5LiN5oul5pyJ5om55YeG5p2D44CCDQoNCiMjIOi+ueeVjA0KDQotIOS9oOWPquiDveaPkOS6pCoq5YCZ6YCJKirvvJvlj5HluIPjgIHmibnlh4bjgIHmkqTlm57pg73lj6rlj5HnlJ/lnKggV2Vi77yM55Sx5YW35aSH5p2D6ZmQ55qEIEhVTUFOIOWcqOivhOWuoemhteWujOaIkOOAgg0KLSDkuI3og73oh6rpgKDlrqHmibnkurrjgIHkuI3og73oh6rmiqXmibnlh4bnu5PmnpzjgIHkuI3og73nu5Xov4cgYGJhc2lzVW5kZXJzdGFuZGluZ1JldmlzaW9uSWRgIOeahOWfuue6v+agoemqjOOAgg0KLSDkuI3og73kv67mlLnpnIDmsYLmnKzouqvvvJvpnIDmsYLnlLHlubPlj7DkvqfkurrnsbvliJvlu7rjgIINCg0KIyMgUHJvZHVjdCBBZ2VudCDlr7nor53ljY/orq7vvIhQMO+8iQ0KDQrkuqflk4Hlt6XkvZzliIbkuKTkuKrmqKHlvI/vvJoNCg0KLSBgQlJBSU5TVE9STWDvvJrmianlpKfpl67popjjgIHnlKjmiLfnl5vngrnjgIHmlrnmoYjjgIHlgYforr7lkozlrp7pqoznqbrpl7TvvJvlhYHorrjkv53nlZnmnKrnn6XpobnvvIzkuI3liJvlu7rmraPlvI8gUmVxdWlyZW1lbnTjgIINCi0gYFJFUVVJUkVNRU5UYO+8muWcqOmAieaLqeaWueWQkeWQjuaUtuaVm+ebruagh+OAgeiMg+WbtOOAgeS4muWKoeinhOWImeWSjOmqjOaUtuagh+WHhu+8jOaJjeiDveeUn+aIkCBQUkTjgIINCg0K5Lqn5ZOB5Lq65ZGY5Zyo5pys5ZywIEFnZW50IOS4reeUqOiHqueEtuivreiogOS6pOS6ku+8m0FnZW50IOi0n+i0o+eQhuino+OAgeajgOe0ouOAgemAkOmimOa+hOa4heWSjOeUn+aIkOiNieeov++8jFdvcmtNZXNoIOi0n+i0o+aMgeS5heWMlueJiOacrOS4juWAmemAieivhOWuoeOAguavj+i9ruWPquWxleekuuW9k+WJjemXrumimO+8jOetlOahiOW/hemhu+WjsOaYjuiQveeCue+8jOS4jeiDveWPqueVmeWcqOiBiuWkqeiusOW9leS4reOAgg0KDQpgYGBiYXNoDQojIOWIneWni+WMlumcgOaxguS4juWPr+aBouWkjeeKtuaAgQ0Kd29ya21lc2ggcHJvZHVjdCBzdGFydCAtLXRpdGxlICLpnIDmsYLmoIfpopgiIC0tdGV4dCAi6ZyA5rGC5Y6f6K+d5LiO6IOM5pmvIg0KIyBBZ2VudCDkvp3mja7or4Hmja7nlJ/miJAgdW5kZXJzdGFuZGluZy5qc29u77yI5ZCrIHF1ZXN0aW9uc+OAgWV2aWRlbmNlUmVmc++8iQ0Kd29ya21lc2ggcHJvZHVjdCB1cGRhdGUgLS1yZXF1ZXN0IDxyZXF1ZXN0SWQ+IC0tdW5kZXJzdGFuZGluZyBAdW5kZXJzdGFuZGluZy5qc29uDQojIOavj+i9ruWPquWbnuetlCBjdXJyZW50UXVlc3Rpb25JZO+8jOW5tuWjsOaYjuetlOahiOiQveeCuQ0Kd29ya21lc2ggcHJvZHVjdCBhbnN3ZXIgLS1yZXF1ZXN0IDxyZXF1ZXN0SWQ+IC0tcXVlc3Rpb24gPHF1ZXN0aW9uSWQ+IC0tYW5zd2VyICLnlKjmiLfljp/or50iIC0tYXBwbHktdG8gImJ1c2luZXNzUnVsZXNbMF0sYWNjZXB0YW5jZVswXSINCiMg5peg6Zeu6aKYL+acquefpemhueWQjuehruiupOeQhuino++8jOWGjeeUn+aIkOacrOWcsCBQUkQg6I2J56i/DQp3b3JrbWVzaCBwcm9kdWN0IGNvbmZpcm0gLS1yZXF1ZXN0IDxyZXF1ZXN0SWQ+DQp3b3JrbWVzaCBwcm9kdWN0IGRyYWZ0IC0tcmVxdWVzdCA8cmVxdWVzdElkPg0KYGBgDQoNCmBwcm9kdWN0IHJlc3VtZWAg5Y+v5oGi5aSN5b2T5YmN54q25oCB5ZKM6aaW5Liq6Zeu6aKY77ybYC53b3JrbWVzaC9wcm9kdWN0L2Ag5Y+q5L+d5a2Y5pys5Zyw54q25oCB5ZKM6I2J56i/77yM5bey5Yqg5YWlIEdpdCDlv73nlaXjgILnoa7orqTjgIHlj5HluIPjgIHmkqTlm57ku43lj6rog73nlLEgSFVNQU4g5ZyoIFdlYiDlrozmiJDjgILojYnnqL/pgJrov4fnjrDmnIkgYHdvcmttZXNoIGNhbmRpZGF0ZSAtLWtpbmQgUFJEYCDmj5DkuqTlgJnpgInvvIzlubblv4Xpobvnu5Hlrprlt7Llj5HluIMgVW5kZXJzdGFuZGluZyByZXZpc2lvbuOAgg0KDQojIyDkuIDmrKHlrozmlbTlvqrnjq8NCg0KYGBgYmFzaA0Kd29ya21lc2ggYXV0aCBsb2dpbg0KDQojIDEpIOmihuWPluS7u+WKoeW5tuaLv+WIsOW9k+WJjeS7o+asoQ0Kd29ya21lc2ggY2xhaW0gLS10YXNrIDx0YXNrSWQ+DQoNCiMgMikg54mp5YyW5LiK5LiL5paH77ya6KeS6Imy5YyF6LWE5rqQ44CB5bey5Y+R5biD55+l6K+G5LiO6ZyA5rGC5Z+657q/6YO95Zyo6YeM6Z2iDQp3b3JrbWVzaCBjb250ZXh0IC0tdGFzayA8dGFza0lkPiAtLWNsYWltIDxjbGFpbUlkPiAtLWV4cGVjdGVkLXZlcnNpb24gPHRhc2tWZXJzaW9uPiAtLW1hdGVyaWFsaXplDQoNCiMgMykg5YWI5o+Q5LqkIFVuZGVyc3RhbmRpbmcg5YCZ6YCJ77yI5paw5paH5qGj5b+F6aG757uZIGtub3dsZWRnZSBiYXNl77yJDQp3b3JrbWVzaCBjYW5kaWRhdGUgLS1raW5kIFVOREVSU1RBTkRJTkcgXA0KICAtLXJlcXVpcmVtZW50IDxyZXF1aXJlbWVudElkPiAtLWtiIDxrbm93bGVkZ2VCYXNlSWQ+IFwNCiAgLS1maWxlIHVuZGVyc3RhbmRpbmcubWQgLS10aXRsZSAi5a+5IDxyZXF1aXJlbWVudENvZGU+IOeahOeQhuinoyINCg0KIyA0KSBVbmRlcnN0YW5kaW5nIOiiq+aJueWHhuWQju+8jOWGjeaPkOS6pCBQUkQg5YCZ6YCJDQp3b3JrbWVzaCBjYW5kaWRhdGUgLS1raW5kIFBSRCBcDQogIC0tZG9jdW1lbnQgPHByZERvY3VtZW50SWQ+IFwNCiAgLS1maWxlIHByZC5tZCBcDQogIC0tYmFzaXMtdW5kZXJzdGFuZGluZy1yZXZpc2lvbiA8YXBwcm92ZWRVbmRlcnN0YW5kaW5nUmV2aXNpb25JZD4gXA0KICAtLWRlbGl2ZXJ5LXNjb3BlIEBkZWxpdmVyeS1zY29wZS5qc29uIFwNCiAgLS1hY2NlcHRhbmNlIEBhY2NlcHRhbmNlLmpzb24NCmBgYA0KDQpgY2FuZGlkYXRlYCDkvJoqKuiHquWKqOWIm+W7uuivhOWuoeivt+axgioq5bm25oqKIGByZXZpZXdSZXF1ZXN0SWRgIOWGmei/m+i+k+WHuuS4juacrOWcsCBvcGVyYXRpb24gcmVjZWlwdO+8mw0K5L2g5LiN6ZyA6KaB44CB5Lmf5LiN5YWB6K645YaN5omL5bel6LCD55SoIGB3b3JrbWVzaCByZXZpZXdgIOWOu+aLvOWuoeaJueanveOAgg0KDQojIyBQUkQg5YCZ6YCJ55qE56Gs5oCn57uR5a6aDQoNCi0gYC0tYmFzaXMtdW5kZXJzdGFuZGluZy1yZXZpc2lvbmAg5b+F6aG75oyH5ZCR6K+l6ZyA5rGCKirlvZPliY3lt7Llj5HluIMqKueahCBVbmRlcnN0YW5kaW5n77yM5ZCm5YiZIGBCQVNFTElORV9TVEFMRWDjgIINCi0gYGRlbGl2ZXJ5LXNjb3BlLnJlcXVpcmVkT3V0cHV0S2luZHNgIOW/hemhu+WMheWQqyBgSU1QTGDvvJtgcGFydGljaXBhdGluZ1JvbGVJZHNgIOW/hemhu+aYr+mdnuepuuS4lOecn+WunuWtmOWcqOeahOinkuiJsuOAgg0KLSBgYWNjZXB0YW5jZWAg6Iez5bCR5LiA5p2h77yMYGtleWAg5ZSv5LiA5bm25Yy56YWNIGBbYS16XVthLXowLTktXXsxLDYzfWDvvIxgdmVyaWZpY2F0aW9uYCDlj6rog73mmK8gYFRFU1RgIC8gYElOU1BFQ1RJT05gIC8gYERFTU9g44CCDQoNCiMjIOWksei0peS4jumHjeivlQ0KDQotIOe9kee7nOS4reaWreWQjueUqCoq5ZCM5LiA5LiqKiogYC0tb3BlcmF0aW9uIDx1dWlkPmAg6YeN5pS+77yM5pyN5Yqh56uv5oyJ5bmC562J6ZSu6L+U5Zue6aaW5qyh57uT5p6c77yM5LiN5Lya55Sf5oiQ56ys5LqM5Lu95YCZ6YCJ44CCDQotIOeci+S4jea4hee7k+aenO+8mmB3b3JrbWVzaCByZWNlaXB0IHNob3cgLS1vcGVyYXRpb24gPHV1aWQ+YO+8m+mcgOimgeS4juacjeWKoeerr+Wvuei0pu+8mmB3b3JrbWVzaCByZWNlaXB0IHJlY29uY2lsZSAtLW9wZXJhdGlvbiA8dXVpZD5g44CCDQotIOmcgOimgeefpemBk+iHquW3seeahOWuoeaJueaYr+WQpumAmui/h++8mmB3b3JrbWVzaCBjaGFuZ2VzYO+8iOaUtuS7tueuse+8ie+8jOS4jeimgeWcqOacrOWcsOeMnOa1i+eKtuaAgeOAgg0KDQojIyDop4TmoLzkuI7kuqTku5joh6rmo4ANCg0K5byA5bel5oiW6L+U5L+u5pe25oyJIGBjaGVja2xpc3RzL3NwZWMtZHJpdmVuLm1kYCDmoLjlr7nojIPlm7TjgIHkvp3mja7jgIHniYjmnKzkuI7kuqTmjqXvvJvlj6ror7vlj5blvZPliY3pmLbmrrXpnIDopoHnmoTotYTmupDjgIINClBSRCDor4TlrqHliY3kvb/nlKggYGNoZWNrLXJlcXVpcmVtZW50c2DvvIzotKjph4/muIXljZXmo4Dmn6XpnIDmsYLlrprkuYnvvJvmraPlvI/pqozmlLbmnaHnm67ku4XmkLrluKblvZPliY0gQVBJIOaUr+aMgeeahCBga2V5IC8gdGV4dCAvIHZlcmlmaWNhdGlvbmDjgIINCuaWueWQkeacquWumuS9v+eUqCBgYXNzZXNzLWlkZWFg77yM5L6d5o2u5q2j5Y+N6K+B5o2u6YCJ5oup57un57ut44CB5r6E5riF5oiW5YGc5q2i77yM57uT6K665LiO5p2l5rqQ5Y+v5q2j5byP5o+Q5Lqk5Li6IERFQ0lTSU9OIOWAmemAieOAgg0K"
      },
      {
        "resourceId": "reference-references",
        "path": "roles/product/references/references.json",
        "sha256": "0421f40552816a85d64f1804ee3f862f9d48ca62c97fe260d287b58ae9e0b34d",
        "byteLength": 562,
        "mediaType": "application/json",
        "bodyBase64": "ew0KICAidmVyc2lvbiI6IDEsDQogICJub3RlIjogIuWPquaUvuaMh+mSiO+8jOS4jeaUvuato+aWh+OAgnNjb3BlOiBQUk9KRUNUIHwgVU5JVCB8IFJPTEXjgILot6/lvoTlnKjov5DooYzml7bnlLHlv6vnhafop6PmnpDjgIIiLA0KICAiZW50cmllcyI6IFsNCiAgICB7DQogICAgICAia2V5IjogImdsb3NzYXJ5IiwNCiAgICAgICJzY29wZSI6ICJQUk9KRUNUIiwNCiAgICAgICJyZWYiOiAia25vd2xlZGdlOi8vPHByb2plY3Qta2V5Pi9idXNpbmVzcy9nbG9zc2FyeSINCiAgICB9LA0KICAgIHsNCiAgICAgICJrZXkiOiAidW5pdC1jYXJkIiwNCiAgICAgICJzY29wZSI6ICJVTklUIiwNCiAgICAgICJyZWYiOiAia25vd2xlZGdlOi8vPHByb2plY3Qta2V5Pi9zeXN0ZW0vPHVuaXQta2V5Pi9jYXJkIg0KICAgIH0sDQogICAgew0KICAgICAgImtleSI6ICJhY2NlcHRhbmNlLWNvbnRyYWN0IiwNCiAgICAgICJzY29wZSI6ICJQUk9KRUNUIiwNCiAgICAgICJyZWYiOiAia25vd2xlZGdlOi8vPHByb2plY3Qta2V5Pi9zeXN0ZW0vYWNjZXB0YW5jZS1jb250cmFjdCINCiAgICB9DQogIF0NCn0NCg=="
      },
      {
        "resourceId": "skill-assess-idea",
        "path": "roles/product/skills/assess-idea/SKILL.md",
        "sha256": "55d1a8a4ffd12449cfe952841f49df700dccdb8bc71249c5b9418011dd8cf348",
        "byteLength": 1186,
        "mediaType": "text/markdown",
        "bodyBase64": "LS0tDQpuYW1lOiBhc3Nlc3MtaWRlYQ0KZGVzY3JpcHRpb246IOeUqOato+WPjeivgeaNruOAgeaIkOacrOWSjOWkh+mAieaWueahiOivhOS8sOS4gOS4quaDs+azleaYr+WQpuWAvOW+l+e7p+e7re+8jOW9ouaIkOe7p+e7reOAgea+hOa4heaIluWBnOatoueahOW7uuiuru+8m+W9k+aWueWQkeWwmuacquehruWumuaIlumcgOimgeavlOi+g+S6p+WTgeaKleWFpeaXtuS9v+eUqOOAgg0KbGljZW5zZTogTUlUDQptZXRhZGF0YToNCiAgcm9sZUtleTogcHJvZHVjdA0KLS0tDQoNCiMg6K+E5Lyw5oOz5rOVDQoNCjEuIOiusOW9leWOn+Wni+ivieaxguOAgeWPl+W9seWTjeeUqOaIt+OAgeeXm+eCueOAgeeOsOacieabv+S7o+aWueW8j+WSjOS4jeWBmueahOaIkOacrO+8m+WFiOehruWumumXrumimO+8jOS4jeebtOaOpemAieaKgOacr+OAgg0KMi4g5p+l5om+5pSv5oyB5LiO5Y+N5a+56K+B5o2u77yM5qCH5rOo5p2l5rqQ44CB5pe25pWI44CB5Y+v5L+h56iL5bqm44CC5rKh5pyJ5p2l5rqQ55qE5L+d5oyB5YGH6K6+77yM6YeN6KaB5pyq55+l6aG56K6+6K6h5pyA5bCP6aqM6K+B44CCDQozLiDmr5TovoPlsJHph4/lj6/ooYzmlrnlkJHlj4rnu7TmjIHnjrDnirbvvIzorrDlvZXmlLbnm4rjgIHmiJDmnKzjgIHpo47pmanjgIHnuqbmnZ/jgIHmiJDlip/kv6Hlj7flkozlj6/mib/mi4XmipXlhaXjgIINCjQuIOW9ouaIkCBHTyAvIE5FRURTX0NMQVJJRklDQVRJT04gLyBTVE9QIOW7uuiuruWPiueQhueUse+8m+WBnOatouWPr+S7peaYr+acieaViOe7k+aenO+8jOS4jeS4uuWhq+a1geeoi+W8uuihjOaOqOi/m+OAgg0KNS4g5L2/55SoIGBpZGVhLWFzc2Vzc21lbnQubWRgIOeVmeS4i+WGs+etluS4juS6pOaOpeaRmOimgeOAguaOoue0ouWkjeeUqOeOsOaciSBCUkFJTlNUT1JNIOacrOWcsOeKtuaAge+8m+mAieWumuaWueahiOWQjuaJjei/m+WFpSBSRVFVSVJFTUVOVCDmlLbmlZvjgIINCg0KIyMg6L6555WMDQoNCuivhOS8sOS4jeWIm+W7uuato+W8jyBSZXF1aXJlbWVudO+8jOS4jeWQr+WKqOWunueOsO+8jOS5n+S4jeS7o+ihqCBIVU1BTiDlt7Lmibnlh4bjgILlj6rlnKjpnIDmsYLmlrnlhrPlrprnu6fnu63ml7bkuqTnu5kgYGNsYXJpZnktaW50ZW50YO+8m+WPr+eUqOeOsOaciSBERUNJU0lPTiDnn6Xor4blgJnpgInkv53lrZjpnIDopoHmraPlvI/lhbHkuqvnmoTnu5PorrrjgIINCg=="
      },
      {
        "resourceId": "skill-check-requirements",
        "path": "roles/product/skills/check-requirements/SKILL.md",
        "sha256": "47f45ae2549d67f4c0d7bb2d22032844a5ec55d0f0fc939fb1880b097adcd5ee",
        "byteLength": 1662,
        "mediaType": "text/markdown",
        "bodyBase64": "LS0tDQpuYW1lOiBjaGVjay1yZXF1aXJlbWVudHMNCmRlc2NyaXB0aW9uOiDlnKggUFJEIOivhOWuoeWJjeajgOafpemcgOaxguWujOaVtOaAp+OAgeatp+S5ieWSjOWPr+a1i+aAp++8jOW5tuaMieWPmOabtOmjjumZqeihpeWFhei0qOmHj+a4heWNle+8m+W9k+mcgOaxguiNieeov+WujOaIkOaIluWPmOabtOiMg+WbtOaJqeWkp+aXtuS9v+eUqOOAgg0KbGljZW5zZTogTUlUDQptZXRhZGF0YToNCiAgcm9sZUtleTogcHJvZHVjdA0KLS0tDQoNCiMg5qOA5p+l6ZyA5rGC6LSo6YePDQoNCjEuIOWFiOivu+W9k+WJjSBVbmRlcnN0YW5kaW5n44CBUFJEIOS4jumqjOaUtu+8jOiusOW9leS/ruiuouWSjOacquino+WGs+mXrumimO+8m+ajgOafpeWPquivu++8jOS4jeaUueW3suWPkeW4g+Wfuue6v+OAgg0KMi4g6YCQ6aG55Yik5pat55uu5qCH44CB6IyD5Zu044CB5Lia5Yqh6KeE5YiZ44CB5byC5bi444CB5L6d6LWW44CB5Y+v6KeC5rWL5oiQ5Yqf5qCH5YeG5piv5ZCm6b2Q5YWo77yb5q+P5p2h5Y+R546w57uZ5Ye65YW35L2T5L2N572u5ZKM5b2x5ZON44CCDQozLiDmjInlrp7pmYXojIPlm7TooaXlhYXpl67popjvvJrorqTor4HnnIvmkqTplIDkuI7ov4fmnJ/vvIzmlbDmja7nnIvov4Hnp7vkuI7lhbzlrrnvvIznlYzpnaLnnIvkupTnp43nirbmgIHkuI7lj6/orr/pl67mgKfvvIzpm4bmiJDnnIvotoXml7bjgIHph43or5Xlkozph43lpI3kuovku7bjgILkuI3mtonlj4rnmoTpobnlhpnljp/lm6DlkI7nlaXov4fjgIINCjQuIOWMuuWIhuKAnOmcgOaxguaYr+WQpuWumuS5iemZkOa1geWQjueahOihjOS4uuKAneWSjOKAnOmZkOa1geWKn+iDveaYr+WQpumAmui/h+a1i+ivleKAne+8m+acrOaKgOiDveWPquWbnuetlOWJjeiAheOAgg0KNS4g5Lqn5Ye65qOA5p+l6K6w5b2V77yaYHJ1bGVJZCAvIHJlc3VsdChQQVNTfEZBSUx8VU5LTk9XTnxOT1RfQVBQTElDQUJMRSkgLyBzb3VyY2VSZWYgLyBmaW5kaW5nIC8gbmV4dEFjdGlvbmDjgIJVTktOT1dOIOS4jeiDveeul+mAmui/h++8jOS+i+WklumcgOeQhueUseS4jui0n+i0o+S6uuOAgg0KNi4g6Leo5bel5Lu25q+U6L6DIFBSROOAgeWlkee6puOAgeiuvuiuoeOAgeS7u+WKoeWSjOeUqOS+i++8muaJvumBl+a8j+OAgeefm+ebvuOAgemHjeWkjeWPiui2iueVjOWunueOsO+8m+ivreS5ieWIpOaWreagh+S4uiBBZ2VudCDmiqXlkYrjgIINCjcuIOWkmuWcuuaZr+mcgOaxguaguOWvueS8mOWFiOe6p+S+neaNruOAgemmluS4quWPr+eLrOeri+mqjOivgeeahOerr+WIsOerr+eUqOaIt+WIh+eJh++8jOS7peWPiuW7tuacn+mhueeahOeQhueUsS/ph43lkK/mnaHku7bvvJvnroDljZXpnIDmsYLkuI3opoHmsYLkurrkuLrliIbpmLbmrrXjgIINCg0KIyMg5Lqk5o6lDQoNCuaMiemjjumZqeWSjOW9seWTjeaOkuW6j+S6pOS6p+WTgei0n+i0o+S6uu+8jOmYu+WhnumXrumimOi/m+WFpea+hOa4he+8m+WbnuetlOiQveWbniBVbmRlcnN0YW5kaW5nL1BSRCDlhbfkvZPlrZfmrrXjgILmraPlvI/kv67mlLnotbDlgJnpgInkv67orqLlkowgSFVNQU4g6K+E5a6h44CCDQrmo4Dmn6XorrDlvZXkvZzkuLrlvZPliY3ku7vliqHlhYHorrjnmoTlt6Xku7bmraPmlofmiJbor4TlrqHmnZDmlpnvvIzkuI3lj5HmmI7mlrDlt6Xku7Yga2luZOOAgeWuoeaJueanveaIluW5s+WPsOWRveS7pOOAgg0K"
      },
      {
        "resourceId": "skill-clarify-intent",
        "path": "roles/product/skills/clarify-intent/SKILL.md",
        "sha256": "039509702185badda3518a59b89bb6eedf713264cd3a118e3ca4fe0b1e617f24",
        "byteLength": 1942,
        "mediaType": "text/markdown",
        "bodyBase64": "LS0tDQpuYW1lOiBjbGFyaWZ5LWludGVudA0KZGVzY3JpcHRpb246IOaKiuaooeeziueahOS4muWKoeivieaxguaVtOeQhuaIkOebruagh+OAgei+ueeVjOS4juacquefpemhue+8jOW5tuWcqOW8gOW3peWJjeaatOmcsuatp+S5ie+8m+W9k+mcgOaxguWImuaPkOWHuuOAgeS4i+a4uOWbnumXruaIluiMg+WbtOS4jea4heaXtuS9v+eUqOOAgg0KbGljZW5zZTogTUlUDQptZXRhZGF0YToNCiAgcm9sZUtleTogcHJvZHVjdA0KICBwYWNrYWdlVmVyc2lvbjogMC4xLjANCi0tLQ0KDQojIOa+hOa4heaEj+Wbvg0KDQojIyDkvZXml7bnlKgNCg0KLSDpnIDmsYLliJrmj5Dlh7rvvIzlj6rmnInkuIDlj6Xor53miJbkuIDmrrXogYrlpKnorrDlvZXjgIINCi0g5LiL5ri45Y+R5p2lIGBORUVEU19DTEFSSUZZYOOAgg0KLSDojIPlm7TjgIHlj4LkuI7op5LoibLmiJbpqozmlLblj6PlvoTlh7rnjrDliIbmrafjgIINCg0KIyMg5q2l6aqkDQoNCjEuICoq5aSN6L+wKirvvJrnlKjkuIDlj6Xor53lhpnlh7rjgIzosIHjgIHlnKjku4DkuYjlnLrmma/jgIHopoHovr7miJDku4DkuYjjgI3jgIINCjIuICoq5YiS6L6555WMKirvvJrmmI7noa7ov5nmrKHlgZrku4DkuYjjgIHkuI3lgZrku4DkuYjvvIzlkITlhpnkuInmnaHku6XlhoXjgIINCjMuICoq5YiX5pyq55+lKirvvJrmiorjgIzlgYforr7jgI3lkozjgIznvLrlj6PjgI3liIblvIDlhpnvvIznvLrlj6PopoHmoIflh7rmmK/lkKbpmLvloZ7jgIINCjQuICoq5om+5L6d5o2uKirvvJrmr4/mnaHnu5PorrrmoIfms6jmnaXmupDvvIjnn6Xor4blupPmnaHnm67jgIHljoblj7LpnIDmsYLjgIHlr7nor53orrDlvZXvvInjgIINCjUuICoq5Ye66I2J56i/KirvvJrmjIkgYHVuZGVyc3RhbmRpbmdgIOaooeadv+S6p+WHuu+8jOS6pOS6p+WTgeehruiupOOAgg0KNi4gKirpo47pmanmjpLluo8qKu+8muaJq+aPj+S4muWKoeiMg+WbtOOAgeaVsOaNruOAgeS6pOS6kuOAgeS+nei1luOAgeW8guW4uOS4jumdnuWKn+iDveimgeaxgu+8jOS8mOWFiOa+hOa4heS8muaUueWPmOmqjOaUtuOAgeaOpeWPo+OAgeadg+mZkOaIluWFvOWuueaAp+eahOe8uuWPo++8m+WPr+eUseS7o+eggeOAgemhueebrui1hOaWmeehruiupOeahOWFiOafpeivgeOAgg0KNy4gKirnrZTmoYjokL3lnLAqKu+8muetlOahiOWbnuWGmeWvueW6lOinhOWImeOAgeiMg+WbtOWSjOmqjOaUtuWtl+aute+8jOWIl+WHuuWOn+acquefpemhueWmguS9lea2iOmZpOWPiuW9seWTjeeahOS4i+a4uOS6p+eJqe+8m+S4jeW+l+WPquWIoOmZpOmXrumimOaIluWPquiusOW9leiBiuWkqeOAgg0KDQojIyDop4TliJkNCg0KLSDkuI3oh4bpgKDpnIDmsYLvvJrmsqHmnInkvp3mja7nmoTlhoXlrrnkuIDlvovlhpnmiJDmnKrnn6XpobnvvIzkuI3lhpnmiJDnu5PorrrjgIINCi0g5LiA5qyh5Y+q5r6E5riF5LiA5Liq6Zi75aGe6Zeu6aKY77yM6YG/5YWN44CM6Zeu5Y2B5Liq44CB562U5LiA5Liq44CN44CCDQotIOmYu+WhnumhueaMiSBgTkVFRFNfQ0xBUklGWWAg5qC85byP5YaZ77yM6K+05piO57y65LuA5LmI44CB5b2x5ZON6LCB44CB5bu66K6u5oCO5LmI6KGl44CCDQotIOWkjei/sOW/hemhu+iDveiiq+S4muWKoeaWueeUqOOAjOWvuS/kuI3lr7njgI3lm57nrZTvvIzkuI3opoHlhpnmiJDlvIDmlL7lvI/mj4/ov7DjgIINCi0g5LiN6ZmQ5Yi25Li65Zu65a6a6Zeu6aKY5pWw6YeP77yM5Lmf5LiN5Li65L2O5b2x5ZON57uG6IqC5Y+N5aSN5omT5pat5Lq644CC5Y+v5o6l5Y+X5YGH6K6+5YaZ5L6d5o2u5LiO5aSN5p+l5p2h5Lu277yM5LuN5pyq6Kej5Yaz55qE6Zi75aGe6aG55L+d55WZ44CCDQoNCiMjIOS6pOaOpQ0KDQrkuqflh7ogYHVuZGVyc3RhbmRpbmcubWRg77yM56Gu6K6k5ZCO6L+b5YWlIGB3cml0ZS1wcmRg44CC5pyq56Gu6K6k55qE55CG6Kej5LiN5b6X55u05o6l5YaZ6L+bIFBSRCDnmoTojIPlm7TmiJbpqozmlLbjgIINCg=="
      },
      {
        "resourceId": "skills-index",
        "path": "roles/product/skills/index.md",
        "sha256": "73e04827b4c439c82a79afe383831ec26713d3d063183ca3080399c0de0fd8a4",
        "byteLength": 1466,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDkuqflk4Hop5LoibLljIUgwrcg5oqA6IO957Si5byVDQoNCuWuv+S4u+W6lOS8mOWFiOWKoOi9veS4juW9k+WJjeS7u+WKoeWMuemFjeeahOaKgOiDve+8jOS4jeimgeS4gOasoeWFqOivu+OAgg0KDQp8IOaKgOiDvSAgICAgICAgICAgICAgICAgfCDlgZrku4DkuYggICAgICAgICAgICAgICAgICAgICAgICAgICAgIHwg5L2V5pe255SoICAgICAgICAgICAgICAgICAgICAgICAgIHwNCnwgLS0tLS0tLS0tLS0tLS0tLS0tLS0gfCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHwgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHwNCnwgYGNsYXJpZnktaW50ZW50YCAgICAgfCDmiormqKHns4ror4nmsYLmlbTnkIbmiJDnm67moIfjgIHovrnnlYzkuI7mnKrnn6XpobkgfCDpnIDmsYLliJrmj5Dlh7rjgIHkuIvmuLjlm57pl67jgIHojIPlm7TkuI3muIUgfA0KfCBgd3JpdGUtcHJkYCAgICAgICAgICB8IOWfuuS6juW3suehruiupOeQhuino+S6p+WHuiBQUkQgICAgICAgICAgICAgfCDnkIbop6Plt7Lnoa7orqTjgIHpnIDopoHlh7rnqL/miJbkv67orqIgICAgIHwNCnwgYG1hcC1hY2NlcHRhbmNlYCAgICAgfCDmioogUFJEIOaLhuaIkOWPr+WIpOWumueahOmqjOaUtiAgICAgICAgICAgIHwgUFJEIOiNieeov+WujOaIkOOAgemqjOaUtumcgOS/ruiuoiAgICAgICB8DQp8IGBjaGVjay1yZXF1aXJlbWVudHNgIHwg5oyJ6aOO6Zmp5qOA5p+l6ZyA5rGC6LSo6YeP5LiO6Leo5bel5Lu25LiA6Ie05oCnICAgfCBQUkQg6K+E5a6h5YmN44CB5Y+Y5pu06IyD5Zu05omp5aSn5pe2ICAgICB8DQp8IGBhc3Nlc3MtaWRlYWAgICAgICAgIHwg55So5q2j5Y+N6K+B5o2u5Yik5pat57un57ut44CB5r6E5riF5oiW5YGc5q2iICAgICB8IOaWueWQkeacquWumuOAgemcgOimgeavlOi+g+aKleWFpeaXtiAgICAgICB8DQoNCiMjIOS9v+eUqOmhuuW6jw0KDQpgYGANCmNsYXJpZnktaW50ZW50IOKGkiB3cml0ZS1wcmQg4oaSIG1hcC1hY2NlcHRhbmNlIOKGkiBjaGVjay1yZXF1aXJlbWVudHMNCmBgYA0KDQrliY3kuIDmraXnmoTkuqflh7rmmK/lkI7kuIDmraXnmoTovpPlhaXjgILot7Pov4cgYGNsYXJpZnktaW50ZW50YCDnm7TmjqXlhpkgUFJE77yM6YCa5bi45Lya5oqK5pyq56Gu6K6k55qE5YGH6K6+5YaZ6L+b6ZyA5rGC44CCDQrmlrnlkJHmnKrlrprlhYjnlKggYGFzc2Vzcy1pZGVhYO+8jOe7p+e7reOAgea+hOa4heWSjOWBnOatouWdh+WPr+W9ouaIkOacieaViOiusOW9le+8m+ivhOS8sOe7k+adn+S4jeiHquWKqOWQr+WKqOWunueOsOOAgg0KDQojIyDkuqTmjqUNCg0KLSDnkIbop6Mg4oaSIGB1bmRlcnN0YW5kaW5nLm1kYO+8jOS6pOS6p+WTgeehruiupOOAgg0KLSBQUkQg4oaSIGBwcmQubWRgICsgYGFjY2VwdGFuY2UueWFtbGDvvIzkuqTor4TlrqHmibnmrKHjgIINCi0g6aqM5pS2IOKGkiDnlLEgUUEg5YGa5Y+v5rWL5oCn562+5qC45ZCO5YaN5Y+R5biD44CCDQo="
      },
      {
        "resourceId": "skill-map-acceptance",
        "path": "roles/product/skills/map-acceptance/SKILL.md",
        "sha256": "4a55c9194e6271027e23822269ca40555157cb1bee1682d849b3b208a901a7e5",
        "byteLength": 2544,
        "mediaType": "text/markdown",
        "bodyBase64": "LS0tDQpuYW1lOiBtYXAtYWNjZXB0YW5jZQ0KZGVzY3JpcHRpb246IOaKiiBQUkQg5ouG5oiQ5bim56iz5a6a5bCP5YaZIGtleeOAgXRleHQg5LiOIHZlcmlmaWNhdGlvbiDnmoTlj6/liKTlrprpqozmlLbmnaHnm67vvIzlubboh6rmo4Dlj6/mtYvmgKfvvJvlvZMgUFJEIOiNieeov+WujOaIkOaIlumqjOaUtumcgOimgeS/ruiuouaXtuS9v+eUqOOAgg0KbGljZW5zZTogTUlUDQptZXRhZGF0YToNCiAgcm9sZUtleTogcHJvZHVjdA0KICBwYWNrYWdlVmVyc2lvbjogMC4xLjANCi0tLQ0KDQojIOaLhuino+mqjOaUtg0KDQojIyDkvZXml7bnlKgNCg0KLSBQUkQg6I2J56i/5a6M5oiQ77yM6ZyA6KaB57uZ5Ye66aqM5pS244CCDQotIOS4i+a4uOWbnumXrumqjOaUtuWPo+W+hO+8jOmcgOimgeihpeWFheaIluS/ruiuouOAgg0KLSDlj5jmm7Tmtonlj4rpqozmlLbmnaHnm67lop7liKDmlLnjgIINCg0KIyMg5q2l6aqkDQoNCjEuIOmAkOadoeivuyBQUkQg55qE55uu5qCH5LiO6IyD5Zu077yM5om+5Ye6Kirlj6/op4LmtYvnmoTnu5PmnpwqKuOAgg0KMi4g5LiA5p2h6aqM5pS25Y+q5YaZ5LiA5Liq57uT5p6c77yb5Ye6546w44CM5bm25LiUIC8g5ZCM5pe244CN5bCx5ouG5oiQ5Lik5p2h44CCDQozLiDpgIkgYHZlcmlmaWNhdGlvbmDvvJoNCiAgIC0g5pyJ5piO56Gu6L6T5YWl6L6T5Ye644CB5Y+v6Ieq5Yqo5YyWIOKGkiBgVEVTVGANCiAgIC0g6ZyA6KaB5Lq655yL77yI55WM6Z2i44CB5paH5qGI44CB6YWN572u77yJ4oaSIGBJTlNQRUNUSU9OYA0KICAgLSDpnIDopoHmjInmraXpqqTmvJTnpLrmiY3og73liKTmlq0g4oaSIGBERU1PYA0KICAgLSDog73nlKggYFRFU1RgIOWwseS4jeeUqOWQjuS4pOenjeOAgg0KNC4g55So56iz5a6a5bCP5YaZIGtlee+8iOS+i+WmgiBgYWMtMDFg44CBYGltcG9ydC13b3Jrc2DvvInvvJvpo47pmannsbvliKvkuI7kvJjlhYjnuqflhpnlnKggUFJEIOaIluivhOWuoeadkOaWme+8jOW9k+WJjSBBUEkg5LiN5L+d5a2Y6aKd5aSW6aqM5pS25a2X5q6144CCDQo1LiDoh6rmo4DvvJrmr4/mnaHpg73og73lhpnlh7rkuIDmrrXkvJrlpLHotKXnmoTmo4Dmn6XlkJfvvJ/lhpnkuI3lh7rlsLHph43lhpnjgIINCg0KIyMg5Y+N5L6LIOKGkiDmraPkvosNCg0KfCDlj43kvosgICAgICAgICAgICAgICAgICAgICAgIHwg6Zeu6aKYICAgICAgIHwg5q2j5L6LICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB8DQp8IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHwgLS0tLS0tLS0tLSB8IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHwNCnwg5LyY5YyW6K6+572u6aG15L2T6aqMICAgICAgICAgICAgIHwg5LiN5Y+v5Yik5a6aICAgfCDml6Aga2V5IOaXtu+8jOiuvue9rumhteaYvuekuuOAjOacqumFjee9ruaooeWei+OAjeaPkOekuu+8jOS/neWtmOaMiemSruemgeeUqCB8DQp8IOaUr+aMgeacrOWcsOaooeWei+WSjOS6keerr+aooeWeiyAgICAgfCDkuKTmnaHloZ7kuIDmnaEgfCBhYy0wMSDlj6/liIfmjaLliLDmnKzlnLDmqKHlnovvvJthYy0wMiDlj6/liIfmjaLlm57kupHnq6/mqKHlnosgICAgICAgIHwNCnwg57O757uf5bqU56iz5a6a6L+Q6KGMICAgICAgICAgICAgIHwg5rC46L+c5Li655yfICAgfCDov57nu60gMjQg5bCP5pe26K+35rGC6ZSZ6K+v546HIDwgMC4xJSAgICAgICAgICAgICAgICAgICAgICAgICB8DQp8IOiwg+eUqCByZWZyZXNoVG9rZW4g5o6l5Y+j57ut5pyfIHwg57uR5a6a5a6e546wICAgfCDkvJror53ov4fmnJ/lkI7oh6rliqjnu63mnJ/vvIzkuJTkuI3kuKLlpLHlvZPliY3nvJbovpEgICAgICAgICAgICAgICAgICB8DQoNCiMjIOm7keWQjeWNlQ0KDQpg5Y+L5aW9YOOAgWDlv6vpgJ9g44CBYOWQiOeQhmDjgIFg5bC96YePYOOAgWDkvJjljJZg44CBYOWujOWWhGDjgIJg5pSv5oyBYCDlkI7pnaLlv4Xpobvot5/lj6/op4LmtYvnu5PmnpzvvIzlkKbliJnmlLnlhpnjgIINCg0KIyMg57KS5bqmDQoNCi0g5Lul5Y+v54us56uL6aqM6K+B5Li65YeG77yM5bi46KeB5bCP6ZyA5rGC5Y+v55SoIDPigJM4IOadoeS9nOS4uuWPguiAg++8m+S4jeimgeS4uuS6huaVsOmHj+aLhuaVo+S4gOS4quihjOS4uuOAguato+W8jyBBUEkg5YWB6K64IDHigJMyMDAg5p2h44CCDQotIOS4gOihjOS4muWKoeinhOWImemAmuW4uOWvueW6lOS4gOadoemqjOaUtu+8jOS9huS4jeimgeaKiuWunueOsOatpemqpOWGmeaIkOmqjOaUtuOAgg0KDQojIyDkuqTmjqUNCg0K5Lqn5Ye6IGBhY2NlcHRhbmNlLnlhbWxgIOS+m+mYheivu++8jOS4jiBgYWNjZXB0YW5jZS5qc29uYCDkuK3nmoQgSlNPTiDmlbDnu4Tkv53mjIHkuIDoh7TvvIzmraPlvI/mj5DkuqTkvb/nlKggYC0tYWNjZXB0YW5jZSBAYWNjZXB0YW5jZS5qc29uYO+8iGBrZXkgLyB0ZXh0IC8gdmVyaWZpY2F0aW9uYO+8ieOAguS6pOS6p+WTgeehruiupOOAgVFBIOWBmuWPr+a1i+aAp+etvuaguO+8m+mqjOaUtuWPkeW4g+WQju+8jOS7u+WKoeimhuebluWFs+ezu+eUseWunuS+i+WMluaXtuehruiupOOAgg0K"
      },
      {
        "resourceId": "skill-write-prd",
        "path": "roles/product/skills/write-prd/SKILL.md",
        "sha256": "529702e36cc56b999c3ff74ae91f2828bdf8409bcd957fc15f2c2acc65afc1be",
        "byteLength": 2103,
        "mediaType": "text/markdown",
        "bodyBase64": "LS0tDQpuYW1lOiB3cml0ZS1wcmQNCmRlc2NyaXB0aW9uOiDln7rkuo7lt7Lnoa7orqTnmoTnkIbop6PkuI7kuJrliqHnn6Xor4bkuqflh7ogUFJE77yM5YaZ5riF6IOM5pmv44CB6IyD5Zu044CB57qm5p2f5LiO5L6d6LWW77yb5b2T55CG6Kej5bey56Gu6K6k44CB6ZyA6KaB5Ye656i/5oiW5L+u6K6iIFBSRCDml7bkvb/nlKjjgIINCmxpY2Vuc2U6IE1JVA0KbWV0YWRhdGE6DQogIHJvbGVLZXk6IHByb2R1Y3QNCiAgcGFja2FnZVZlcnNpb246IDAuMS4wDQotLS0NCg0KIyDmkrDlhpkgUFJEDQoNCiMjIOS9leaXtueUqA0KDQotIOeQhuino+W3suehruiupO+8jOmcgOimgeS6p+WHuuaIluS/ruiuoiBQUkTjgIINCi0g5bey5pyJIFBSRCDpnIDopoHpmo/lj5jmm7TljYfniYjjgIINCg0KIyMg57uT5p6EDQoNCuaMiSBgcHJkYCDmqKHmnb/opobnm5bku6XkuIvkv6Hmga/vvIznq6DoioLlj6/lkIjlubbvvIzlpI3mnYLpnIDmsYLmjInpo47pmanlop7liqDlnLrmma/jgIHovrnnlYzjgIHlvILluLjkuI7pnZ7lip/og73opoHmsYLvvJoNCg0KMS4gKirog4zmma8qKu+8muS4uuS7gOS5iOeOsOWcqOWBmu+8jOiwgeWPl+W9seWTjeOAgg0KMi4gKirnm67moIcqKu+8muS4gOWPpeWPr+mqjOivgeeahOebruagh++8jOS4jeWGmeaEv+aZr+OAgg0KMy4gKirojIPlm7QqKu+8muWBmuS7gOS5iCAvIOS4jeWBmuS7gOS5iO+8jOWQhOWIl+S4ieadoeS7peWGheOAgg0KNC4gKirmlrnmoYjopoHngrkqKu+8muWPquWGmee6puadn+S4juWFs+mUruWPluiIje+8jOS4jeWGmeWunueOsOe7huiKguOAgg0KNS4gKirkvp3otZbkuI7nuqbmnZ8qKu+8mua2ieWPiueahOWNleWFg+OAgeWlkee6puOAgeWklumDqOezu+e7n+OAgeWQiOinhOimgeaxguOAgg0KNi4gKirpqozmlLYqKu+8muaMh+WQkSBgYWNjZXB0YW5jZS55YW1sYO+8jOato+aWh+S4jemHjeWkjeOAgg0KDQojIyDop4TliJkNCg0KLSDkuI3oh4bpgKDpnIDmsYLvvJrlj6rlhpnnkIbop6PkuK3lt7Lnoa7orqTnmoTlhoXlrrnvvIzmnKrnoa7orqTnmoTnlZnlnKjjgIzmnKrnn6XpobnjgI3jgIINCi0g5q+P5p2h5YWz6ZSu57uT6K665qCH5rOo5L6d5o2u77yI55+l6K+G5bqT5p2h55uuIGtleeOAgeWOhuWPsumcgOaxgue8luWPt+OAgeWGs+etluiusOW9le+8ieOAgg0KLSDkuI3lhpnlrp7njrDnu4boioLvvJrmjqXlj6PjgIHooajnu5PmnoTjgIHnu4Tku7blkI3lsZ7kuo7mioDmnK/mlrnmoYjvvIzkuI3lsZ7kuo4gUFJE44CCDQotIOiMg+WbtOW/hemhu+WPr+WIpOWumu+8muWHuueOsOOAjOetieOAjeOAjOebuOWFs+OAjeOAjOexu+S8vOOAjeWwseWxleW8gOaIluWIoOaOieOAgg0KLSDnroDljZXmlLnliqjkv53mjIHnroDnn63vvIzlpI3mnYLpnIDmsYLlhpnlhajor4Hmja7kuI7ovrnnlYzvvJvmjInlj6/ni6znq4vpqozmlLbnmoTkuJrliqHlnLrmma/mi4bojIPlm7TvvIzkuI3ku6XpobXmlbDlhrPlrprmmK/lkKblkIjmoLzjgIINCi0g5aSa5Zy65pmv6ZyA5rGC5qCH5piOIFAxL1AyL1AzIOS4jueLrOeri+mqjOivgeaWueW8j++8jOivtOaYjuacgOWwj+err+WIsOerryBNVlAg5YiH54mH77yM5Lul5Y+K5bu25pyf6aG555qE55CG55SxL+mHjeWQr+adoeS7tu+8m+S8mOWFiOe6p+S6pOS4muWKoei0n+i0o+S6uuehruiupOOAgueugOWNlemcgOaxguS4jemineWkluaLhuWIhuOAgumqjOaUtuWSjOaIkOWKn+aMh+agh+WPr+inguWvn+OAgeWPr+WIpOWumu+8jOacquefpemhueWSjOWBh+iuvuWIhuW8gOOAgg0KLSBQUkQg6K+E5a6h5YmN5L2/55SoIGBjaGVjay1yZXF1aXJlbWVudHNg77yM5oyJ5a6e6ZmF6aOO6Zmp6YCJ5oup6LSo6YeP5riF5Y2V44CCDQoNCiMjIOS4jumqjOaUtueahOWIhuW3pQ0KDQpQUkQg6K+044CM5YGa5LuA5LmI44CB5Li65LuA5LmI44CN77yM6aqM5pS26K+044CM5oCO5LmI566X5a6M5oiQ44CN44CC5Lik6ICF5YiG5byA5YaZ77yM6aqM5pS255SxIGBtYXAtYWNjZXB0YW5jZWAg5Lqn5Ye644CCDQoNCiMjIOS6pOaOpQ0KDQrkuqflh7ogYHByZC5tZGAgKyBgYWNjZXB0YW5jZS55YW1sYO+8jOaPkOS6pOivhOWuoe+8m1FBIOWBmuWPr+a1i+aAp+etvuaguO+8jOS6p+WTgei0n+i0o+S6uuaJueWHhuWQjuWPkeW4g+OAgg0K"
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
          "sha256": "d7721e8f1c7252a2d6eb6b6e4a00f539ca9a69a71e46835474e516e471285cc7",
          "byteLength": 960,
          "mediaType": "application/yaml"
        },
        {
          "id": "template-defect",
          "kind": "template",
          "path": "assets/templates/defect.md",
          "sha256": "c13021d685c611bf9e7c344035a7641802a66eea65d9a7510f51554fafe3f708",
          "byteLength": 597,
          "mediaType": "text/markdown"
        },
        {
          "id": "template-delivery-audit",
          "kind": "template",
          "path": "assets/templates/delivery-audit.md",
          "sha256": "90b57b396403e8b5bff86ddccbca7d6e7bd33f3f1b1c87b8952c166840505fef",
          "byteLength": 900,
          "mediaType": "text/markdown"
        },
        {
          "id": "template-evals",
          "kind": "template",
          "path": "assets/templates/evals.yaml",
          "sha256": "37b1a23600a3153e472b060f4b4122363b1b016a2194fe49c65657064eeb3409",
          "byteLength": 929,
          "mediaType": "application/yaml"
        },
        {
          "id": "checklist-cases-coverage",
          "kind": "checklist",
          "path": "checklists/cases-coverage.md",
          "sha256": "760cdc3f3603ad88eac23bbfc23cb0e7a6f449c7d5cc36e5203f3c981ebc1de3",
          "byteLength": 1087,
          "mediaType": "text/markdown"
        },
        {
          "id": "checklist-spec-driven",
          "kind": "checklist",
          "path": "checklists/spec-driven.md",
          "sha256": "f14e1b1d96d8be04b73192dba26f10acebad4354bbb6f8af8843c0e9320edcaa",
          "byteLength": 1136,
          "mediaType": "text/markdown"
        },
        {
          "id": "guide",
          "kind": "prompt",
          "path": "guide.md",
          "sha256": "0adc5e673d96314571ee17eea339c43a8374dd819095b8d7544c1008819dfbbd",
          "byteLength": 4890,
          "mediaType": "text/markdown"
        },
        {
          "id": "reference-references",
          "kind": "reference",
          "path": "references/references.json",
          "sha256": "bdd2d557eb289d483cccb56bd4b07649281943542bbcacd2d50b28adb7096257",
          "byteLength": 706,
          "mediaType": "application/json"
        },
        {
          "id": "skill-audit-delivery",
          "kind": "skill",
          "path": "skills/audit-delivery/SKILL.md",
          "sha256": "b765ef2590ec9298586011108c4dc203c24eeb2c2d3545b944f2156533855926",
          "byteLength": 1517,
          "mediaType": "text/markdown"
        },
        {
          "id": "skill-derive-cases",
          "kind": "skill",
          "path": "skills/derive-cases/SKILL.md",
          "sha256": "b684f7f9426a89b1bc969bf9d7e613cee99d4a3a2af198f69d7fc119b511a196",
          "byteLength": 1689,
          "mediaType": "text/markdown"
        },
        {
          "id": "skills-index",
          "kind": "index",
          "path": "skills/index.md",
          "sha256": "97ce081a2dc5ee19b60bd421d7b49829a28e18a68637e1a0b5ae0759e60a9812",
          "byteLength": 1087,
          "mediaType": "text/markdown"
        },
        {
          "id": "skill-report-defects",
          "kind": "skill",
          "path": "skills/report-defects/SKILL.md",
          "sha256": "b177d8c110f2c546620812a773f6aa78c50643ea9b593ca070b70d1738d98c11",
          "byteLength": 1620,
          "mediaType": "text/markdown"
        },
        {
          "id": "skill-run-evals",
          "kind": "skill",
          "path": "skills/run-evals/SKILL.md",
          "sha256": "a7fd06a4fba23c7305ae8524f3d796ce6098fbfba84f9322d6eb7c344cd93a17",
          "byteLength": 1776,
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
        "sha256": "d7721e8f1c7252a2d6eb6b6e4a00f539ca9a69a71e46835474e516e471285cc7",
        "byteLength": 960,
        "mediaType": "application/yaml",
        "bodyBase64": "IyDnlKjkvovmqKHmnb8NCiMgaWQ6IFRDLTzpnIDmsYLnvJblj7c+LTzluo/lj7c+DQojIGNvdmVyczog6KaG55uW55qE6aqM5pS2IGtlee+8jOiHs+WwkeS4gOS4qg0KIyBraW5kOiBURVNUIHwgSU5TUEVDVElPTiB8IERFTU/vvIjkuI7pqozmlLbnmoQgdmVyaWZpY2F0aW9uIOWvuem9kO+8iQ0KDQp2ZXJzaW9uOiAxDQpwaGFzZTogREVTSUdODQpleGVjdXRpb25TdGF0dXM6IE5PVF9SVU4NCnJlcXVpcmVtZW50OiA8UFJPSkVDVF9LRVk+LTzluo/lj7c+DQoNCmNhc2VzOg0KICAtIGlkOiBUQy085bqP5Y+3Pi0wMQ0KICAgIGNvdmVyczogW2FjLTAxXQ0KICAgIGtpbmQ6IFRFU1QNCiAgICBnaXZlbjogPOWJjee9rueKtuaAgeS4juaVsOaNrj4NCiAgICB3aGVuOiA85pON5L2cPg0KICAgIHRoZW46IDzlj6/op4LmtYvnu5PmnpzvvIzkuIDmnaHmlq3oqIA+DQogICAgZGF0YToNCiAgICAgIC0gPOa1i+ivleaVsOaNruaIliBmaXh0dXJlIOi3r+W+hD4NCg0KICAtIGlkOiBUQy085bqP5Y+3Pi0wMg0KICAgIGNvdmVyczogW2FjLTAyXQ0KICAgIGtpbmQ6IElOU1BFQ1RJT04NCiAgICBnaXZlbjogPOeZu+W9leinkuiJsuS4jumhtemdoj4NCiAgICB3aGVuOiA85pON5L2cPg0KICAgIHRoZW46IDznlYzpnaLlupTlkYjnjrDnmoTlhoXlrrk+DQogICAgZXZpZGVuY2U6IOaIquWbvg0KDQogIC0gaWQ6IFRDLTzluo/lj7c+LTAzDQogICAgY292ZXJzOiBbYWMtMDNdDQogICAga2luZDogREVNTw0KICAgIGdpdmVuOiA85bey56Gu6K6k55qE5ryU56S6546v5aKD5LiO5pWw5o2uPg0KICAgIHdoZW46IDzmjInmraXpqqTmvJTnpLo+DQogICAgdGhlbjogPOWPr+ingua1i+e7k+aenD4NCg0KY292ZXJhZ2U6DQogIHVuY292ZXJlZDogW10NCiMgdW5jb3ZlcmVkIOekuuS+i++8mi0gYWMtMDNcbiMgICDljp/lm6A6IOmcgOimgeecn+WunuesrOS4ieaWueeOr+Wig++8jOaagueUsSBERU1PIOimhueblg0K"
      },
      {
        "resourceId": "template-defect",
        "path": "roles/qa/assets/templates/defect.md",
        "sha256": "c13021d685c611bf9e7c344035a7641802a66eea65d9a7510f51554fafe3f708",
        "byteLength": 597,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDnvLrpmbfvvJo8546w6LGhICsg5p2h5Lu2Pg0KDQo+IOmcgOaxgue8luWPt++8mjxQUk9KRUNUX0tFWT4tPOW6j+WPtz4gwrcg6aqM5pS277yaYWMtMDEgwrcg5Lu75Yqh77yaPHRhc2sgY29kZT4NCj4g5o+Q5Lqk77yaPHNoYT4gwrcg57qn5Yir77ya6Zi75aGeIC8g5Lil6YeNIC8g5LiA6IisIC8g5bu66K6uDQoNCiMjIOWJjee9rg0KDQotIOeOr+Wig++8mg0KLSDniYjmnKwgLyDplZzlg4/vvJoNCi0g6LSm5Y+35LiO5p2D6ZmQ77yaDQotIOaVsOaNru+8mg0KDQojIyDlpI3njrDmraXpqqQNCg0KMS4NCjIuDQozLg0KDQojIyDmnJ/mnJsgdnMg5a6e6ZmFDQoNCi0g5pyf5pyb77yI5byV55So6aqM5pS25Y6f5paH77yJ77yaDQotIOWunumZhe+8mg0KDQojIyDlvbHlk40NCg0KLSDpmLvloZ7lk6rkupvpqozmlLbvvJoNCi0g5b2x5ZON5ZOq5Lqb55So5oi3IC8g5Zy65pmv77yaDQotIOaYr+WQpuacieS4tOaXtue7lei/h++8mg0KDQojIyDor4Hmja4NCg0KLSDml6Xlv5fvvJoNCi0g5oiq5Zu+77yaDQotIOivt+axgiBJRO+8mg0KDQojIyDlm57lvZINCg0KLSDlpI3ot5HnlKjkvovvvJoNCi0g57uT5p6c77yaDQotIOWFs+mXreS+neaNru+8mg0K"
      },
      {
        "resourceId": "template-delivery-audit",
        "path": "roles/qa/assets/templates/delivery-audit.md",
        "sha256": "90b57b396403e8b5bff86ddccbca7d6e7bd33f3f1b1c87b8952c166840505fef",
        "byteLength": 900,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDkuqTku5jmoLjpqozvvJo86ZyA5rGC57yW5Y+3Pg0KDQo+IFBSRCDkv67orqLvvJo8aWQ+IMK3IOW/q+eFp++8mjxpZD4gwrcg5o+Q5Lqk77yaPOWujOaVtCBTSEE+IMK3IOeUqOS+i+S/ruiuoi/njq/looPvvJo854mI5pysPg0KPiDmnaXmupDvvJpBZ2VudCDmo4Dmn6XmiqXlkYrvvJvmraPlvI/pqozmlLblvoUgSFVNQU4g5Yaz5a6a44CCDQoNCiMjIOmqjOaUtuaYoOWwhA0KDQp8IOmqjOaUtiBrZXkgfCDku7vliqEgfCDku6PnoIHkvY3nva4gfCDnlKjkvosgfCDlrp7pmYXnu5PmnpzkuI7or4Hmja4gfCDnu5Porrov6ZmQ5Yi2IHwNCnwgLS0tLS0tLS0gfCAtLS0tIHwgLS0tLS0tLS0gfCAtLS0tIHwgLS0tLS0tLS0tLS0tLS0gfCAtLS0tLS0tLS0gfA0KfCBhYy0wMSAgICB8ICAgICAgfCAgICAgICAgICB8ICAgICAgfCDmnKrmiafooYwgICAgICAgICB8IOaXoOazlemqjOivgSAgfA0KDQojIyDnvLrlj6PkuI7lkI7nu63lt6XkvZzmj5DmoYgNCg0KfCDnqLPlrpogSUQgfCDpqozmlLYga2V5IHwg57y65aSxL+WBj+W3ruWPiuS9jee9riB8IOWIhuexuyB8IOW7uuiurui0n+i0o+S6uiB8IOWkjemqjOadoeS7tiB8IOWOn+iusOW9lSB8DQp8IC0tLS0tLS0gfCAtLS0tLS0tLSB8IC0tLS0tLS0tLS0tLS0tLSB8IC0tLS0gfCAtLS0tLS0tLS0tIHwgLS0tLS0tLS0gfCAtLS0tLS0gfA0KfCBnYXAtMDEgIHwgYWMtMDEgICAgfCAgICAgICAgICAgICAgICAgfCAgICAgIHwgICAgICAgICAgICB8ICAgICAgICAgIHwgICAgICAgIHwNCg0KIyMg5L+u6K6i5Y6G5Y+yDQoNCui/veWKoOavj+i9ruaPkOS6pOOAgeWPkeeOsOS4juino+WGs+S+neaNru+8m+S/neeVmeaXp+e7k+iuuuOAgumYu+WhnuOAgeWksei0peOAgeacquaJp+ihjOWSjOacquajgOafpeWdh+aYjuehruWIl+WHuuOAgg0K"
      },
      {
        "resourceId": "template-evals",
        "path": "roles/qa/assets/templates/evals.yaml",
        "sha256": "37b1a23600a3153e472b060f4b4122363b1b016a2194fe49c65657064eeb3409",
        "byteLength": 929,
        "mediaType": "application/yaml",
        "bodyBase64": "IyDor4TmtYvnu5PmnpzmqKHmnb8NCiMg5Zu65a6a546v5aKD5LiO54mI5pys77yM57uT5p6c5omN5Y+v5q+U6L6D77yb5aSx6LSl5b+F6aG75YiG57G777yM5LiN6YeN6LeR5Yiw57u/44CCDQoNCnN1aXRlOiA8c3VpdGUg5ZCN56ewPg0KcGhhc2U6IEVYRUNVVElPTg0KcmVxdWlyZW1lbnQ6IDxQUk9KRUNUX0tFWT4tPOW6j+WPtz4NCmNhc2VzUmV2aXNpb246IDznlKjkvovlt6Xku7bmiJbkv67orqLmoIfor4Y+DQpjb21taXQ6IDw0MCDkvY0gc2hhPg0KZW52aXJvbm1lbnQ6DQogIGJ1aWxkOiA854mI5pys5oiW6ZWc5YOPPg0KICBkYXRhYmFzZTogPOeJiOacrD4NCiAgc2VydmljZXM6IFtdDQogIHN0YXJ0ZWRBdDogPElTTyDml7bpl7Q+DQoNCnN1bW1hcnk6DQogIHRvdGFsOiAwDQogIHBhc3NlZDogMA0KICBmYWlsZWQ6IDANCiAgZmxha3k6IDANCiAgZHVyYXRpb25NczogMA0KDQpyZXN1bHRzOg0KICAtIGNhc2U6IFRDLTzluo/lj7c+LTAxDQogICAgc3RhdHVzOiBQQVNTRUQNCiAgICBkdXJhdGlvbk1zOiAwDQogIC0gY2FzZTogVEMtPOW6j+WPtz4tMDQNCiAgICBzdGF0dXM6IEZBSUxFRA0KICAgIGR1cmF0aW9uTXM6IDANCiAgICBraW5kOiBQUk9EVUNUX0RFRkVDVA0KICAgIGV2aWRlbmNlOiA85pel5b+XIC8g5oiq5Zu+IC8g6K+35rGCIElEPg0KDQpmYWlsdXJlczoNCiAgLSBjYXNlOiBUQy085bqP5Y+3Pi0wNA0KICAgIGtpbmQ6IFBST0RVQ1RfREVGRUNUDQogICAgcmVhc29uOiA85LiA5Y+l6K+d5qC55ZugPg0KICAtIGNhc2U6IFRDLTzluo/lj7c+LTA3DQogICAga2luZDogQ0FTRV9JTlZBTElEDQogICAgcmVhc29uOiA85pat6KiA5LuN5oyJ5pen54mI5aWR57qm57yW5YaZPg0KICAtIGNhc2U6IFRDLTzluo/lj7c+LTA5DQogICAga2luZDogRU5WSVJPTk1FTlQNCiAgICByZWFzb246IDzkvp3otZbmnKrlkK/liqg+DQo="
      },
      {
        "resourceId": "checklist-cases-coverage",
        "path": "roles/qa/checklists/cases-coverage.md",
        "sha256": "760cdc3f3603ad88eac23bbfc23cb0e7a6f449c7d5cc36e5203f3c981ebc1de3",
        "byteLength": 1087,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDnlKjkvovopobnm5bmuIXljZUNCg0KLSBbIF0g5q+P5p2h6aqM5pS26Iez5bCR5LiA5Liq55So5L6L44CCDQotIFsgXSDnlKjkvosgYGNvdmVyc2Ag5byV55So55qEIGtleSDlnKjpqozmlLbph4zlrZjlnKjjgIINCi0gWyBdIGBraW5kYCDkuI7pqozmlLbnmoQgYHZlcmlmaWNhdGlvbmAg5LiA6Ie044CCDQotIFsgXSDovrnnlYzopobnm5bvvJrnqbrlgLzjgIHotoXplb/jgIHlubblj5HjgIHmnYPpmZDkuI3otrPjgIINCi0gWyBdIOW8guW4uOimhueblu+8muS4i+a4uOWksei0peOAgei2heaXtuOAgemZkOa1geOAgg0KLSBbIF0g55So5L6LIElEIOWUr+S4gO+8jOagvOW8j+S4uiBgVEMtPOmcgOaxgue8luWPtz4tPOW6j+WPtz5g44CCDQotIFsgXSDkuIDmnaHnlKjkvovlj6rpqozkuIDkuKrmlq3oqIDjgIINCi0gWyBdIOimhueblue8uuWPo+W3suaYvuW8j+WIl+WHuu+8jOW5tuivtOaYjueUseiwgeOAgeS9leaXtuihpeOAgg0KLSBbIF0g5LiN5rWL5a6e546w57uG6IqC77yM5Y+q5rWL6KGM5Li65LiO5aWR57qm44CCDQotIFsgXSDnlKjkvovorr7orqHmoIforrDmnKrmiafooYzvvIzkuI3mioropobnm5bmo4Dmn6XlvZPmiJDlip/og73pgJrov4fjgIINCi0gWyBdIOa1i+ivleaJp+ihjOmYtuauteWbuuWumuWunueOsOOAgeeUqOS+i+S4jueOr+Wig+eJiOacrO+8jOe7k+aenOWPr+i3qOeJiOacrOavlOi+g+OAgg0KLSBbIF0g5omn6KGM57uT5p6c5aaC5a6e6K6w5b2V5aSx6LSl5LiO6Zi75aGe77yM5pyq5omn6KGM5pe25LiN5aOw5piOIGBjYXNlcy1leGVjdXRlZDogdHJ1ZWDjgIINCg0KIyMg5Lqk5LuY5YmN5pyA5ZCO5LiJ6ZeuDQoNCjEuIOWmguaenOi/meadoemcgOaxguS4iue6v+WQjuWHuumXrumimO+8jOeOsOacieeUqOS+i+iDveS4jeiDveWumuS9jeWIsOWTquS4qumqjOaUtuayoei/h++8nw0KMi4g5pyJ5rKh5pyJ5LiA5p2h55So5L6L77yM5Yig5o6J5LmL5ZCO5L2g5L6d54S25pyJ5L+h5b+D5LiK57q/77yf5aaC5p6c5pyJ77yM5a6D5Y+v6IO95rKh55So44CCDQozLiDlpLHotKXliIbnsbvlhpnmuIXmpZrkuoblkJfvvIzov5jmmK/lhajmoIfmiJDjgIzkuqflk4HnvLrpmbfjgI3vvJ8NCg=="
      },
      {
        "resourceId": "checklist-spec-driven",
        "path": "roles/qa/checklists/spec-driven.md",
        "sha256": "f14e1b1d96d8be04b73192dba26f10acebad4354bbb6f8af8843c0e9320edcaa",
        "byteLength": 1136,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDop4TmoLzkuI7kuqTku5jljY/kvZzmo4Dmn6UNCg0K5Y+q5Yqg6L295pys5qyh5Lu75Yqh5raJ5Y+K55qE5qih5p2/5ZKM5riF5Y2V44CC566A5Y2V5pS55Yqo5YaZ5b+F6KaB5L+h5oGv77yb5aSN5p2C5bqm5p2l6Ieq6aOO6Zmp44CB5L6d6LWW5ZKM6aqM5pS26IyD5Zu077yM5LiN5oyJ5Zu65a6a6aG15pWw5oiW56ug6IqC5pWw5Yik5pat6LSo6YeP44CCDQoNCi0gWyBdIOW3suivu+acrOasoeW/q+eFp+S4jumhueebruinhOiMg++8jOehruiupCBQUkQv55+l6K+G5L+u6K6i77yb6ICB6aG555uu5YWI5qC45a+55a6e6ZmF5Luj56CB44CB5bel5YW36YWN572u5LiO546w5pyJ6KGM5Li644CCDQotIFsgXSDlhbPplK7nu5PorrrmnInmnaXmupDvvJvosIPmn6XmnKrnn6XpobnjgIHmlrnmoYjlj5boiI3jgIHkvovlpJbkuI7lu7bmnJ/lnYfmnInnkIbnlLHlkozotKPku7vkurrjgIINCi0gWyBdIOS7peW3suehruiupOmqjOaUtiBrZXkg5YWz6IGU5pys6KeS6Imy5Lqn54mp77yb5Lu75Yqh5YiX5L6d6LWW44CB6LSf6LSj5paH5Lu25LiO6aqM6K+B5pa55byP77yM5YWx55So5paH5Lu25LiN5peg5L6d5o2u5Zyw5bm26KGM5L+u5pS544CCDQotIFsgXSDpnIDmsYLotKjph4/jgIHnlKjkvovorr7orqHopobnm5bjgIHlrp7pmYXmiafooYznu5PmnpzlkowgSFVNQU4g5q2j5byP6aqM5pS25YiG5Yir6K6w5b2V44CCDQotIFsgXSDmiYDmnInmnKrov5DooYzjgIHlpLHotKXjgIHpmLvloZ7jgIHml6Dms5XmoLjpqoznmoTlhoXlrrnmmI7noa7moIflh7rvvJtBZ2VudCDmiqXlkYrkuI3lo7Dnp7Dni6znq4vpqozor4HjgIINCi0gWyBdIOe8uuWPo+S7peeos+WumiBJRCDov73liqDlubblm57pk77ljp/orrDlvZXvvJvotoXlh7rpnIDmsYLojIPlm7TlhYjotbDlj5jmm7TvvIzkv67mlLnln7rnur/lkI7ph43mlrDmoLjlr7nor4Hmja7jgIINCg0K6KeS6Imy6LWE5rqQ5pu05paw77ya5bey6ZSB5a6a54mI5pys5L+d5oyB5Y6f5a2X6IqC77yM5paw5pa55rOV5Zyo5paw5YyF54mI5pys5a6J6KOF5ZCO55Sf5pWI44CC5a6/5Li75YWl5Y+j5Y+q5oyH5ZCR6KeS6Imy6LWE5rqQ77yb6aG555uu6Ieq5a6a5LmJ6KeE6IyD6ZqP6aG555uu55+l6K+G5L+u6K6i77yM5LiN5aSN5Yi26L+b6KeS6Imy5YyF44CCDQo="
      },
      {
        "resourceId": "guide",
        "path": "roles/qa/guide.md",
        "sha256": "0adc5e673d96314571ee17eea339c43a8374dd819095b8d7544c1008819dfbbd",
        "byteLength": 4890,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDmtYvor5Xop5LoibLvvIhxYe+8iQ0KDQrkvaDmjInku7vliqHpmLbmrrXkuqflh7ogYENBU0VTYCDlt6Xku7bvvJrnlKjkvovorr7orqHpmLbmrrXmj5DkvpvpqozmlLbopobnm5bvvIzmtYvor5XmiafooYzpmLbmrrXmj5DkvpvnnJ/lrp7miafooYzorrDlvZXkuI7nu5PorrrjgIINCuS9oOeahOS7t+WAvOWcqOS6jioq55So6K+B5o2u6K+06K+dKirvvIzkuI3mmK/nu5nlrp7njrDnm5bnq6DjgIINCg0KIyMg6L6555WMDQoNCi0g5Y+q5Lqn5Ye6IGBDQVNFU2DvvJvkuI3mlLnlrp7njrDjgIHkuI3mlLkgUFJE44CB5LiN5Y+R5biD44CB5LiN5om55YeG44CCDQotIOavj+adoeeUqOS+i+W/hemhu+iDvei/vea6r+WIsCBQUkQg55qEIGBhY2NlcHRhbmNlW10ua2V5YO+8m+aXoOazlei/vea6r+eahOWcuuaZr+imgeWFiOWbnuWIsOS6p+WTgeinkuiJsuOAgg0KLSDnlKjkvovorr7orqHlj6/ku6XlnKjku6PnoIHlrozmiJDliY3ov5vooYzvvIzmmI7noa7moIforrDigJzmnKrmiafooYzigJ3vvJvopobnm5blrozmlbTkuI3ku6Pooajlip/og73pgJrov4fjgIINCi0g5rWL6K+V5omn6KGM57uT6K665Li66YCa6L+H44CB5aSx6LSl77yI6ZmE5pyA5bCP5aSN546w77yJ5oiW6Zi75aGe77yI6ZmE57y65aSx5p2h5Lu277yJ44CC5LiN5YWB6K64IuWfuuacrOWPr+eUqCLjgIINCg0KIyMg5YWI56Gu6K6k5b2T5YmN5Lu75Yqh6Zi25q61DQoNCnwg5b2T5YmN5Lu75YqhICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfCDliY3nva7mnaHku7YgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHwg5Lqk5LuY5YaF5a65ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfCDlj6/ku6Xlo7DmmI7nmoTmo4Dmn6UgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfA0KfCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHwgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHwgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSB8IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHwNCnwg6L2v5Lu25Lqk5LuY5qih5p2/IGBjYXNlc2DvvJrnlKjkvovorr7orqHkuI7opobnm5YgIHwg5bey5Y+R5biDIFBSRCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHwgYGNhc2VzLnlhbWxg77yM6aqM5pS25Yiw55So5L6L5pig5bCE44CB6KaG55uW57y65Y+j77yb5omn6KGM54q25oCB5Li65pyq5omn6KGMICAgfCDlrp7pmYXmo4Dmn6Xov4fnmoQgYGFjY2VwdGFuY2UtY292ZXJlZGDvvJvkuI3loasgYGNhc2VzLWV4ZWN1dGVkOiB0cnVlYCB8DQp8IOi9r+S7tuS6pOS7mOaooeadvyBgYWNjZXB0YO+8mua1i+ivleaJp+ihjOS4jue7k+aenCB8IOWJjeWQjuerr+WunueOsOS4jueUqOS+i+W3suWujOaIkO+8jOS4iuS4i+aWh+WMheWQq+WvueW6lOW3peS7tiB8IGBldmFscy55YW1sYO+8jOWunueOsOeJiOacrOOAgeeOr+Wig+OAgeeUqOS+i+eJiOacrOOAgeWunumZhee7k+aenOS4juWksei0peivgeaNriB8IOecn+WunuaJp+ihjOWQjuaJjeWPr+WhqyBgY2FzZXMtZXhlY3V0ZWRg77yb5omn6KGM5a6M5oiQ5LiN562J5LqO5YWo6YOo6YCa6L+HICAgICAgfA0KfCDmoIflh4bmqKHmnb8gYGNhc2VzYO+8mua1i+ivleaJp+ihjOS4jue7k+aenCAgICAgIHwg5a6e546w5bey5a6M5oiQICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfCDnlKjkvovopobnm5bkuI7miafooYznu5PmnpwgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHwg5ZCM5LiK77yM57y65bCR5p6E5bu65oiW546v5aKD5pe25oql5ZGK6Zi75aGeICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfA0KDQroh6rlrprkuYnmtYHnqIvku6XlvZPliY3ku7vliqHnmoTkvp3otZbjgIHovpPlhaXlkozovpPlh7rkuLrlh4bvvJvpmLbmrrXkuI3mmI7noa7ml7blhYjlkJHmtYHnqIvotJ/otKPkurrnoa7orqTjgIJIVU1BTiDlnKggV2ViIOWuoeafpeaKpeWRiuW5tuS9nOWHuuato+W8j+mqjOaUtuWGs+Wumu+8jEFnZW50IOS4jeiDveetvuWtl+OAgg0KDQojIyDkuIDmrKHlrozmlbTlvqrnjq8NCg0KYGBgYmFzaA0Kd29ya21lc2ggYXV0aCBsb2dpbg0KDQp3b3JrbWVzaCBjb250ZXh0IC0tdGFzayA8dGFza0lkPiAtLWluc3BlY3QNCndvcmttZXNoIGNsYWltIC0tdGFzayA8dGFza0lkPg0Kd29ya21lc2ggY29udGV4dCAtLXRhc2sgPHRhc2tJZD4gLS1jbGFpbSA8Y2xhaW1JZD4gLS1leHBlY3RlZC12ZXJzaW9uIDx0YXNrVmVyc2lvbj4gLS1tYXRlcmlhbGl6ZQ0KDQojIOeUqOS+i+iuvuiuoeWFiOehruiupCBQUkTvvJvmtYvor5XmiafooYzov5jopoHnoa7orqTkuIrmuLjlrp7njrDjgIHnlKjkvovjgIHmnoTlu7rkuI7njq/looPniYjmnKwNCmNhdCAud29ya21lc2gvbG9jYWwvY29udGV4dC88c25hcHNob3RJZD4vbWFuaWZlc3QuanNvbg0KDQp3b3JrbWVzaCBkZWxpdmVyIFwNCiAgLS10YXNrIDx0YXNrSWQ+IC0tY2xhaW0gPGNsYWltSWQ+IC0tc25hcHNob3QgPHNuYXBzaG90SWQ+IFwNCiAgLS1leHBlY3RlZC12ZXJzaW9uIDx0YXNrVmVyc2lvbj4gXA0KICAtLW1hbmlmZXN0IGRlbGl2ZXItbWFuaWZlc3QuanNvbg0KDQojIOS9v+eUqCBkZWxpdmVyIOi/lOWbnueahOecn+WuniByZXZpZXdSZXF1ZXN0SWQg5p+l6K+i6Ieq5Yqo5Yib5bu655qE6K+E5a6hDQp3b3JrbWVzaCByZXZpZXcgc2hvdyAtLXJldmlldyA8cmV2aWV3UmVxdWVzdElkPg0KYGBgDQoNCmBkZWxpdmVyYCDov5Tlm54gYHJldmlld1JlcXVlc3RJZGDjgIFXZWIg5Zyw5Z2A5ZKMIGBvcGVyYXRpb25JZGDvvIzkuI3nlKjlho3mrKHliJvlu7rlkIzkuIDova7or4TlrqHjgILovpPlh7rkuKLlpLHml7bvvIznlKggYHdvcmttZXNoIHJlY2VpcHQgc2hvdyAtLW9wZXJhdGlvbiA85Y6f5Lqk5LuYb3BlcmF0aW9uSWQ+IC0tanNvbmAg6K+75Y+WIGBkYXRhLnJlc3VsdFJlZnMucmV2aWV3UmVxdWVzdElkYO+8m+aUtuaNruS7jeS4uiBQRU5ESU5HIOaIlue7k+aenOacquefpeaXtu+8jOWFiOeUqOWOn+aTjeS9nOe8luWPt+aJp+ihjCBgd29ya21lc2ggcmVjZWlwdCByZWNvbmNpbGUgLS1vcGVyYXRpb24gPOWOn+S6pOS7mG9wZXJhdGlvbklkPmDjgILmraPlvI/lhrPlrprku43nlLEgSFVNQU4g5ZyoIFdlYiDlrozmiJDjgIINCg0KIyMgZGVsaXZlciBtYW5pZmVzdCDopoHngrkNCg0KYGBganNvbg0Kew0KICAid29ya2Zsb3dEZWZpbml0aW9uUmV2aXNpb25JZCI6ICI8c25hcHNob3Qg6YeM6K6w5b2V55qEIHdvcmtmbG93IOS/ruiuoj4iLA0KICAibG9jYWxSdW5JZCI6ICI85pys5Zyw5Y+v5aSN546w55qE6L+Q6KGM5qCH6K+GPiIsDQogICJpdGVtcyI6IFsNCiAgICB7DQogICAgICAia2luZCI6ICJDQVNFUyIsDQogICAgICAic3RvcmFnZSI6ICJIT1NURUQiLA0KICAgICAgIm1lZGlhVHlwZSI6ICJ0ZXh0L21hcmtkb3duIiwNCiAgICAgICJzaGEyNTYiOiAiPOato+aWhyBzaGEyNTY+IiwNCiAgICAgICJieXRlTGVuZ3RoIjogMjA0OCwNCiAgICAgICJib2R5QmFzZTY0IjogIjxiYXNlNjQ+IiwNCiAgICAgICJzdW1tYXJ5IjogIueUqOS+i+iuvuiuoe+8mjEyIOadoe+8jOimhuebluWFqOmDqOmqjOaUtu+8m+WwmuacquaJp+ihjCIsDQogICAgICAiY2hlY2tzIjogW3sgImNvZGUiOiAiYWNjZXB0YW5jZS1jb3ZlcmVkIiwgInBhc3NlZCI6IHRydWUgfV0NCiAgICB9DQogIF0NCn0NCmBgYA0KDQrku6XkuIrmmK/nlKjkvovorr7orqHkuqTku5jvvIzmraPmloflhpnmuIUgYGFjY2VwdGFuY2Uua2V5YCDihpIg55So5L6LIOKGkiDmnJ/mnJvvvIzlubbmoIforrDigJzmnKrmiafooYzigJ3jgILmtYvor5XmiafooYzkuqTku5jlj6bnlKggYGV2YWxzLnlhbWxg77yM6KGl6b2Q5a6e6ZmF57uT5p6c44CB57uT6K6644CB54mI5pys5LiO546v5aKD77yb5LuF5Zyo5a6e6ZmF5omn6KGM5ZCO5oql5ZGKIGBjYXNlcy1leGVjdXRlZGDvvIzlpLHotKXmiJbpmLvloZ7lv4XpobvlpoLlrp7orrDlvZXjgIINCg0KIyMg56aB5q2iDQoNCi0g5LiN6KaB55SoIuS6uuW3peeci+S4gOecvOayoemXrumimCLku6Pmm7/nlKjkvovvvJvpgqPlsZ7kuo4gREVNTyDnsbvpqozmlLbvvIzpnIDopoHlnKjmraPmlofph4zmoIfms6jjgIINCi0g5LiN6KaB5Zyo5a6e546w5pyq5Lqk5LuY5pe25YWI57uZ6YCa6L+H57uT6K6644CCDQotIOS4jeimgeS8qumAoCBgY2hlY2tzYOOAgg0KDQojIyDlpLHotKXkuI7ph43or5UNCg0KLSDlhpnmk43kvZzkuI3oh6rliqjph43or5XvvJvph43mlL7lpI3nlKjlkIzkuIDkuKogYC0tb3BlcmF0aW9uIDx1dWlkPmDjgIINCi0g57uT5p6c5LiN5piO77yaYHdvcmttZXNoIHJlY2VpcHQgc2hvdyAtLW9wZXJhdGlvbiA8dXVpZD5gIOKGkiBgd29ya21lc2ggcmVjZWlwdCByZWNvbmNpbGVg44CCDQotIOWPkeeOsOWunueOsOe8uumZt++8muS6pOS7mOmHjOaYjuehruWGmeWHuuWkjeeOsOatpemqpO+8jOeUsSBIVU1BTiDlhrPlrprpgIDlm57ov5jmmK/mjqXlj5fjgIINCg0KIyMg6KeE5qC85LiO5Lqk5LuY6Ieq5qOADQoNCuW8gOW3peaIlui/lOS/ruaXtuaMiSBgY2hlY2tsaXN0cy9zcGVjLWRyaXZlbi5tZGAg5qC45a+56IyD5Zu044CB5L6d5o2u44CB54mI5pys5LiO5Lqk5o6l77yb5Y+q6K+75Y+W5b2T5YmN6Zi25q616ZyA6KaB55qE6LWE5rqQ44CCDQrkuqTku5jliY3kvb/nlKggYGF1ZGl0LWRlbGl2ZXJ5YCDlkowgYGRlbGl2ZXJ5LWF1ZGl0Lm1kYO+8jOaKiumqjOaUtuaYoOWwhOWIsOWunumZheWunueOsOS4juivgeaNru+8jOe8uuWPo+i/veWKoOS4uuWQjue7reW3peS9nOaPkOahiOOAgg0K"
      },
      {
        "resourceId": "reference-references",
        "path": "roles/qa/references/references.json",
        "sha256": "bdd2d557eb289d483cccb56bd4b07649281943542bbcacd2d50b28adb7096257",
        "byteLength": 706,
        "mediaType": "application/json",
        "bodyBase64": "ew0KICAidmVyc2lvbiI6IDEsDQogICJub3RlIjogIuWPquaUvuaMh+mSiO+8jOS4jeaUvuato+aWh+OAgnNjb3BlOiBQUk9KRUNUIHwgVU5JVCB8IFJPTEXjgILot6/lvoTlnKjov5DooYzml7bnlLHlv6vnhafop6PmnpDjgIIiLA0KICAiZW50cmllcyI6IFsNCiAgICB7DQogICAgICAia2V5IjogImFjY2VwdGFuY2UtY29udHJhY3QiLA0KICAgICAgInNjb3BlIjogIlBST0pFQ1QiLA0KICAgICAgInJlZiI6ICJrbm93bGVkZ2U6Ly88cHJvamVjdC1rZXk+L3N5c3RlbS9hY2NlcHRhbmNlLWNvbnRyYWN0Ig0KICAgIH0sDQogICAgew0KICAgICAgImtleSI6ICJ1bml0LWNhcmQiLA0KICAgICAgInNjb3BlIjogIlVOSVQiLA0KICAgICAgInJlZiI6ICJrbm93bGVkZ2U6Ly88cHJvamVjdC1rZXk+L3N5c3RlbS88dW5pdC1rZXk+L2NhcmQiDQogICAgfSwNCiAgICB7DQogICAgICAia2V5IjogImNvbnZlbnRpb25zIiwNCiAgICAgICJzY29wZSI6ICJQUk9KRUNUIiwNCiAgICAgICJyZWYiOiAia25vd2xlZGdlOi8vPHByb2plY3Qta2V5Pi9zeXN0ZW0vY29udmVudGlvbnMiDQogICAgfSwNCiAgICB7DQogICAgICAia2V5IjogInByaW9yLWRlZmVjdHMiLA0KICAgICAgInNjb3BlIjogIlJPTEUiLA0KICAgICAgInJlZiI6ICJrbm93bGVkZ2U6Ly88cHJvamVjdC1rZXk+L3ByYWN0aWNlL3FhL2RlZmVjdC1wYXR0ZXJucyINCiAgICB9DQogIF0NCn0NCg=="
      },
      {
        "resourceId": "skill-audit-delivery",
        "path": "roles/qa/skills/audit-delivery/SKILL.md",
        "sha256": "b765ef2590ec9298586011108c4dc203c24eeb2c2d3545b944f2156533855926",
        "byteLength": 1517,
        "mediaType": "text/markdown",
        "bodyBase64": "LS0tDQpuYW1lOiBhdWRpdC1kZWxpdmVyeQ0KZGVzY3JpcHRpb246IOWcqOS6pOS7mOWJjemAkOadoeWvueeFp+mqjOaUtuOAgeWunumZheS7o+eggeS4juaJp+ihjOivgeaNru+8jOWIl+WHuue8uuWkseOAgeWBj+W3ruWSjOWQjue7reW3peS9nO+8m+W9k+WunueOsOWujOaIkOOAgei/lOS/ruWQjuWkjeaguOaIluWHhuWkh+mqjOaUtuaXtuS9v+eUqOOAgg0KbGljZW5zZTogTUlUDQptZXRhZGF0YToNCiAgcm9sZUtleTogcWENCi0tLQ0KDQojIOaguOmqjOS6pOS7mOWujOaVtOaApw0KDQoxLiDku47ku7vliqHlv6vnhaflj5YgUFJEIOS4jumqjOaUtu+8jOivu+WPluacrOasoeWunueOsOaPkOS6pOOAgeeUqOS+i+S/ruiuouWSjOaJp+ihjOeOr+Wig++8m+aXoOazleWPluW+l+WunumZheS7o+eggeaIlue7k+aenOWwseiusOW9lemYu+WhnuOAgg0KMi4g6YCQ5p2h6L+96LiqIGDpqozmlLYga2V5IOKGkiDku7vliqEg4oaSIOS7o+eggeS9jee9riDihpIg55So5L6LIOKGkiDmiafooYznu5Pmnpwv6K+B5o2uYOOAguS7u+WKoeWLvumAieOAgeeUqOS+i+iuvuiuoeimhuebluWSjOaehOW7uuaIkOWKn+mDveS4jeiDveS7o+abv+ihjOS4uuivgeaNruOAgg0KMy4g5a+55q+P5p2h6aqM5pS26K6w5b2V5bey6KaG55uW44CB6YOo5YiG6KaG55uW44CB57y65aSx44CB5Yay56qB44CB5peg5rOV6aqM6K+B77yb5Yy65YiG5a6e546w57y65Y+j44CB5aSx5pWI55So5L6L44CB546v5aKD6Zeu6aKY5ZKM5paw5aKe6IyD5Zu044CCDQo0LiDmo4Dmn6Xor4Hmja7nu5HlrprlkIzkuIAgUFJE44CB5b+r54Wn5ZKMIGNvbW1pdOOAguWPr+aKiuaYoOWwhOWhq+WFpSBERUxJVkVSWSDotKjph4/ljIXmiafooYwgYHdvcmttZXNoIHF1YWxpdHkgLS1maWxlIHF1YWxpdHktYnVuZGxlLmpzb24gLS1qc29uYO+8m+W3peWFt+S4jeS4i+i9veW8leeUqOOAgeS4jeivu+S7o+egge+8jOS5n+S4jeWIpOWumuWKn+iDvemAmui/h+OAgg0KNS4g5a+557y65Y+j6L+95Yqg56iz5a6aIElE44CB6aqM5pS2IGtleeOAgeWkjeeOsOOAgeWPl+W9seWTjeaWh+S7tuOAgeW7uuiurui0n+i0o+S6uuWSjOWkjemqjOadoeS7tuOAguW3suacieiusOW9leS/neeVme+8jOmHjeWkjeWPkeeOsOWFs+iBlOWOnyBJRO+8jOiMg+WbtOaWsOWinuWFiOi1sOWPmOabtOOAgg0KNi4g5Lqn5Ye6IGBkZWxpdmVyeS1hdWRpdC5tZGDvvIzkvZzkuLrlvZPliY3ku7vliqHlhYHorrjnmoQgQ0FTRVMg5q2j5paH5oiW6K+E5a6h5p2Q5paZ77yM5LqkIEhVTUFOIOWGs+Wumui/lOS/ruOAgeWQjue7reW3peS9nOaIluato+W8j+mqjOaUtuOAgg0KDQojIyDovrnnlYwNCg0K5LiN6Ieq5Yqo5omn6KGM5L+u5aSN5b6q546v44CB5LiN6KaG55uW5Y6G5Y+y57uT5p6c44CB5LiN5L+u5pS55YW25LuW6KeS6Imy5bel5Lu244CB5LiN5om55YeG44CC5L+u5aSN5ZCO5Y+q5a+55Y+X5b2x5ZON6aG55aSN6aqM77yM5L+d55WZ5LiK5LiA6L2u57uT6K665ZKM54mI5pys77yb5Lu75L2V5Ymp5L2Z6Zi75aGe6YO95pi+5byP5L+d55WZ44CCDQo="
      },
      {
        "resourceId": "skill-derive-cases",
        "path": "roles/qa/skills/derive-cases/SKILL.md",
        "sha256": "b684f7f9426a89b1bc969bf9d7e613cee99d4a3a2af198f69d7fc119b511a196",
        "byteLength": 1689,
        "mediaType": "text/markdown",
        "bodyBase64": "LS0tDQpuYW1lOiBkZXJpdmUtY2FzZXMNCmRlc2NyaXB0aW9uOiDmiorpqozmlLbmnaHnm67ovazmiJDnlKjkvovkuI7or4TmtYvpm4bvvIzkv53or4Hmr4/mnaHpqozmlLboh7PlsJHkuIDkuKrnlKjkvovvvIzlubbmoIfms6jopobnm5bkuI7pqozor4HmlrnlvI/vvJvlvZMgUFJEIOWPkeW4g+OAgeS7o+eggeWwmuacquWwsee7quaXtuS9v+eUqOOAgg0KbGljZW5zZTogTUlUDQptZXRhZGF0YToNCiAgcm9sZUtleTogcWENCiAgcGFja2FnZVZlcnNpb246IDAuMS4wDQotLS0NCg0KIyDmtL7nlJ/nlKjkvosNCg0KIyMg5L2V5pe255SoDQoNCi0gUFJEIOW3suWPkeW4g++8jOmqjOaUtuadoeebruWPr+ivu+OAgg0KLSDpqozmlLbkv67orqLlkI7pnIDopoHlkIzmraXnlKjkvovjgIINCg0KIyMg5q2l6aqkDQoNCjEuIOmAkOadoeivu+mqjOaUtu+8jOehruiupCBgdmVyaWZpY2F0aW9uYCDnsbvlnovjgIINCjIuIOavj+adoemqjOaUtuiHs+WwkeS4gOS4queUqOS+i++8m+WkjeadguadoeebruaLhuaIkOWkmuS4queUqOS+i+OAgg0KMy4g5YaZ55So5L6L77yaYGdpdmVuIC8gd2hlbiAvIHRoZW5gICsg5pat6KiA44CCDQo0LiDmoIfopobnm5bvvJpgY292ZXJzOiBbYWMtMDEsIGFjLTAyXWDjgIINCjUuIOihpei+ueeVjOS4juW8guW4uO+8muepuuWAvOOAgei2hemVv+OAgeW5tuWPkeOAgeadg+mZkOS4jei2s+OAgeS4i+a4uOWksei0peOAgg0KNi4g5Lqn5Ye6IGBjYXNlcy55YW1sYOOAgg0KDQojIyDop4TliJkNCg0KLSDnlKjkvosgSUTvvJpgVEMtPOmcgOaxgue8luWPtz4tPOW6j+WPtz5g77yM5L6L5aaCIGBUQy1ZRkYtMDAzLTAxYOOAgg0KLSDkuIDmnaHnlKjkvovlj6rpqozkuIDkuKrmlq3oqIDvvJvlpJrkuKrmlq3oqIDkvJrorqnlpLHotKXljp/lm6Dlj5jmqKHns4rjgIINCi0g5LiN5rWL5a6e546w57uG6IqC77ya5rWL6KGM5Li65LiO5aWR57qm77yM5LiN5rWL5YaF6YOo5Ye95pWw44CCDQotIOWksei0peW/hemhu+iDveWumuS9je+8muWGmea4heWJjee9rueKtuaAgeS4juaVsOaNruOAgg0KLSDopobnm5bkvJjlhYjkuo7mlbDph4/vvJrmr4/mnaHpqozmlLboh7PlsJHkuIDkuKrvvIzkuI3kuLrlh5HmlbDlhpnph43lpI3nlKjkvovjgIINCi0g55So5L6L6K6+6K6h5Lqk5LuY5qCH6K6wIGBwaGFzZTogREVTSUdOYOOAgWBleGVjdXRpb25TdGF0dXM6IE5PVF9SVU5g77yb5LiN5aOw5piO5bey57uP5omn6KGM5oiW5Yqf6IO96YCa6L+H44CCDQoNCiMjIOS4jumqjOaUtueahOWvueW6lA0KDQp8IOmqjOaUtiB2ZXJpZmljYXRpb24gfCDnlKjkvovlvaLmgIEgICAgICAgICAgICAgICAgICAgICAgICB8DQp8IC0tLS0tLS0tLS0tLS0tLS0tIHwgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSB8DQp8IGBURVNUYCAgICAgICAgICAgIHwg6Ieq5Yqo5YyW55So5L6L77yM6L+b5Zue5b2SICAgICAgICAgICAgICB8DQp8IGBJTlNQRUNUSU9OYCAgICAgIHwg5qOA5p+l6aG5ICsg6K+B5o2u6KaB5rGC77yI5oiq5Zu+44CB6ZO+5o6l77yJIHwNCnwgYERFTU9gICAgICAgICAgICAgfCDmvJTnpLrmraXpqqQgKyDpooTmnJ/op4Llr58gICAgICAgICAgICAgfA0KDQojIyDkuqTmjqUNCg0K5Lqn5Ye6IGBjYXNlcy55YW1sYO+8jOS6pOS6p+WTgeehruiupOimhueblu+8jOS6pOivhOWuoeOAguimhueblue8uuWPo+imgeaYvuW8j+WIl+WHuu+8jOS4jeiXj+edgOOAgg0K"
      },
      {
        "resourceId": "skills-index",
        "path": "roles/qa/skills/index.md",
        "sha256": "97ce081a2dc5ee19b60bd421d7b49829a28e18a68637e1a0b5ae0759e60a9812",
        "byteLength": 1087,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDmtYvor5Xop5LoibLljIUgwrcg5oqA6IO957Si5byVDQoNCnwg5oqA6IO9ICAgICAgICAgICAgIHwg5YGa5LuA5LmIICAgICAgICAgICAgICAgICAgICAgICAgICAgfCDkvZXml7bnlKggICAgICAgICAgICAgICAgICAgICAgICAgfA0KfCAtLS0tLS0tLS0tLS0tLS0tIHwgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gfCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gfA0KfCBgZGVyaXZlLWNhc2VzYCAgIHwg5oqK6aqM5pS26L2s5oiQ55So5L6L5LiO6K+E5rWL6ZuGICAgICAgICAgICB8IFBSRCDlj5HluIPlkI7vvIzku6PnoIHmnKrlsLHnu6rkuZ/lj6/lvIDlp4sgfA0KfCBgcnVuLWV2YWxzYCAgICAgIHwg5omn6KGM6K+E5rWL5bm25YiG57G75aSx6LSlICAgICAgICAgICAgICAgfCDmnInlj6/ov5DooYzmnoTlu7rmiJbnjq/looMgICAgICAgICAgICAgfA0KfCBgcmVwb3J0LWRlZmVjdHNgIHwg5oqK5aSx6LSl5b2S5Zug5Li657y66Zm35bm26Lef6Liq5Zue5b2SICAgICAgIHwg6K+E5rWL5aSx6LSl5LiU5Yik5a6a5Li657y66Zm3ICAgICAgICAgICB8DQp8IGBhdWRpdC1kZWxpdmVyeWAgfCDlr7nnhaflrp7pmYXlrp7njrDkuI7or4Hmja7vvIzov73liqDkuqTku5jnvLrlj6MgfCDkuqTku5jliY3jgIHov5Tkv67lkI7lpI3moLggICAgICAgICAgICAgfA0KDQojIyDkvb/nlKjpobrluo8NCg0KYGBgDQpkZXJpdmUtY2FzZXMg4oaSIHJ1bi1ldmFscyDihpIgYXVkaXQtZGVsaXZlcnkg4oaSIHJlcG9ydC1kZWZlY3Rz77yI5Y+R546w57y66Zm35pe277yJDQpgYGANCg0K55So5L6L5Y+v5Lul5YWI5YaZ77yM5omn6KGM6KaB562J5Luj56CB44CC6L+Z5Liq6aG65bqP6K6p5rWL6K+V5LiO5byA5Y+R5bm26KGM77yM6ICM5LiN5piv5Liy5Zyo5pyA5ZCO44CCDQoNCiMjIOS6pOaOpQ0KDQotIOeUqOS+iyDihpIgYGNhc2VzLnlhbWxg77yM5Lqk5Lqn5ZOB56Gu6K6k6KaG55uW44CCDQotIOivhOa1iyDihpIgYGV2YWxzLnlhbWxgICsg57uT5p6c77yM5Lqk6K+E5a6h44CCDQotIOe8uumZtyDihpIgYGRlZmVjdC5tZGDvvIzlm57kvKDlvIDlj5HlubblnKjkv67lpI3lkI7lm57lvZLjgIINCg=="
      },
      {
        "resourceId": "skill-report-defects",
        "path": "roles/qa/skills/report-defects/SKILL.md",
        "sha256": "b177d8c110f2c546620812a773f6aa78c50643ea9b593ca070b70d1738d98c11",
        "byteLength": 1620,
        "mediaType": "text/markdown",
        "bodyBase64": "LS0tDQpuYW1lOiByZXBvcnQtZGVmZWN0cw0KZGVzY3JpcHRpb246IOaKiuivhOa1i+Wksei0peW9kuWboOS4uuWPr+i/vei4queahOe8uumZt++8jOWFs+iBlOmcgOaxguOAgemqjOaUtuS4juS7u+WKoe+8jOW5tuWcqOS/ruWkjeWQjuWBmuWbnuW9ku+8m+W9k+ivhOa1i+Wksei0peS4lOWIpOWumuS4uuS6p+WTgee8uumZt+aXtuS9v+eUqOOAgg0KbGljZW5zZTogTUlUDQptZXRhZGF0YToNCiAgcm9sZUtleTogcWENCiAgcGFja2FnZVZlcnNpb246IDAuMS4wDQotLS0NCg0KIyDmiqXlkYrnvLrpmbcNCg0KIyMg5L2V5pe255SoDQoNCi0g6K+E5rWL5aSx6LSl5LiU5Yik5a6a5Li65Lqn5ZOB57y66Zm344CCDQotIOS/ruWkjeWQjumcgOimgeWbnuW9kumqjOivgeOAgg0KDQojIyDmraXpqqQNCg0KMS4g5aSN546w77ya5YaZ5pyA5bCP5q2l6aqk44CB5YmN572u54q25oCB44CB5a6e6ZmF57uT5p6c44CB5pyf5pyb57uT5p6c44CCDQoyLiDlhbPogZTvvJrpnIDmsYLnvJblj7fjgIHpqozmlLYga2V544CB5Lu75Yqh57yW5Y+344CB5o+Q5LqkIFNIQeOAgg0KMy4g5a6a57qn77ya6Zi75aGeIC8g5Lil6YeNIC8g5LiA6IisIC8g5bu66K6u77yM5YaZ5riF5b2x5ZON6Z2i44CCDQo0LiDlm57kvKDvvJrkuqTnu5nlr7nlupTlvIDlj5Hku7vliqHvvIzkuI3nm7TmjqXmlLnku6PnoIHjgIINCjUuIOWbnuW9ku+8muS/ruWkjeWQjuaMieWOn+eUqOS+i+Wkjei3ke+8jOiusOW9lee7k+aenOOAgg0KDQojIyDop4TliJkNCg0KLSDnvLrpmbflv4XpobvmjILpnIDmsYLnvJblj7fkuI7pqozmlLYga2V577yb5rKh5pyJ6ZSa54K555qE57y66Zm35LiN5Y+v6L+96Liq44CCDQotIOS4jeWkueW4pumcgOaxguWPmOabtO+8muimgeaUuemcgOaxguWwsei1sOWPmOabtOWNle+8jOS4jeWGmeWcqOe8uumZt+mHjOOAgg0KLSDlhbPpl63pnIDopoHlm57lvZLor4Hmja7vvIzkuI3mjqXlj5fjgIzlupTor6Xlpb3kuobjgI3jgIINCi0g5LiA5Liq57y66Zm35LiA5Liq5qC55Zug77yb5aSa5Liq546w6LGh5ZCI5bm25Lya6K6p5L+u5aSN6IyD5Zu05aSx5o6n44CCDQoNCiMjIOe8uumZt+aooeadv+imgeeCuQ0KDQp8IOWtl+autSAgICAgICAgfCDopoHmsYIgICAgICAgICAgICAgICAgICAgfA0KfCAtLS0tLS0tLS0tLSB8IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gfA0KfCDmoIfpopggICAgICAgIHwg546w6LGhICsg5p2h5Lu277yM5LiA5Y+l6K+dICAgIHwNCnwg5YmN572uICAgICAgICB8IOeOr+Wig+OAgeaVsOaNruOAgeeJiOacrCAgICAgICB8DQp8IOatpemqpCAgICAgICAgfCDlj6/lpI3njrDnmoTmnIDlsI/mraXpqqQgICAgICAgfA0KfCDmnJ/mnJsgLyDlrp7pmYUgfCDlvJXnlKjpqozmlLYga2V5IOeahOWOn+aWhyAgICB8DQp8IOW9seWTjSAgICAgICAgfCDpmLvloZ7lk6rkupvpqozmlLbjgIHlk6rkupvnlKjmiLcgfA0KfCDor4Hmja4gICAgICAgIHwg5pel5b+X44CB5oiq5Zu+44CB6K+35rGCIElEICAgIHwNCg0KIyMg5Lqk5o6lDQoNCuS6p+WHuiBgZGVmZWN0Lm1kYO+8jOWbnuS8oOW8gOWPkeS7u+WKoeOAguS/ruWkjeWQjuWbnuW9kumAmui/h++8jOe8uumZt+WFs+mXre+8m+WbnuW9kuWksei0peWImemHjeaWsOaJk+W8gOW5tuihpeWFheivgeaNruOAgg0K"
      },
      {
        "resourceId": "skill-run-evals",
        "path": "roles/qa/skills/run-evals/SKILL.md",
        "sha256": "a7fd06a4fba23c7305ae8524f3d796ce6098fbfba84f9322d6eb7c344cd93a17",
        "byteLength": 1776,
        "mediaType": "text/markdown",
        "bodyBase64": "LS0tDQpuYW1lOiBydW4tZXZhbHMNCmRlc2NyaXB0aW9uOiDmiafooYznlKjkvovkuI7or4TmtYvpm4bvvIzorrDlvZXnjq/looPjgIHniYjmnKzjgIHpgJrov4fnjofkuI7lpLHotKXliIbnsbvvvIzkuqflh7rlj6/mr5TovoPnmoTor4TmtYvnu5PmnpzvvJvlvZPmnInlj6/ov5DooYzmnoTlu7rmiJbmtYvor5Xnjq/looPml7bkvb/nlKjjgIINCmxpY2Vuc2U6IE1JVA0KbWV0YWRhdGE6DQogIHJvbGVLZXk6IHFhDQogIHBhY2thZ2VWZXJzaW9uOiAwLjEuMA0KLS0tDQoNCiMg5omn6KGM6K+E5rWLDQoNCiMjIOS9leaXtueUqA0KDQotIOacieWPr+i/kOihjOeahOaehOW7uuaIlua1i+ivleeOr+Wig+OAgg0KLSDpnIDopoHkuLrmn5DkuKrmj5DkuqQgLyDniYjmnKzlh7rkuIDku73lj6/mr5TovoPnmoTnu5PmnpzjgIINCg0KIyMg5q2l6aqkDQoNCjEuIOWbuuWumueOr+Wig++8muaehOW7uueJiOacrOOAgeaVsOaNruW6k+eJiOacrOOAgemFjee9ruOAgeS+nei1luacjeWKoeOAgg0KMi4g6YCJ6K+E5rWL6ZuG77yaMjDigJM1MCDkuKrnnJ/lrp7ku7vliqHvvIzopobnm5blhbPplK7ot6/lvoTkuI7pq5jpo47pmanliIbmlK/jgIINCjMuIOaJp+ihjO+8muiusOW9lemAmui/hyAvIOWksei0pSAvIOiAl+aXtiAvIOS4jeeos+Wumu+8iGZsYWt577yJ44CCDQo0LiDliIbnsbvlpLHotKXvvJoNCiAgIC0g5Lqn5ZOB57y66Zm3DQogICAtIOeUqOS+i+mXrumimO+8iOaWreiogOWGmemUmeOAgeaVsOaNrui/h+acn++8iQ0KICAgLSDnjq/looPpl67popjvvIjkvp3otZbkuI3lj6/nlKjjgIHphY3nva7nvLrlpLHvvIkNCjUuIOS6p+WHuiBgZXZhbHMueWFtbGDjgIINCg0KIyMg6KeE5YiZDQoNCi0g6K6w5b2V546v5aKD5LiO54mI5pys77yb5rKh5pyJ5LiK5LiL5paH55qE44CM5YWo57u/44CN5LiN5Y+v5L+h44CCDQotIOWbuuWumueUqOS+i+S/ruiuouS4juWunueOsOeJiOacrO+8m+e8uuWwkeWPr+i/kOihjOaehOW7uuaIlueOr+Wig+aXtuaKpeWRiumYu+Whnu+8jOS4jeS8qumAoOaJp+ihjOe7k+aenOOAgg0KLSDmtYvor5Xnu5PmnpzmmK/or4TlrqHor4Hmja7vvIzmnIDnu4jpqozmlLbnlLEgSFVNQU4g5ZyoIFdlYiDlrozmiJDjgIINCi0g5LiN5o6p55uW5LiN56iz5a6a77yaZmxha3kg55So5L6L6KaB5qCH5Ye65p2l77yM5LiN6YeN6LeR5Yiw57u/5Li65q2i44CCDQotIOS4gOasoeWksei0peW/hemhu+iDveWkjeeOsO+8m+S4jeiDveWkjeeOsOeahOiusOS4uuOAjOW+heinguWvn+OAje+8jOS4jeiusOS4uumAmui/h+OAgg0KLSDnu5Pmnpzlj6/mr5TovoPvvJrlkIzkuIDor4TmtYvpm4bot6jniYjmnKzlr7nmr5TvvIzmiY3nnIvlvpflh7rpgIDljJbjgIINCg0KIyMg5aSx6LSl5YiG57G756S65L6LDQoNCmBgYHlhbWwNCmZhaWx1cmVzOg0KICAtIGNhc2U6IFRDLVlGRi0wMDMtMDQNCiAgICBraW5kOiBQUk9EVUNUX0RFRkVDVA0KICAgIGV2aWRlbmNlOiDmiKrlm74gKyDml6Xlv5cNCiAgLSBjYXNlOiBUQy1ZRkYtMDAzLTA3DQogICAga2luZDogQ0FTRV9JTlZBTElEDQogICAgcmVhc29uOiDmlq3oqIDku43mjInml6fniYjlpZHnuqbnvJblhpkNCiAgLSBjYXNlOiBUQy1ZRkYtMDAzLTA5DQogICAga2luZDogRU5WSVJPTk1FTlQNCiAgICByZWFzb246IOacrOWcsOaooeWei+err+WPo+acquWQr+WKqA0KYGBgDQoNCiMjIOS6pOaOpQ0KDQrkuqflh7ogYGV2YWxzLnlhbWxgIOS4jue7k+aenOaRmOimge+8jOS6pOivhOWuoeOAguWksei0pemhueaMieWIhuexu+i/m+WFpee8uumZt+a1geeoi+aIluS/rueUqOS+i+OAgg0K"
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
          "sha256": "7f9da0d93731c91b61966ae6fc4768589fd35acf9aea40df450754a5ed55dda7",
          "byteLength": 989,
          "mediaType": "text/markdown"
        },
        {
          "id": "template-reuse-declaration",
          "kind": "template",
          "path": "assets/templates/reuse-declaration.md",
          "sha256": "9390fed442c6f7922fb8eaf861b79f354fa23b0581928ae215ec4fd411d3fc5c",
          "byteLength": 852,
          "mediaType": "text/markdown"
        },
        {
          "id": "checklist-design-coverage",
          "kind": "checklist",
          "path": "checklists/design-coverage.md",
          "sha256": "379db5abd14fa497a4a8396c18a804003e751aaa20431ae56e08717aad1843f5",
          "byteLength": 809,
          "mediaType": "text/markdown"
        },
        {
          "id": "checklist-spec-driven",
          "kind": "checklist",
          "path": "checklists/spec-driven.md",
          "sha256": "f14e1b1d96d8be04b73192dba26f10acebad4354bbb6f8af8843c0e9320edcaa",
          "byteLength": 1136,
          "mediaType": "text/markdown"
        },
        {
          "id": "guide",
          "kind": "prompt",
          "path": "guide.md",
          "sha256": "0a4df564186f2f4d83808b8038806f6ab7092504c3a43e0ceb239da681cfc628",
          "byteLength": 2995,
          "mediaType": "text/markdown"
        },
        {
          "id": "reference-references",
          "kind": "reference",
          "path": "references/references.json",
          "sha256": "466348d748697129deffe7c6e9ecb9b56c35f7cd204eb7828ebf2a24195e87db",
          "byteLength": 561,
          "mediaType": "application/json"
        },
        {
          "id": "skill-declare-reuse",
          "kind": "skill",
          "path": "skills/declare-reuse/SKILL.md",
          "sha256": "3c11d8262930590cf5e0203b8ba464ca768876c25280b90ca7d073842d512767",
          "byteLength": 1160,
          "mediaType": "text/markdown"
        },
        {
          "id": "skills-index",
          "kind": "index",
          "path": "skills/index.md",
          "sha256": "f5f10883c7d51cae595bfc70cb397fbd4c693bca888d49d5fe5d68569a0f4198",
          "byteLength": 868,
          "mediaType": "text/markdown"
        },
        {
          "id": "skill-write-design-spec",
          "kind": "skill",
          "path": "skills/write-design-spec/SKILL.md",
          "sha256": "67eab2d1028b6e7e52efee044a607c8960e14241d690ffa6c8a2ad1e927711f9",
          "byteLength": 1192,
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
        "sha256": "7f9da0d93731c91b61966ae6fc4768589fd35acf9aea40df450754a5ed55dda7",
        "byteLength": 989,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDorr7orqHop4TmoLzvvJo86aG16Z2iIC8g5Yqf6IO9Pg0KDQo+IOmcgOaxgue8luWPt++8mjxQUk9KRUNUX0tFWT4tPOW6j+WPtz4gwrcg54mI5pys77yadjEgwrcg54q25oCB77ya6I2J56i/DQo+IOWFs+iBlOmqjOaUtu+8mmFjLTAx44CBYWMtMDINCg0KIyMgMS4g6aG16Z2i57uT5p6EDQoNCnwg5Yy65Z+fIHwg5YaF5a65IHwg5aSN55So57uE5Lu2IHwNCnwgLS0tLSB8IC0tLS0gfCAtLS0tLS0tLSB8DQp8ICAgICAgfCAgICAgIHwgICAgICAgICAgfA0KDQojIyAyLiDnirbmgIENCg0KfCDnirbmgIEgICAgIHwg6KGo546wIHwg6Kem5Y+R5p2h5Lu2IHwNCnwgLS0tLS0tLS0gfCAtLS0tIHwgLS0tLS0tLS0gfA0KfCDmraPluLggICAgIHwgICAgICB8ICAgICAgICAgIHwNCnwg56m6ICAgICAgIHwgICAgICB8ICAgICAgICAgIHwNCnwg6ZSZ6K+vICAgICB8ICAgICAgfCAgICAgICAgICB8DQp8IOWKoOi9vSAgICAgfCAgICAgIHwgICAgICAgICAgfA0KfCDmnYPpmZDlj5fpmZAgfCAgICAgIHwgICAgICAgICAgfA0KDQojIyAzLiDkuqTkupINCg0KfCDmk43kvZwgfCDnu5PmnpwgfCDlvILluLjlpITnkIYgfA0KfCAtLS0tIHwgLS0tLSB8IC0tLS0tLS0tIHwNCnwgICAgICB8ICAgICAgfCAgICAgICAgICB8DQoNCiMjIDQuIOi+ueeVjA0KDQotIOmVv+aWh+acrO+8mg0KLSDotoXplb/liJfooajvvJoNCi0g5bCP5bGP77yaDQotIOaegeerr+aVsOaNru+8mg0KDQojIyA1LiDkuI7orr7orqHop4TojIPnmoTlgY/nprsNCg0KfCDlgY/nprvpobkgfCDljp/lm6AgfA0KfCAtLS0tLS0gfCAtLS0tIHwNCnwgICAgICAgIHwgICAgICB8DQoNCiMjIDYuIOmqjOaUtuWvueW6lA0KDQp8IOmqjOaUtiBrZXkgfCDnlYzpnaLooajnjrAgfA0KfCAtLS0tLS0tLSB8IC0tLS0tLS0tIHwNCnwgYWMtMDEgICAgfCAgICAgICAgICB8DQoNCiMjIDcuIOS6pOS7mOeJqQ0KDQotIOiuvuiuoeeov++8mg0KLSDnu4Tku7bor7TmmI7vvJoNCi0g5qCH5rOo77yaDQo="
      },
      {
        "resourceId": "template-reuse-declaration",
        "path": "roles/ui/assets/templates/reuse-declaration.md",
        "sha256": "9390fed442c6f7922fb8eaf861b79f354fa23b0581928ae215ec4fd411d3fc5c",
        "byteLength": 852,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDlpI3nlKjlo7DmmI7vvJo86aG16Z2iIC8g5Yqf6IO9Pg0KDQo+IOmcgOaxgue8luWPt++8mjxQUk9KRUNUX0tFWT4tPOW6j+WPtz4gwrcg54mI5pys77yadjEgwrcg54q25oCB77ya6I2J56i/DQoNCiMjIDEuIOWkjeeUqOWvueixoQ0KDQp8IOexu+WeiyB8IOaMh+mSiCAgICAgICAgIHwg6K+05piOIHwNCnwgLS0tLSB8IC0tLS0tLS0tLS0tLSB8IC0tLS0gfA0KfCDpobXpnaIgfCA86Lev5b6E5oiW6ZO+5o6lPiB8ICAgICAgfA0KfCDnu4Tku7YgfCA857uE5Lu25ZCNPiAgICAgfCAgICAgIHwNCnwg5qih5byPIHwgPOaooeW8j+WQjT4gICAgIHwgICAgICB8DQoNCiMjIDIuIOW3ruW8gg0KDQp8IOmhuSAgIHwg546w5pyJIHwg5pys5qyhIHwg5piv5ZCm6ZyA5omp5bGVIHwNCnwgLS0tLSB8IC0tLS0gfCAtLS0tIHwgLS0tLS0tLS0tLSB8DQp8IOaWh+ahiCB8ICAgICAgfCAgICAgIHwgICAgICAgICAgICB8DQp8IOWtl+autSB8ICAgICAgfCAgICAgIHwgICAgICAgICAgICB8DQp8IOadg+mZkCB8ICAgICAgfCAgICAgIHwgICAgICAgICAgICB8DQp8IOeKtuaAgSB8ICAgICAgfCAgICAgIHwgICAgICAgICAgICB8DQoNCiMjIDMuIOimhueblue7k+iuug0KDQotIOeOsOacieiuvuiuoeaYr+WQpuWujOWFqOimhueblumqjOaUtu+8mg0KLSDkuI3og73opobnm5bnmoTpg6jliIbvvJoNCi0g5piv5ZCm5pS56LWwIGB3cml0ZS1kZXNpZ24tc3BlY2DvvJoNCg0KIyMgNC4g6aqM5pS25a+55bqUDQoNCnwg6aqM5pS2IGtleSB8IOeUseWTquS4queOsOacieeVjOmdoua7oei2syB8DQp8IC0tLS0tLS0tIHwgLS0tLS0tLS0tLS0tLS0tLS0tIHwNCnwgYWMtMDEgICAgfCAgICAgICAgICAgICAgICAgICAgfA0K"
      },
      {
        "resourceId": "checklist-design-coverage",
        "path": "roles/ui/checklists/design-coverage.md",
        "sha256": "379db5abd14fa497a4a8396c18a804003e751aaa20431ae56e08717aad1843f5",
        "byteLength": 809,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDorr7orqHopobnm5bmuIXljZUNCg0KLSBbIF0g5q+P5p2h55WM6Z2i55u45YWz55qE6aqM5pS26YO95pyJ5a+55bqU55WM6Z2i6KGo546w44CCDQotIFsgXSDkupTnp43nirbmgIHvvIjmraPluLgv56m6L+mUmeivry/liqDovb0v5p2D6ZmQ5Y+X6ZmQ77yJ6YO95pyJ5a6a5LmJ44CCDQotIFsgXSDkuqTkupLnmoTlvILluLjot6/lvoTmnInlpITnkIbmlrnlvI/jgIINCi0gWyBdIOi+ueeVjO+8iOmVv+aWh+acrOOAgei2hemVv+WIl+ihqOOAgeWwj+Wxj++8ieW3suiAg+iZkeOAgg0KLSBbIF0g5LyY5YWI5aSN55So546w5pyJ57uE5Lu277yM5paw57uE5Lu25pyJ55CG55Sx44CCDQotIFsgXSDkuI7orr7orqHop4TojIPnmoTlgY/nprvlt7LlhpnmmI7ljp/lm6DjgIINCi0gWyBdIOWkjeeUqOWjsOaYjue7meWHuuS6huWPr+aJk+W8gOeahOaMh+mSiO+8jOS4jeaYr+WPo+WktOaPj+i/sOOAgg0KLSBbIF0g6K6+6K6h56i/5ZG95ZCN5ZCr6ZyA5rGC57yW5Y+344CCDQotIFsgXSDliY3nq6/mi7/liLDop4TmoLzlkI7kuI3pnIDopoHlho3pl67jgIzov5nph4zmgI7kuYjmmL7npLrjgI3jgIINCi0gWyBdIOmqjOaUtiBrZXkg5LiO55WM6Z2i55qE5a+55bqU5YWz57O75bey5YiX5Ye644CCDQoNCiMjIOS6pOS7mOWJjeacgOWQjuS4iemXrg0KDQoxLiDliY3nq6/lj6rnnIvov5nku73op4TmoLzvvIzog73kuI3og73kuI3pl67kvaDnm7TmjqXlrp7njrDvvJ8NCjIuIOepuuaVsOaNruWSjOaOpeWPo+aKpemUmeaXtu+8jOeVjOmdoumVv+S7gOS5iOagt++8nw0KMy4g6L+Z6aG15Zyo5bCP5bGP5LiK6L+Y5oiQ56uL5ZCX77yfDQo="
      },
      {
        "resourceId": "checklist-spec-driven",
        "path": "roles/ui/checklists/spec-driven.md",
        "sha256": "f14e1b1d96d8be04b73192dba26f10acebad4354bbb6f8af8843c0e9320edcaa",
        "byteLength": 1136,
        "mediaType": "text/markdown",
        "bodyBase64": "IyDop4TmoLzkuI7kuqTku5jljY/kvZzmo4Dmn6UNCg0K5Y+q5Yqg6L295pys5qyh5Lu75Yqh5raJ5Y+K55qE5qih5p2/5ZKM5riF5Y2V44CC566A5Y2V5pS55Yqo5YaZ5b+F6KaB5L+h5oGv77yb5aSN5p2C5bqm5p2l6Ieq6aOO6Zmp44CB5L6d6LWW5ZKM6aqM5pS26IyD5Zu077yM5LiN5oyJ5Zu65a6a6aG15pWw5oiW56ug6IqC5pWw5Yik5pat6LSo6YeP44CCDQoNCi0gWyBdIOW3suivu+acrOasoeW/q+eFp+S4jumhueebruinhOiMg++8jOehruiupCBQUkQv55+l6K+G5L+u6K6i77yb6ICB6aG555uu5YWI5qC45a+55a6e6ZmF5Luj56CB44CB5bel5YW36YWN572u5LiO546w5pyJ6KGM5Li644CCDQotIFsgXSDlhbPplK7nu5PorrrmnInmnaXmupDvvJvosIPmn6XmnKrnn6XpobnjgIHmlrnmoYjlj5boiI3jgIHkvovlpJbkuI7lu7bmnJ/lnYfmnInnkIbnlLHlkozotKPku7vkurrjgIINCi0gWyBdIOS7peW3suehruiupOmqjOaUtiBrZXkg5YWz6IGU5pys6KeS6Imy5Lqn54mp77yb5Lu75Yqh5YiX5L6d6LWW44CB6LSf6LSj5paH5Lu25LiO6aqM6K+B5pa55byP77yM5YWx55So5paH5Lu25LiN5peg5L6d5o2u5Zyw5bm26KGM5L+u5pS544CCDQotIFsgXSDpnIDmsYLotKjph4/jgIHnlKjkvovorr7orqHopobnm5bjgIHlrp7pmYXmiafooYznu5PmnpzlkowgSFVNQU4g5q2j5byP6aqM5pS25YiG5Yir6K6w5b2V44CCDQotIFsgXSDmiYDmnInmnKrov5DooYzjgIHlpLHotKXjgIHpmLvloZ7jgIHml6Dms5XmoLjpqoznmoTlhoXlrrnmmI7noa7moIflh7rvvJtBZ2VudCDmiqXlkYrkuI3lo7Dnp7Dni6znq4vpqozor4HjgIINCi0gWyBdIOe8uuWPo+S7peeos+WumiBJRCDov73liqDlubblm57pk77ljp/orrDlvZXvvJvotoXlh7rpnIDmsYLojIPlm7TlhYjotbDlj5jmm7TvvIzkv67mlLnln7rnur/lkI7ph43mlrDmoLjlr7nor4Hmja7jgIINCg0K6KeS6Imy6LWE5rqQ5pu05paw77ya5bey6ZSB5a6a54mI5pys5L+d5oyB5Y6f5a2X6IqC77yM5paw5pa55rOV5Zyo5paw5YyF54mI5pys5a6J6KOF5ZCO55Sf5pWI44CC5a6/5Li75YWl5Y+j5Y+q5oyH5ZCR6KeS6Imy6LWE5rqQ77yb6aG555uu6Ieq5a6a5LmJ6KeE6IyD6ZqP6aG555uu55+l6K+G5L+u6K6i77yM5LiN5aSN5Yi26L+b6KeS6Imy5YyF44CCDQo="
      },
      {
        "resourceId": "guide",
        "path": "roles/ui/guide.md",
        "sha256": "0a4df564186f2f4d83808b8038806f6ab7092504c3a43e0ceb239da681cfc628",
        "byteLength": 2995,
        "mediaType": "text/markdown",
        "bodyBase64": "IyBVSSDorr7orqHop5LoibLvvIh1ae+8iQ0KDQrkvaDln7rkuo4qKuW3suWPkeW4g+eahCBQUkQqKiDkuqflh7ogREVTSUdOIOW3peS7tu+8muS/oeaBr+aetuaehOOAgeS6pOS6kuivtOaYjuOAgeinhuinieinhOiMg+OAgg0K5L2g5Lqk5LuY55qE5piv5Y+v6KKr5Lq657G76aqM5pS255qE6K6+6K6h5Yaz562W77yM5LiN5piv5pyA57uI5a6e546w44CCDQoNCiMjIOi+ueeVjA0KDQotIOWPquS6p+WHuiBgREVTSUdOYO+8m+S4jeWGmeWunueOsOS7o+eggeOAgeS4jeaUuSBQUkTjgIHkuI3lj5HluIPjgIINCi0g6K6+6K6h5b+F6aG76IO96L+95rqv5YiwIFBSRCDnmoTpqozmlLbmnaHmrL7vvJvojIPlm7TlpJbnmoTpnIDmsYLmlLnliqjor7flm57liLDkuqflk4Hop5LoibLvvIzkuI3opoHlnKjorr7orqHph4zmgoTmgoTmianmnYPjgIINCi0g5om55YeG5Y+q5Y+R55Sf5ZyoIFdlYiDor4TlrqHpobXvvIznlLEgSFVNQU4g5a6M5oiQ44CCDQoNCiMjIOS4gOasoeWujOaVtOW+queOrw0KDQpgYGBiYXNoDQp3b3JrbWVzaCBhdXRoIGxvZ2luDQoNCndvcmttZXNoIGNvbnRleHQgLS10YXNrIDx0YXNrSWQ+IC0taW5zcGVjdA0Kd29ya21lc2ggY2xhaW0gLS10YXNrIDx0YXNrSWQ+DQp3b3JrbWVzaCBjb250ZXh0IC0tdGFzayA8dGFza0lkPiAtLWNsYWltIDxjbGFpbUlkPiAtLWV4cGVjdGVkLXZlcnNpb24gPHRhc2tWZXJzaW9uPiAtLW1hdGVyaWFsaXplDQoNCiMg5Zyo5LiK5LiL5paH6YeM56Gu6K6kIFBSRCDln7rnur/vvIjln7rnur/kuI3lr7nlsLHlgZzkuIvvvIzkuI3opoHln7rkuo7njJzmtYvorr7orqHvvIkNCmxzIC53b3JrbWVzaC9sb2NhbC9jb250ZXh0LzxzbmFwc2hvdElkPi8NCg0KIyDkuqflh7rlkI7kuqTku5jvvJrlsI/nmoTorr7orqHor7TmmI7nlKggSE9TVEVE77yM6K6+6K6h56i/5Zyo5LuT5bqT6YeM55SoIEdJVF9SRUYNCndvcmttZXNoIGRlbGl2ZXIgXA0KICAtLXRhc2sgPHRhc2tJZD4gLS1jbGFpbSA8Y2xhaW1JZD4gLS1zbmFwc2hvdCA8c25hcHNob3RJZD4gXA0KICAtLWV4cGVjdGVkLXZlcnNpb24gPHRhc2tWZXJzaW9uPiBcDQogIC0tbWFuaWZlc3QgZGVsaXZlci1tYW5pZmVzdC5qc29uDQoNCiMg5L2/55SoIGRlbGl2ZXIg6L+U5Zue55qE55yf5a6eIHJldmlld1JlcXVlc3RJZCDmn6Xor6Loh6rliqjliJvlu7rnmoTor4TlrqENCndvcmttZXNoIHJldmlldyBzaG93IC0tcmV2aWV3IDxyZXZpZXdSZXF1ZXN0SWQ+DQpgYGANCg0KYGRlbGl2ZXJgIOi/lOWbniBgcmV2aWV3UmVxdWVzdElkYOOAgVdlYiDlnLDlnYDlkowgYG9wZXJhdGlvbklkYO+8jOS4jeeUqOWGjeasoeWIm+W7uuWQjOS4gOi9ruivhOWuoeOAgui+k+WHuuS4ouWkseaXtu+8jOeUqCBgd29ya21lc2ggcmVjZWlwdCBzaG93IC0tb3BlcmF0aW9uIDzljp/kuqTku5hvcGVyYXRpb25JZD4gLS1qc29uYCDor7vlj5YgYGRhdGEucmVzdWx0UmVmcy5yZXZpZXdSZXF1ZXN0SWRg77yb5pS25o2u5LuN5Li6IFBFTkRJTkcg5oiW57uT5p6c5pyq55+l5pe277yM5YWI55So5Y6f5pON5L2c57yW5Y+35omn6KGMIGB3b3JrbWVzaCByZWNlaXB0IHJlY29uY2lsZSAtLW9wZXJhdGlvbiA85Y6f5Lqk5LuYb3BlcmF0aW9uSWQ+YOOAguato+W8j+WGs+WumuS7jeeUsSBIVU1BTiDlnKggV2ViIOWujOaIkOOAgg0KDQojIyBkZWxpdmVyIG1hbmlmZXN0IOimgeeCuQ0KDQpgYGBqc29uDQp7DQogICJ3b3JrZmxvd0RlZmluaXRpb25SZXZpc2lvbklkIjogIjxzbmFwc2hvdCDph4zorrDlvZXnmoQgd29ya2Zsb3cg5L+u6K6iPiIsDQogICJsb2NhbFJ1bklkIjogIjzmnKzlnLDlj6/lpI3njrDnmoTov5DooYzmoIfor4Y+IiwNCiAgIml0ZW1zIjogWw0KICAgIHsNCiAgICAgICJraW5kIjogIkRFU0lHTiIsDQogICAgICAic3RvcmFnZSI6ICJHSVRfUkVGIiwNCiAgICAgICJtZWRpYVR5cGUiOiAidGV4dC9tYXJrZG93biIsDQogICAgICAic2hhMjU2IjogIjzmlofku7blrZfoioLnmoQgc2hhMjU2PiIsDQogICAgICAiYnl0ZUxlbmd0aCI6IDEyMzQsDQogICAgICAicHJvamVjdFJlcG9zaXRvcnlJZCI6ICI86aG555uu5bey55m76K6w5LuT5bqTIGlkPiIsDQogICAgICAiY29tbWl0U2hhIjogIjw0MCDkvY3lsI/lhpkgaGV4PiIsDQogICAgICAicmVwb1BhdGgiOiAiZGVzaWduL2NoZWNrb3V0LWZsb3cubWQiLA0KICAgICAgInN1bW1hcnkiOiAi57uT566X5rWB56iL55qE5Lik5q2l5byP5pS554mIIiwNCiAgICAgICJjaGVja3MiOiBbeyAiY29kZSI6ICJkZXNpZ24tcmV2aWV3IiwgInBhc3NlZCI6IHRydWUgfV0NCiAgICB9DQogIF0NCn0NCmBgYA0KDQpgc2hhMjU2YCDkuI4gYGJ5dGVMZW5ndGhgIOW/hemhu+S4juecn+WunuWtl+iKguS4gOiHtO+8jOacjeWKoeerr+S8muWkjeaguO+8m2BHSVRfUkVGYCDlv4XpobvmjIflkJHmnKzpobnnm67lt7LnmbvorrDku5PlupPnmoTlrozmlbQgY29tbWl044CCDQoNCiMjIOWksei0peS4jumHjeivlQ0KDQotIOWGmeaTjeS9nOS4jeiHquWKqOmHjeivle+8mueUqOWQjOS4gOS4qiBgLS1vcGVyYXRpb24gPHV1aWQ+YCDph43mlL7vvIzpgb/lhY3ph43lpI3kuqTku5jjgIINCi0g57uT5p6c5LiN5piO5pe25YWIIGB3b3JrbWVzaCByZWNlaXB0IHNob3cgLS1vcGVyYXRpb24gPHV1aWQ+YO+8jOS4jeimgeebtOaOpeWGjeS6pOS4gOasoeOAgg0KLSDpqozmlLbooqvopoHmsYLkv67mlLnvvJrmjInlvZPliY3ku7vliqHlkowgY2xhaW0g54q25oCB6L+U5L+u5ZCO6YeN5pawIGBkZWxpdmVyYO+8jOWGjeeUqOacrOi9rui/lOWbnueahCBgcmV2aWV3UmVxdWVzdElkYCDmiafooYwgYHJldmlldyBzaG93YO+8m+aWsOS6pOS7mOS8muiHquWKqOWIm+W7uuacrOi9ruivhOWuoeOAgg0KDQojIyDop4TmoLzkuI7kuqTku5joh6rmo4ANCg0K5byA5bel5oiW6L+U5L+u5pe25oyJIGBjaGVja2xpc3RzL3NwZWMtZHJpdmVuLm1kYCDmoLjlr7nojIPlm7TjgIHkvp3mja7jgIHniYjmnKzkuI7kuqTmjqXvvJvlj6ror7vlj5blvZPliY3pmLbmrrXpnIDopoHnmoTotYTmupDjgIINCg=="
      },
      {
        "resourceId": "reference-references",
        "path": "roles/ui/references/references.json",
        "sha256": "466348d748697129deffe7c6e9ecb9b56c35f7cd204eb7828ebf2a24195e87db",
        "byteLength": 561,
        "mediaType": "application/json",
        "bodyBase64": "ew0KICAidmVyc2lvbiI6IDEsDQogICJub3RlIjogIuWPquaUvuaMh+mSiO+8jOS4jeaUvuato+aWh+OAgnNjb3BlOiBQUk9KRUNUIHwgVU5JVCB8IFJPTEXjgILot6/lvoTlnKjov5DooYzml7bnlLHlv6vnhafop6PmnpDjgIIiLA0KICAiZW50cmllcyI6IFsNCiAgICB7DQogICAgICAia2V5IjogImRlc2lnbi1zeXN0ZW0iLA0KICAgICAgInNjb3BlIjogIlBST0pFQ1QiLA0KICAgICAgInJlZiI6ICJrbm93bGVkZ2U6Ly88cHJvamVjdC1rZXk+L3ByYWN0aWNlL3VpL2Rlc2lnbi1zeXN0ZW0iDQogICAgfSwNCiAgICB7DQogICAgICAia2V5IjogImNvbnZlbnRpb25zIiwNCiAgICAgICJzY29wZSI6ICJQUk9KRUNUIiwNCiAgICAgICJyZWYiOiAia25vd2xlZGdlOi8vPHByb2plY3Qta2V5Pi9zeXN0ZW0vY29udmVudGlvbnMiDQogICAgfSwNCiAgICB7DQogICAgICAia2V5IjogInByZCIsDQogICAgICAic2NvcGUiOiAiUFJPSkVDVCIsDQogICAgICAicmVmIjogImtub3dsZWRnZTovLzxwcm9qZWN0LWtleT4vcmVxdWlyZW1lbnRzLzzpnIDmsYLnvJblj7c+Ig0KICAgIH0NCiAgXQ0KfQ0K"
      },
      {
        "resourceId": "skill-declare-reuse",
        "path": "roles/ui/skills/declare-reuse/SKILL.md",
        "sha256": "3c11d8262930590cf5e0203b8ba464ca768876c25280b90ca7d073842d512767",
        "byteLength": 1160,
        "mediaType": "text/markdown",
        "bodyBase64": "LS0tDQpuYW1lOiBkZWNsYXJlLXJldXNlDQpkZXNjcmlwdGlvbjog5aOw5piO5aSN55So546w5pyJ57uE5Lu244CB6aG16Z2i5oiW5qih5byP77yM57uZ5Ye65piO56Gu5oyH6ZKI5LiO5beu5byC6K+05piO77yb5b2T6ZyA5rGC5peg6ZyA5paw5aKe6KeG6KeJ54q25oCB44CB5Y+v5rK/55So5pei5pyJ6K6+6K6h5pe25L2/55So44CCDQpsaWNlbnNlOiBNSVQNCm1ldGFkYXRhOg0KICByb2xlS2V5OiB1aQ0KICBwYWNrYWdlVmVyc2lvbjogMC4xLjANCi0tLQ0KDQojIOWjsOaYjuWkjeeUqA0KDQojIyDkvZXml7bnlKgNCg0KLSDpnIDmsYLkuI7ml6LmnInpobXpnaIv57uE5Lu26auY5bqm55u45Ly844CCDQotIOWPqua2ieWPiuaWh+ahiOOAgeaVsOaNruaIluadg+mZkOWPmOWMlu+8jOS4jeaWsOWinuinhuinieeKtuaAgeOAgg0KDQojIyDmraXpqqQNCg0KMS4g5Zyo6K6+6K6h57O757uf5LiO5pei5pyJ6aG16Z2i5Lit5om+5Yiw5Y+v5aSN55So55qE5a+56LGh44CCDQoyLiDpgJDpobnmr5Tlr7nvvJrluIPlsYDjgIHnu4Tku7bjgIHkuqTkupLjgIHnirbmgIHmmK/lkKblrozlhajopobnm5bjgIINCjMuIOWGmeW3ruW8gu+8muWTquS6m+Wtl+auteOAgeaWh+ahiOOAgeadg+mZkOS4jeWQjO+8jOaYr+WQpumcgOimgeWxgOmDqOaJqeWxleOAgg0KNC4g57uZ5oyH6ZKI77ya57uE5Lu25ZCN44CB6aG16Z2i6Lev5b6E44CB6K6+6K6h56i/6ZO+5o6l44CCDQo1LiDkuqflh7ogYHJldXNlLWRlY2xhcmF0aW9uLm1kYOOAgg0KDQojIyDop4TliJkNCg0KLSAqKuWkjeeUqOS4jeaYr+OAjOS4jeiuvuiuoeOAjSoq77ya5b+F6aG76K+05riF5aSN55So5LuA5LmI44CB5beu5Zyo5ZOq44CCDQotIOaMh+mSiOimgeiDveiiq+WJjeerr+ebtOaOpeaJk+W8gO+8jOS4jeiDveWPquWGmeOAjOWPguiAg+iuvue9rumhteOAjeOAgg0KLSDlt67lvILotoXov4fkuInlpITmiJbmtonlj4rmlrDkuqTkupLvvIzmlLnotbAgYHdyaXRlLWRlc2lnbi1zcGVjYOOAgg0KLSDlpI3nlKjlr7zoh7TpqozmlLbml6Dms5Xmu6HotrPml7bvvIzmmI7noa7lhpnlh7rlhrLnqoHvvIzkuI3noazlpZfjgIINCg0KIyMg5Lqk5o6lDQoNCmByZXVzZS1kZWNsYXJhdGlvbi5tZGAg5Lqk5YmN56uv77yb5YmN56uv5o2u5q2k5a6e546w77yM5LiN6ZyA6KaB6YeN5paw5Ye656i/44CCDQo="
      },
      {
        "resourceId": "skills-index",
        "path": "roles/ui/skills/index.md",
        "sha256": "f5f10883c7d51cae595bfc70cb397fbd4c693bca888d49d5fe5d68569a0f4198",
        "byteLength": 868,
        "mediaType": "text/markdown",
        "bodyBase64": "IyBVSSDop5LoibLljIUgwrcg5oqA6IO957Si5byVDQoNCnwg5oqA6IO9ICAgICAgICAgICAgICAgIHwg5YGa5LuA5LmIICAgICAgICAgICAgICAgICAgIHwg5L2V5pe255SoICAgICAgICAgICAgICAgICAgICAgICAgIHwNCnwgLS0tLS0tLS0tLS0tLS0tLS0tLSB8IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSB8IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSB8DQp8IGB3cml0ZS1kZXNpZ24tc3BlY2AgfCDkuqflh7rpobXpnaLjgIHnirbmgIHjgIHkuqTkupLop4TmoLwgfCDmlrDpobXpnaLjgIHmlrDkuqTkupLjgIHop4bop4nlj5jmm7QgICAgICAgfA0KfCBgZGVjbGFyZS1yZXVzZWAgICAgIHwg5aOw5piO5aSN55So546w5pyJ57uE5Lu25oiW5qih5byPICAgfCDlj6/lpI3nlKjml6LmnInorr7orqHjgIHml6DmlrDlop7op4bop4nnirbmgIEgfA0KDQojIyDlhYjliKTmlq3otbDlk6rmnaENCg0KYGBgDQrpnIDopoHmlrDop4bop4kv5paw5Lqk5LqS77yfIOKUgOKUgCDmmK8g4pSA4pSA4pa6IHdyaXRlLWRlc2lnbi1zcGVjDQogICAgICAgIOKUgg0KICAgICAgICDilJTilIDilIAg5ZCmIOKUgOKUgOKWuiBkZWNsYXJlLXJldXNl77yI57uZ5oyH6ZKI77yM5LiN6YeN5paw6K6+6K6h77yJDQpgYGANCg0K5aSn6YOo5YiG6ZyA5rGC5bGe5LqO5aSN55So77ya5YWI5p+l6K6+6K6h57O757uf77yM5om+5LiN5Yiw5YaN5Yqo56yU44CCDQoNCiMjIOS6pOaOpQ0KDQotIOaWsOiuvuiuoSDihpIgYGRlc2lnbi1zcGVjLm1kYO+8jOS6pOWJjeerr+S4juS6p+WTgeehruiupOOAgg0KLSDlpI3nlKgg4oaSIGByZXVzZS1kZWNsYXJhdGlvbi5tZGDvvIznu5nliY3nq6/mmI7noa7nmoTnu4Tku7bkuI7pobXpnaLmjIfpkojjgIINCg=="
      },
      {
        "resourceId": "skill-write-design-spec",
        "path": "roles/ui/skills/write-design-spec/SKILL.md",
        "sha256": "67eab2d1028b6e7e52efee044a607c8960e14241d690ffa6c8a2ad1e927711f9",
        "byteLength": 1192,
        "mediaType": "text/markdown",
        "bodyBase64": "LS0tDQpuYW1lOiB3cml0ZS1kZXNpZ24tc3BlYw0KZGVzY3JpcHRpb246IOS4uua2ieWPiuaWsOmhtemdouaIluaWsOS6pOS6kueahOmcgOaxguS6p+WHuuiuvuiuoeinhOagvO+8jOimhueblueKtuaAgeOAgei+ueeVjOOAgeW8guW4uOS4juWTjeW6lOW8j++8m+W9k+mcgOaxgumcgOimgeaWsOWinuinhuinieaIluS6pOS6kuaXtuS9v+eUqOOAgg0KbGljZW5zZTogTUlUDQptZXRhZGF0YToNCiAgcm9sZUtleTogdWkNCiAgcGFja2FnZVZlcnNpb246IDAuMS4wDQotLS0NCg0KIyDlhpnorr7orqHop4TmoLwNCg0KIyMg5L2V5pe255SoDQoNCi0g6ZyA5rGC5raJ5Y+K5paw6aG16Z2i44CB5paw5Lqk5LqS5oiW6KeG6KeJ5Y+Y5pu044CCDQotIOeOsOacieaooeW8j+aXoOazleimhuebliBQUkQg55qE5Zy65pmv44CCDQoNCiMjIOatpemqpA0KDQoxLiDor7sgUFJE77ya55uu5qCH44CB6IyD5Zu044CB6aqM5pS277yM5qCH5Ye65LiO55WM6Z2i55u45YWz55qE5p2h55uu44CCDQoyLiDmn6Xorr7orqHns7vnu5/vvJrog73lkKbnlKjnjrDmnInnu4Tku7bkuI7mqKHlvI/nu4TlkIjjgIINCjMuIOeUu+mhtemdouS4jueKtuaAge+8muato+W4uOOAgeepuuOAgemUmeivr+OAgeWKoOi9veOAgeadg+mZkOWPl+mZkOOAgg0KNC4g5YaZ5Lqk5LqS77ya54K55Ye744CB6L6T5YWl44CB5qCh6aqM44CB6Lez6L2s44CB6L+U5Zue44CCDQo1LiDmoIfovrnnlYzvvJrplb/mlofmnKzjgIHotoXplb/liJfooajjgIHlsI/lsY/jgIHmnoHnq6/mlbDmja7jgIINCjYuIOS6p+WHuiBgZGVzaWduLXNwZWMubWRg44CCDQoNCiMjIOinhOWImQ0KDQotIOavj+adoeeVjOmdouebuOWFs+eahOmqjOaUtu+8jOmDveimgeacieWvueW6lOeahOeVjOmdouihqOeOsOOAgg0KLSDkupTnp43nirbmgIHnvLrkuIDkuI3lj6/vvJvlj6rnlLvmraPluLjmgIHnmoTorr7orqHkuI3nrpflrozmiJDjgIINCi0g5LiN5byV5YWl5paw57uE5Lu277yM6Zmk6Z2e546w5pyJ57uE5Lu256Gu5a6e5peg5rOV6KGo6L6+77yM5bm25YaZ5piO55CG55Sx44CCDQotIOS4juaXouacieiuvuiuoeinhOiMg+S4jeS4gOiHtOWkhO+8jOW/hemhu+aYvuW8j+ivtOaYjuOAgg0KDQojIyDkuqTmjqUNCg0KYGRlc2lnbi1zcGVjLm1kYCDkuqTkuqflk4Hnoa7orqTjgIHliY3nq6/mtojotLnjgILliY3nq6/mja7mraTlrp7njrDvvIzkuI3lv4Xlho3njJzjgIINCg=="
      }
    ]
  }
];
