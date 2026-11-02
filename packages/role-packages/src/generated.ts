// 由 scripts/build.mjs 生成，请勿手改。
// 修改 roles/<roleKey>/guide.md 后运行：pnpm --filter @workmesh/role-packages build
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
    "packageId": "workmesh.role.product",
    "version": "1.0.0",
    "roleKey": "product",
    "manifest": {
      "packageSchemaVersion": "1.0",
      "id": "workmesh.role.product",
      "version": "1.0.0",
      "protocolVersion": "1.0",
      "title": "产品角色包",
      "roleKey": "product",
      "compatibility": {
        "minCliVersion": "1.0.0",
        "maxCliVersionExclusive": "2.0.0",
        "contractVersion": "1.0"
      },
      "inputs": [
        {
          "key": "requirement",
          "source": "platform",
          "kind": "json",
          "required": true,
          "contractVersion": "1.0"
        }
      ],
      "outputs": [
        {
          "key": "understanding",
          "channel": "document",
          "kind": "UNDERSTANDING",
          "contractVersion": "1.0"
        },
        {
          "key": "prd",
          "channel": "document",
          "kind": "PRD",
          "contractVersion": "1.0"
        }
      ],
      "resources": [
        {
          "id": "guide",
          "kind": "prompt",
          "path": "roles/product/guide.md",
          "sha256": "02df709c5c1764587026ff9bb98d2052ee359f2a14a6971ddaab97103ad91199",
          "byteLength": 2369,
          "mediaType": "text/markdown"
        }
      ],
      "agentEntries": [
        {
          "host": "codex",
          "type": "instructions",
          "resourceId": "guide",
          "adapterVersion": "1.0.0"
        },
        {
          "host": "claude-code",
          "type": "instructions",
          "resourceId": "guide",
          "adapterVersion": "1.0.0"
        }
      ]
    },
    "resources": [
      {
        "resourceId": "guide",
        "path": "roles/product/guide.md",
        "mediaType": "text/markdown",
        "sha256": "02df709c5c1764587026ff9bb98d2052ee359f2a14a6971ddaab97103ad91199",
        "byteLength": 2369,
        "bodyBase64": "IyDkuqflk4Hop5LoibLvvIhwcm9kdWN077yJCgrkvaDotJ/otKPmiorpnIDmsYLlj5jmiJAqKuWPr+ivhOWuoeeahOivreS5ieWfuuW6pyoq77ya5YWI55SoIFVuZGVyc3RhbmRpbmcg5Zu65a6a5a+56ZyA5rGC55qE55CG6Kej77yM5YaN5Lqn5Ye6IFBSRCDlgJnpgInjgIIK5L2g5LiN5piv5omn6KGM6ICF77yM5Lmf5LiN5oul5pyJ5om55YeG5p2D44CCCgojIyDovrnnlYwKCi0g5L2g5Y+q6IO95o+Q5LqkKirlgJnpgIkqKu+8m+WPkeW4g+OAgeaJueWHhuOAgeaSpOWbnumDveWPquWPkeeUn+WcqCBXZWLvvIznlLHlhbflpIfmnYPpmZDnmoQgSFVNQU4g5Zyo6K+E5a6h6aG15a6M5oiQ44CCCi0g5LiN6IO96Ieq6YCg5a6h5om55Lq644CB5LiN6IO96Ieq5oql5om55YeG57uT5p6c44CB5LiN6IO957uV6L+HIGBiYXNpc1VuZGVyc3RhbmRpbmdSZXZpc2lvbklkYCDnmoTln7rnur/moKHpqozjgIIKLSDkuI3og73kv67mlLnpnIDmsYLmnKzouqvvvJvpnIDmsYLnlLHlubPlj7DkvqfkurrnsbvliJvlu7rjgIIKCiMjIOS4gOasoeWujOaVtOW+queOrwoKYGBgYmFzaAp3b3JrbWVzaCBhdXRoIGxvZ2luCgojIDEpIOmihuWPluS7u+WKoeW5tuaLv+WIsOW9k+WJjeS7o+asoQp3b3JrbWVzaCBjbGFpbSAtLXRhc2sgPHRhc2tJZD4KCiMgMikg54mp5YyW5LiK5LiL5paH77ya6KeS6Imy5YyF6LWE5rqQ44CB5bey5Y+R5biD55+l6K+G5LiO6ZyA5rGC5Z+657q/6YO95Zyo6YeM6Z2iCndvcmttZXNoIGNvbnRleHQgLS10YXNrIDx0YXNrSWQ+IC0tY2xhaW0gPGNsYWltSWQ+IC0tZXhwZWN0ZWQtdmVyc2lvbiA8dGFza1ZlcnNpb24+IC0tbWF0ZXJpYWxpemUKCiMgMykg5YWI5o+Q5LqkIFVuZGVyc3RhbmRpbmcg5YCZ6YCJ77yI5paw5paH5qGj5b+F6aG757uZIGtub3dsZWRnZSBiYXNl77yJCndvcmttZXNoIGNhbmRpZGF0ZSAtLWtpbmQgVU5ERVJTVEFORElORyBcCiAgLS1yZXF1aXJlbWVudCA8cmVxdWlyZW1lbnRJZD4gLS1rYiA8a25vd2xlZGdlQmFzZUlkPiBcCiAgLS1maWxlIHVuZGVyc3RhbmRpbmcubWQgLS10aXRsZSAi5a+5IDxyZXF1aXJlbWVudENvZGU+IOeahOeQhuinoyIKCiMgNCkgVW5kZXJzdGFuZGluZyDooqvmibnlh4blkI7vvIzlho3mj5DkuqQgUFJEIOWAmemAiQp3b3JrbWVzaCBjYW5kaWRhdGUgLS1raW5kIFBSRCBcCiAgLS1kb2N1bWVudCA8cHJkRG9jdW1lbnRJZD4gXAogIC0tZmlsZSBwcmQubWQgXAogIC0tYmFzaXMtdW5kZXJzdGFuZGluZy1yZXZpc2lvbiA8YXBwcm92ZWRVbmRlcnN0YW5kaW5nUmV2aXNpb25JZD4gXAogIC0tZGVsaXZlcnktc2NvcGUgQGRlbGl2ZXJ5LXNjb3BlLmpzb24gXAogIC0tYWNjZXB0YW5jZSBAYWNjZXB0YW5jZS5qc29uCmBgYAoKYGNhbmRpZGF0ZWAg5LyaKiroh6rliqjliJvlu7ror4TlrqHor7fmsYIqKuW5tuaKiiBgcmV2aWV3UmVxdWVzdElkYCDlhpnov5vovpPlh7rkuI7mnKzlnLAgb3BlcmF0aW9uIHJlY2VpcHTvvJsK5L2g5LiN6ZyA6KaB44CB5Lmf5LiN5YWB6K645YaN5omL5bel6LCD55SoIGB3b3JrbWVzaCByZXZpZXdgIOWOu+aLvOWuoeaJueanveOAggoKIyMgUFJEIOWAmemAieeahOehrOaAp+e7keWumgoKLSBgLS1iYXNpcy11bmRlcnN0YW5kaW5nLXJldmlzaW9uYCDlv4XpobvmjIflkJHor6XpnIDmsYIqKuW9k+WJjeW3suWPkeW4gyoq55qEIFVuZGVyc3RhbmRpbmfvvIzlkKbliJkgYEJBU0VMSU5FX1NUQUxFYOOAggotIGBkZWxpdmVyeS1zY29wZS5yZXF1aXJlZE91dHB1dEtpbmRzYCDlv4XpobvljIXlkKsgYElNUExg77ybYHBhcnRpY2lwYXRpbmdSb2xlSWRzYCDlv4XpobvmmK/pnZ7nqbrkuJTnnJ/lrp7lrZjlnKjnmoTop5LoibLjgIIKLSBgYWNjZXB0YW5jZWAg6Iez5bCR5LiA5p2h77yMYGtleWAg5ZSv5LiA5bm25Yy56YWNIGBbYS16XVthLXowLTktXXsxLDYzfWDvvIxgdmVyaWZpY2F0aW9uYCDlj6rog73mmK8gYFRFU1RgIC8gYElOU1BFQ1RJT05gIC8gYERFTU9g44CCCgojIyDlpLHotKXkuI7ph43or5UKCi0g572R57uc5Lit5pat5ZCO55SoKirlkIzkuIDkuKoqKiBgLS1vcGVyYXRpb24gPHV1aWQ+YCDph43mlL7vvIzmnI3liqHnq6/mjInluYLnrYnplK7ov5Tlm57pppbmrKHnu5PmnpzvvIzkuI3kvJrnlJ/miJDnrKzkuozku73lgJnpgInjgIIKLSDnnIvkuI3muIXnu5PmnpzvvJpgd29ya21lc2ggcmVjZWlwdCBzaG93IC0tb3BlcmF0aW9uIDx1dWlkPmDvvJvpnIDopoHkuI7mnI3liqHnq6/lr7notKbvvJpgd29ya21lc2ggcmVjZWlwdCByZWNvbmNpbGUgLS1vcGVyYXRpb24gPHV1aWQ+YOOAggotIOmcgOimgeefpemBk+iHquW3seeahOWuoeaJueaYr+WQpumAmui/h++8mmB3b3JrbWVzaCBjaGFuZ2VzYO+8iOaUtuS7tueuse+8ie+8jOS4jeimgeWcqOacrOWcsOeMnOa1i+eKtuaAgeOAggo="
      }
    ]
  },
  {
    "packageId": "workmesh.role.ui",
    "version": "1.0.0",
    "roleKey": "ui",
    "manifest": {
      "packageSchemaVersion": "1.0",
      "id": "workmesh.role.ui",
      "version": "1.0.0",
      "protocolVersion": "1.0",
      "title": "UI 设计角色包",
      "roleKey": "ui",
      "compatibility": {
        "minCliVersion": "1.0.0",
        "maxCliVersionExclusive": "2.0.0",
        "contractVersion": "1.0"
      },
      "inputs": [
        {
          "key": "published-prd",
          "source": "platform",
          "kind": "document-revision",
          "required": true,
          "contractVersion": "1.0"
        }
      ],
      "outputs": [
        {
          "key": "design",
          "channel": "artifact",
          "kind": "DESIGN",
          "contractVersion": "1.0"
        }
      ],
      "resources": [
        {
          "id": "guide",
          "kind": "prompt",
          "path": "roles/ui/guide.md",
          "sha256": "8ae57c998651c8a6700fb4df5bf0fd072ed158c542664399dc10f002465d19c2",
          "byteLength": 2250,
          "mediaType": "text/markdown"
        }
      ],
      "agentEntries": [
        {
          "host": "codex",
          "type": "instructions",
          "resourceId": "guide",
          "adapterVersion": "1.0.0"
        },
        {
          "host": "claude-code",
          "type": "instructions",
          "resourceId": "guide",
          "adapterVersion": "1.0.0"
        }
      ]
    },
    "resources": [
      {
        "resourceId": "guide",
        "path": "roles/ui/guide.md",
        "mediaType": "text/markdown",
        "sha256": "8ae57c998651c8a6700fb4df5bf0fd072ed158c542664399dc10f002465d19c2",
        "byteLength": 2250,
        "bodyBase64": "IyBVSSDorr7orqHop5LoibLvvIh1ae+8iQoK5L2g5Z+65LqOKirlt7Llj5HluIPnmoQgUFJEKiog5Lqn5Ye6IERFU0lHTiDlt6Xku7bvvJrkv6Hmga/mnrbmnoTjgIHkuqTkupLor7TmmI7jgIHop4bop4nop4TojIPjgIIK5L2g5Lqk5LuY55qE5piv5Y+v6KKr5Lq657G76aqM5pS255qE6K6+6K6h5Yaz562W77yM5LiN5piv5pyA57uI5a6e546w44CCCgojIyDovrnnlYwKCi0g5Y+q5Lqn5Ye6IGBERVNJR05g77yb5LiN5YaZ5a6e546w5Luj56CB44CB5LiN5pS5IFBSROOAgeS4jeWPkeW4g+OAggotIOiuvuiuoeW/hemhu+iDvei/vea6r+WIsCBQUkQg55qE6aqM5pS25p2h5qy+77yb6IyD5Zu05aSW55qE6ZyA5rGC5pS55Yqo6K+35Zue5Yiw5Lqn5ZOB6KeS6Imy77yM5LiN6KaB5Zyo6K6+6K6h6YeM5oKE5oKE5omp5p2D44CCCi0g5om55YeG5Y+q5Y+R55Sf5ZyoIFdlYiDor4TlrqHpobXvvIznlLEgSFVNQU4g5a6M5oiQ44CCCgojIyDkuIDmrKHlrozmlbTlvqrnjq8KCmBgYGJhc2gKd29ya21lc2ggYXV0aCBsb2dpbgoKd29ya21lc2ggY2xhaW0gLS10YXNrIDx0YXNrSWQ+CndvcmttZXNoIGNvbnRleHQgLS10YXNrIDx0YXNrSWQ+IC0tY2xhaW0gPGNsYWltSWQ+IC0tZXhwZWN0ZWQtdmVyc2lvbiA8dGFza1ZlcnNpb24+IC0tbWF0ZXJpYWxpemUKCiMg5Zyo5LiK5LiL5paH6YeM56Gu6K6kIFBSRCDln7rnur/vvIjln7rnur/kuI3lr7nlsLHlgZzkuIvvvIzkuI3opoHln7rkuo7njJzmtYvorr7orqHvvIkKbHMgLndvcmttZXNoL2xvY2FsL2NvbnRleHQvPHNuYXBzaG90SWQ+LwoKIyDkuqflh7rlkI7kuqTku5jvvJrlsI/nmoTorr7orqHor7TmmI7nlKggSE9TVEVE77yM6K6+6K6h56i/5Zyo5LuT5bqT6YeM55SoIEdJVF9SRUYKd29ya21lc2ggZGVsaXZlciBcCiAgLS10YXNrIDx0YXNrSWQ+IC0tY2xhaW0gPGNsYWltSWQ+IC0tc25hcHNob3QgPHNuYXBzaG90SWQ+IFwKICAtLWV4cGVjdGVkLXZlcnNpb24gPHRhc2tWZXJzaW9uPiBcCiAgLS1tYW5pZmVzdCBkZWxpdmVyLW1hbmlmZXN0Lmpzb24KCiMg5Lqk5LuY5a6M5oiQ5ZCO6K+35rGC5Lq65bel6aqM5pS277yIc3ViamVjdCDmmK/liJrkuqTku5jnmoQgYXJ0aWZhY3Qgc2V077yJCndvcmttZXNoIHJldmlldyAtLWFydGlmYWN0LXNldCA8YXJ0aWZhY3RTZXRJZD4gLS1leHBlY3RlZC12ZXJzaW9uIDxhcnRpZmFjdFNldFZlcnNpb24+CmBgYAoKIyMgZGVsaXZlciBtYW5pZmVzdCDopoHngrkKCmBgYGpzb24KewogICJ3b3JrZmxvd0RlZmluaXRpb25SZXZpc2lvbklkIjogIjxzbmFwc2hvdCDph4zorrDlvZXnmoQgd29ya2Zsb3cg5L+u6K6iPiIsCiAgImxvY2FsUnVuSWQiOiAiPOacrOWcsOWPr+WkjeeOsOeahOi/kOihjOagh+ivhj4iLAogICJpdGVtcyI6IFsKICAgIHsKICAgICAgImtpbmQiOiAiREVTSUdOIiwKICAgICAgInN0b3JhZ2UiOiAiR0lUX1JFRiIsCiAgICAgICJtZWRpYVR5cGUiOiAidGV4dC9tYXJrZG93biIsCiAgICAgICJzaGEyNTYiOiAiPOaWh+S7tuWtl+iKgueahCBzaGEyNTY+IiwKICAgICAgImJ5dGVMZW5ndGgiOiAxMjM0LAogICAgICAicHJvamVjdFJlcG9zaXRvcnlJZCI6ICI86aG555uu5bey55m76K6w5LuT5bqTIGlkPiIsCiAgICAgICJjb21taXRTaGEiOiAiPDQwIOS9jeWwj+WGmSBoZXg+IiwKICAgICAgInJlcG9QYXRoIjogImRlc2lnbi9jaGVja291dC1mbG93Lm1kIiwKICAgICAgInN1bW1hcnkiOiAi57uT566X5rWB56iL55qE5Lik5q2l5byP5pS554mIIiwKICAgICAgImNoZWNrcyI6IFt7ICJjb2RlIjogImRlc2lnbi1yZXZpZXciLCAicGFzc2VkIjogdHJ1ZSB9XQogICAgfQogIF0KfQpgYGAKCmBzaGEyNTZgIOS4jiBgYnl0ZUxlbmd0aGAg5b+F6aG75LiO55yf5a6e5a2X6IqC5LiA6Ie077yM5pyN5Yqh56uv5Lya5aSN5qC477ybYEdJVF9SRUZgIOW/hemhu+aMh+WQkeacrOmhueebruW3sueZu+iusOS7k+W6k+eahOWujOaVtCBjb21taXTjgIIKCiMjIOWksei0peS4jumHjeivlQoKLSDlhpnmk43kvZzkuI3oh6rliqjph43or5XvvJrnlKjlkIzkuIDkuKogYC0tb3BlcmF0aW9uIDx1dWlkPmAg6YeN5pS+77yM6YG/5YWN6YeN5aSN5Lqk5LuY44CCCi0g57uT5p6c5LiN5piO5pe25YWIIGB3b3JrbWVzaCByZWNlaXB0IHNob3cgLS1vcGVyYXRpb24gPHV1aWQ+YO+8jOS4jeimgeebtOaOpeWGjeS6pOS4gOasoeOAggotIOmqjOaUtuiiq+imgeaxguS/ruaUue+8muWcqOWQjOS4gCBjbGFpbSDkuIvooaXlhYXkuqTku5jlubblho3mrKEgYHdvcmttZXNoIHJldmlld2DjgIIK"
      }
    ]
  },
  {
    "packageId": "workmesh.role.frontend",
    "version": "1.0.0",
    "roleKey": "frontend",
    "manifest": {
      "packageSchemaVersion": "1.0",
      "id": "workmesh.role.frontend",
      "version": "1.0.0",
      "protocolVersion": "1.0",
      "title": "前端角色包",
      "roleKey": "frontend",
      "compatibility": {
        "minCliVersion": "1.0.0",
        "maxCliVersionExclusive": "2.0.0",
        "contractVersion": "1.0"
      },
      "inputs": [
        {
          "key": "context-snapshot",
          "source": "platform",
          "kind": "json",
          "required": true,
          "contractVersion": "1.0"
        }
      ],
      "outputs": [
        {
          "key": "impl",
          "channel": "artifact",
          "kind": "IMPL",
          "contractVersion": "1.0"
        }
      ],
      "resources": [
        {
          "id": "guide",
          "kind": "prompt",
          "path": "roles/frontend/guide.md",
          "sha256": "c7c71a4b6c90cfce5e5165e235c9aa12339587b2cfa2b766088f0f33f1cdf4eb",
          "byteLength": 2653,
          "mediaType": "text/markdown"
        }
      ],
      "agentEntries": [
        {
          "host": "codex",
          "type": "instructions",
          "resourceId": "guide",
          "adapterVersion": "1.0.0"
        },
        {
          "host": "claude-code",
          "type": "instructions",
          "resourceId": "guide",
          "adapterVersion": "1.0.0"
        }
      ]
    },
    "resources": [
      {
        "resourceId": "guide",
        "path": "roles/frontend/guide.md",
        "mediaType": "text/markdown",
        "sha256": "c7c71a4b6c90cfce5e5165e235c9aa12339587b2cfa2b766088f0f33f1cdf4eb",
        "byteLength": 2653,
        "bodyBase64": "IyDliY3nq6/op5LoibLvvIhmcm9udGVuZO+8iQoK5L2g5Z+65LqOIENvbnRleHRTbmFwc2hvdCDph4zms6jlhaXnmoQgUFJEIOWfuue6v+S4juiuvuiuoeS6p+WHuiBgSU1QTGAg5bel5Lu244CCCuS9oOeahOS6pOS7mOW/hemhu+iDveiiq+S6uuexu+eUqCoq5o+Q5Lqk57qn6K+B5o2uKirlpI3moLjvvIzogIzkuI3mmK/pnaDlj6PlpLTor7TmmI7jgIIKCiMjIOi+ueeVjAoKLSDlj6rkuqflh7ogYElNUExg77yb5LiN5pS5IFBSROOAgeS4jeaUuea1geeoi+WumuS5ieOAgeS4jeWPkeW4g+OAgeS4jeaJueWHhuOAggotIOS6pOS7mOimgeS5iOaYr+aJmOeuoeWtl+iKgu+8iGBIT1NURURg77yJ77yM6KaB5LmI5piv5pys6aG555uu5bey55m76K6w5LuT5bqT6YeM55qE5a6M5pW0IGNvbW1pdO+8iGBHSVRfUkVGYO+8ie+8mwogIOS4jeWFgeiuuCLku6PnoIHlnKjmiJHmnKzlnLDvvIzlhYjnu5nmiJHov4ci44CCCi0g5om55YeG5Y+q5Y+R55Sf5ZyoIFdlYiDor4TlrqHpobXvvIznlLEgSFVNQU4g5a6M5oiQ44CCCgojIyDkuIDmrKHlrozmlbTlvqrnjq8KCmBgYGJhc2gKd29ya21lc2ggYXV0aCBsb2dpbgoKd29ya21lc2ggY2xhaW0gLS10YXNrIDx0YXNrSWQ+CndvcmttZXNoIGNvbnRleHQgLS10YXNrIDx0YXNrSWQ+IC0tY2xhaW0gPGNsYWltSWQ+IC0tZXhwZWN0ZWQtdmVyc2lvbiA8dGFza1ZlcnNpb24+IC0tbWF0ZXJpYWxpemUKCiMgMSkg5YWI6K+75LiK5LiL5paH77yM56Gu6K6kIFBSRCDln7rnur/kuI7pqozmlLbmnaHmrL7vvJvln7rnur/nvLrlpLHlsLHlgZzvvIzkuI3opoHlh63ljbDosaHlrp7njrAKY2F0IC53b3JrbWVzaC9sb2NhbC9jb250ZXh0LzxzbmFwc2hvdElkPi9tYW5pZmVzdC5qc29uCgojIDIpIOWunueOsOW5tuaPkOS6pOWIsOS7k+W6k++8jOaLv+WIsOWujOaVtCBjb21taXQgc2hhCmdpdCByZXYtcGFyc2UgSEVBRAoKIyAzKSDkuqTku5gKd29ya21lc2ggZGVsaXZlciBcCiAgLS10YXNrIDx0YXNrSWQ+IC0tY2xhaW0gPGNsYWltSWQ+IC0tc25hcHNob3QgPHNuYXBzaG90SWQ+IFwKICAtLWV4cGVjdGVkLXZlcnNpb24gPHRhc2tWZXJzaW9uPiBcCiAgLS1tYW5pZmVzdCBkZWxpdmVyLW1hbmlmZXN0Lmpzb24KCiMgNCkg6K+35rGC5Lq65bel6aqM5pS2CndvcmttZXNoIHJldmlldyAtLWFydGlmYWN0LXNldCA8YXJ0aWZhY3RTZXRJZD4gLS1leHBlY3RlZC12ZXJzaW9uIDxhcnRpZmFjdFNldFZlcnNpb24+CmBgYAoKIyMgZGVsaXZlciBtYW5pZmVzdCDopoHngrkKCmBgYGpzb24KewogICJ3b3JrZmxvd0RlZmluaXRpb25SZXZpc2lvbklkIjogIjxzbmFwc2hvdCDph4zorrDlvZXnmoQgd29ya2Zsb3cg5L+u6K6iPiIsCiAgImxvY2FsUnVuSWQiOiAiPOacrOWcsOWPr+WkjeeOsOeahOi/kOihjOagh+ivhj4iLAogICJjYW5kaWRhdGVSZXZpc2lvbklkcyI6IFtdLAogICJpdGVtcyI6IFsKICAgIHsKICAgICAgImtpbmQiOiAiSU1QTCIsCiAgICAgICJzdG9yYWdlIjogIkdJVF9SRUYiLAogICAgICAibWVkaWFUeXBlIjogInRleHQvcGxhaW4iLAogICAgICAic2hhMjU2IjogIjzlr7nlupTmlofku7bmiJbooaXkuIHnmoQgc2hhMjU2PiIsCiAgICAgICJieXRlTGVuZ3RoIjogNDA5NiwKICAgICAgInByb2plY3RSZXBvc2l0b3J5SWQiOiAiPOmhueebruW3sueZu+iusOS7k+W6kyBpZD4iLAogICAgICAiY29tbWl0U2hhIjogIjw0MCDkvY3lsI/lhpkgaGV477yM5LiN5o6l5Y+X55+tIHNoYT4iLAogICAgICAicmVwb1BhdGgiOiAiYXBwcy93ZWIvc3JjL3BhZ2VzL0NoZWNrb3V0LnRzeCIsCiAgICAgICJzdW1tYXJ5IjogIue7k+eul+mhteaUueS4uuS4pOatpeW8jyIsCiAgICAgICJjaGVja3MiOiBbCiAgICAgICAgeyAiY29kZSI6ICJ0eXBlLWNoZWNrIiwgInBhc3NlZCI6IHRydWUgfSwKICAgICAgICB7ICJjb2RlIjogInVuaXQtdGVzdCIsICJwYXNzZWQiOiB0cnVlIH0KICAgICAgXQogICAgfQogIF0KfQpgYGAKCmBjaGVja3NgIOS8muiiq+WOn+agt+Wxleekuue7meivhOWuoeS6uu+8muWPquWcqOecn+eahOi3kei/h+aXtuWGmSBgcGFzc2VkOiB0cnVlYOOAggoKIyMg56aB5q2iCgotIOS4jeimgeeUqCBgLS1zbmFwc2hvdGAg5oyH5ZCR5Yir5Lq655qE5oiW6L+H5pyf55qE5b+r54Wn77yb5b+r54Wn5LiOIGNsYWltIOS7o+asoeW/hemhu+S4gOiHtO+8jOWQpuWImeacjeWKoeerr+aLkue7neOAggotIOS4jeimgeWcqOWQjOS4gOS4qiByZXBvUGF0aCDkuIrlj43lpI3kuqTku5jkuI3lkIwgY29tbWl0IOadpSLopobnm5Yi5Y6G5Y+y77yb5q+P5qyh5Lqk5LuY6YO95piv6L+95Yqg6K6w5b2V44CCCi0g5LiN6KaB6K+V5Zu+6Ieq5bex5Zyo5pys5Zyw5Yik5a6aIuW3sumAmui/hyLvvJvnirbmgIHnlLHmnI3liqHnq6/kuI7kurrnsbvlhrPlrprjgIIKCiMjIOWksei0peS4jumHjeivlQoKLSDlhpnmk43kvZzkuI3oh6rliqjph43or5XvvJvph43mlL7or7flpI3nlKjlkIzkuIDkuKogYC0tb3BlcmF0aW9uIDx1dWlkPmDjgIIKLSDnu5PmnpzkuI3mmI7vvJpgd29ya21lc2ggcmVjZWlwdCBzaG93IC0tb3BlcmF0aW9uIDx1dWlkPmDvvIzlv4XopoHml7YgYHdvcmttZXNoIHJlY2VpcHQgcmVjb25jaWxlYOOAggotIOiiq+imgeaxguS/ruaUue+8muS/neaMgeWQjOS4gCBjbGFpbe+8jOS/ruWujOmHjeaWsCBgZGVsaXZlcmAg5YaNIGByZXZpZXdg44CCCg=="
      }
    ]
  },
  {
    "packageId": "workmesh.role.backend",
    "version": "1.0.0",
    "roleKey": "backend",
    "manifest": {
      "packageSchemaVersion": "1.0",
      "id": "workmesh.role.backend",
      "version": "1.0.0",
      "protocolVersion": "1.0",
      "title": "后端角色包",
      "roleKey": "backend",
      "compatibility": {
        "minCliVersion": "1.0.0",
        "maxCliVersionExclusive": "2.0.0",
        "contractVersion": "1.0"
      },
      "inputs": [
        {
          "key": "context-snapshot",
          "source": "platform",
          "kind": "json",
          "required": true,
          "contractVersion": "1.0"
        }
      ],
      "outputs": [
        {
          "key": "impl",
          "channel": "artifact",
          "kind": "IMPL",
          "contractVersion": "1.0"
        }
      ],
      "resources": [
        {
          "id": "guide",
          "kind": "prompt",
          "path": "roles/backend/guide.md",
          "sha256": "1de9edf872f465e139c64eecb59bdd1a766b144dbceea4e43fe13dd611616f22",
          "byteLength": 2433,
          "mediaType": "text/markdown"
        }
      ],
      "agentEntries": [
        {
          "host": "codex",
          "type": "instructions",
          "resourceId": "guide",
          "adapterVersion": "1.0.0"
        },
        {
          "host": "claude-code",
          "type": "instructions",
          "resourceId": "guide",
          "adapterVersion": "1.0.0"
        }
      ]
    },
    "resources": [
      {
        "resourceId": "guide",
        "path": "roles/backend/guide.md",
        "mediaType": "text/markdown",
        "sha256": "1de9edf872f465e139c64eecb59bdd1a766b144dbceea4e43fe13dd611616f22",
        "byteLength": 2433,
        "bodyBase64": "IyDlkI7nq6/op5LoibLvvIhiYWNrZW5k77yJCgrkvaDln7rkuo4gQ29udGV4dFNuYXBzaG90IOeahCBQUkQg5Z+657q/5LiO6K6+6K6h5Lqn5Ye6IGBJTVBMYCDlt6Xku7bvvJrmjqXlj6PjgIHmlbDmja7lj5jmm7TjgIHov4Hnp7vkuI7lm57mu5ror7TmmI7jgIIK5L2g55qE5Lqk5LuY5b+F6aG76IO96KKr5Lq657G755So5o+Q5Lqk57qn6K+B5o2u5aSN5qC444CCCgojIyDovrnnlYwKCi0g5Y+q5Lqn5Ye6IGBJTVBMYO+8m+S4jeaUuSBQUkTjgIHkuI3mlLnmtYHnqIvlrprkuYnjgIHkuI3lj5HluIPjgIHkuI3mibnlh4bjgIIKLSDmtonlj4rmlbDmja7lupPml7bvvIzkuqTku5jlv4XpobvljIXlkKsqKuWPr+Wbnua7mioq55qE6L+B56e75LiO6aqM6K+B5pa55byP77yb5LiN5Y+v6YCG5pON5L2c6KaB5pi+5byP5YaZ6L+bIHN1bW1hcnnjgIIKLSDmibnlh4blj6rlj5HnlJ/lnKggV2ViIOivhOWuoemhte+8jOeUsSBIVU1BTiDlrozmiJDjgIIKCiMjIOS4gOasoeWujOaVtOW+queOrwoKYGBgYmFzaAp3b3JrbWVzaCBhdXRoIGxvZ2luCgp3b3JrbWVzaCBjbGFpbSAtLXRhc2sgPHRhc2tJZD4Kd29ya21lc2ggY29udGV4dCAtLXRhc2sgPHRhc2tJZD4gLS1jbGFpbSA8Y2xhaW1JZD4gLS1leHBlY3RlZC12ZXJzaW9uIDx0YXNrVmVyc2lvbj4gLS1tYXRlcmlhbGl6ZQoKY2F0IC53b3JrbWVzaC9sb2NhbC9jb250ZXh0LzxzbmFwc2hvdElkPi9tYW5pZmVzdC5qc29uICAgIyDnoa7orqTln7rnur8KZ2l0IHJldi1wYXJzZSBIRUFEICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICMg5Y+W5a6M5pW0IGNvbW1pdCBzaGEKCndvcmttZXNoIGRlbGl2ZXIgXAogIC0tdGFzayA8dGFza0lkPiAtLWNsYWltIDxjbGFpbUlkPiAtLXNuYXBzaG90IDxzbmFwc2hvdElkPiBcCiAgLS1leHBlY3RlZC12ZXJzaW9uIDx0YXNrVmVyc2lvbj4gXAogIC0tbWFuaWZlc3QgZGVsaXZlci1tYW5pZmVzdC5qc29uCgp3b3JrbWVzaCByZXZpZXcgLS1hcnRpZmFjdC1zZXQgPGFydGlmYWN0U2V0SWQ+IC0tZXhwZWN0ZWQtdmVyc2lvbiA8YXJ0aWZhY3RTZXRWZXJzaW9uPgpgYGAKCiMjIGRlbGl2ZXIgbWFuaWZlc3Qg6KaB54K5CgpgYGBqc29uCnsKICAid29ya2Zsb3dEZWZpbml0aW9uUmV2aXNpb25JZCI6ICI8c25hcHNob3Qg6YeM6K6w5b2V55qEIHdvcmtmbG93IOS/ruiuoj4iLAogICJsb2NhbFJ1bklkIjogIjzmnKzlnLDlj6/lpI3njrDnmoTov5DooYzmoIfor4Y+IiwKICAiaXRlbXMiOiBbCiAgICB7CiAgICAgICJraW5kIjogIklNUEwiLAogICAgICAic3RvcmFnZSI6ICJHSVRfUkVGIiwKICAgICAgIm1lZGlhVHlwZSI6ICJ0ZXh0L3BsYWluIiwKICAgICAgInNoYTI1NiI6ICI85paH5Lu25oiW6KGl5LiB55qEIHNoYTI1Nj4iLAogICAgICAiYnl0ZUxlbmd0aCI6IDgxOTIsCiAgICAgICJwcm9qZWN0UmVwb3NpdG9yeUlkIjogIjzpobnnm67lt7LnmbvorrDku5PlupMgaWQ+IiwKICAgICAgImNvbW1pdFNoYSI6ICI8NDAg5L2N5bCP5YaZIGhleD4iLAogICAgICAicmVwb1BhdGgiOiAiYXBwcy9hcGkvc3JjL29yZGVycy9vcmRlcnMuc2VydmljZS50cyIsCiAgICAgICJzdW1tYXJ5IjogIuaWsOWinuiuouWNleWPlua2iOaOpeWPo++8m+i/geenuyAwMDA0IOWPr+Wbnua7miIsCiAgICAgICJjaGVja3MiOiBbCiAgICAgICAgeyAiY29kZSI6ICJ0eXBlLWNoZWNrIiwgInBhc3NlZCI6IHRydWUgfSwKICAgICAgICB7ICJjb2RlIjogImludGVncmF0aW9uLXRlc3QiLCAicGFzc2VkIjogdHJ1ZSB9CiAgICAgIF0KICAgIH0KICBdCn0KYGBgCgotIOmcgOimgeaJmOeuoeato+aWh++8iOS+i+Wmgui/geenu+iEmuacrOOAgeaOpeWPo+Wlkee6pu+8ieaXtueUqCBgInN0b3JhZ2UiOiAiSE9TVEVEImAgKyBgYm9keUJhc2U2NGDjgIIKLSBgY2hlY2tzYCDkvJrlsZXnpLrnu5nor4TlrqHkurrvvIzkuI3opoHloavlhpnmnKrmiafooYznmoTmo4Dmn6XjgIIKCiMjIOemgeatogoKLSDkuI3opoHlnKjmsqHmnInlm57mu5rmlrnmoYjnmoTmg4XlhrXkuIvkuqTku5jnoLTlnY/mgKfov4Hnp7vjgIIKLSDkuI3opoHmiorlh63mja7jgIHov57mjqXkuLLjgIHlr4bpkqXlhpnov5sgbWFuaWZlc3Qg5oiW5bel5Lu25q2j5paH44CCCi0g5LiN6KaB55So5Yir5Lq655qE5b+r54Wn5oiW6L+H5pyfIGNsYWltIOS6pOS7mOOAggoKIyMg5aSx6LSl5LiO6YeN6K+VCgotIOWGmeaTjeS9nOS4jeiHquWKqOmHjeivle+8m+mHjeaUvuWkjeeUqOWQjOS4gOS4qiBgLS1vcGVyYXRpb24gPHV1aWQ+YOOAggotIOe7k+aenOS4jeaYju+8mmB3b3JrbWVzaCByZWNlaXB0IHNob3cgLS1vcGVyYXRpb24gPHV1aWQ+YCDihpIg6ZyA6KaB5pe2IGB3b3JrbWVzaCByZWNlaXB0IHJlY29uY2lsZWDjgIIKLSDooqvopoHmsYLkv67mlLnvvJrlkIzkuIAgY2xhaW0g5LiL5L+u5a6M6YeN5pawIGBkZWxpdmVyYCDlho0gYHJldmlld2DjgIIK"
      }
    ]
  },
  {
    "packageId": "workmesh.role.qa",
    "version": "1.0.0",
    "roleKey": "qa",
    "manifest": {
      "packageSchemaVersion": "1.0",
      "id": "workmesh.role.qa",
      "version": "1.0.0",
      "protocolVersion": "1.0",
      "title": "测试角色包",
      "roleKey": "qa",
      "compatibility": {
        "minCliVersion": "1.0.0",
        "maxCliVersionExclusive": "2.0.0",
        "contractVersion": "1.0"
      },
      "inputs": [
        {
          "key": "context-snapshot",
          "source": "platform",
          "kind": "json",
          "required": true,
          "contractVersion": "1.0"
        }
      ],
      "outputs": [
        {
          "key": "cases",
          "channel": "artifact",
          "kind": "CASES",
          "contractVersion": "1.0"
        }
      ],
      "resources": [
        {
          "id": "guide",
          "kind": "prompt",
          "path": "roles/qa/guide.md",
          "sha256": "08f1d704b9685842780523002d4398d5a154544e742ed2beb51945f007e0faa4",
          "byteLength": 2246,
          "mediaType": "text/markdown"
        }
      ],
      "agentEntries": [
        {
          "host": "codex",
          "type": "instructions",
          "resourceId": "guide",
          "adapterVersion": "1.0.0"
        },
        {
          "host": "claude-code",
          "type": "instructions",
          "resourceId": "guide",
          "adapterVersion": "1.0.0"
        }
      ]
    },
    "resources": [
      {
        "resourceId": "guide",
        "path": "roles/qa/guide.md",
        "mediaType": "text/markdown",
        "sha256": "08f1d704b9685842780523002d4398d5a154544e742ed2beb51945f007e0faa4",
        "byteLength": 2246,
        "bodyBase64": "IyDmtYvor5Xop5LoibLvvIhxYe+8iQoK5L2g5Lqn5Ye6IGBDQVNFU2Ag5bel5Lu277ya6aqM5pS25p2h5qy+5Yiw55So5L6L55qE5pig5bCE44CB5omn6KGM6K6w5b2V5LiO57uT6K6644CCCuS9oOeahOS7t+WAvOWcqOS6jioq55So6K+B5o2u6K+06K+dKirvvIzkuI3mmK/nu5nlrp7njrDnm5bnq6DjgIIKCiMjIOi+ueeVjAoKLSDlj6rkuqflh7ogYENBU0VTYO+8m+S4jeaUueWunueOsOOAgeS4jeaUuSBQUkTjgIHkuI3lj5HluIPjgIHkuI3mibnlh4bjgIIKLSDmr4/mnaHnlKjkvovlv4Xpobvog73ov73muq/liLAgUFJEIOeahCBgYWNjZXB0YW5jZVtdLmtleWDvvJvml6Dms5Xov73muq/nmoTlnLrmma/opoHlhYjlm57liLDkuqflk4Hop5LoibLjgIIKLSDnu5Porrrlj6rmnInkuInnp43vvJrpgJrov4fjgIHlpLHotKXvvIjpmYTmnIDlsI/lpI3njrDvvInjgIHpmLvloZ7vvIjpmYTnvLrlpLHmnaHku7bvvInjgILkuI3lhYHorrgi5Z+65pys5Y+v55SoIuOAggoKIyMg5LiA5qyh5a6M5pW05b6q546vCgpgYGBiYXNoCndvcmttZXNoIGF1dGggbG9naW4KCndvcmttZXNoIGNsYWltIC0tdGFzayA8dGFza0lkPgp3b3JrbWVzaCBjb250ZXh0IC0tdGFzayA8dGFza0lkPiAtLWNsYWltIDxjbGFpbUlkPiAtLWV4cGVjdGVkLXZlcnNpb24gPHRhc2tWZXJzaW9uPiAtLW1hdGVyaWFsaXplCgojIOS4iuS4i+aWh+mHjOW6lOWMheWQq+S4iua4uOW3sumqjOaUtueahOWunueOsOW3peS7tu+8iOWfuue6v+etlueVpSBQVUJMSVNIRURfUFJEIOaXtui/mOWMheWQqyBQUkTvvIkKY2F0IC53b3JrbWVzaC9sb2NhbC9jb250ZXh0LzxzbmFwc2hvdElkPi9tYW5pZmVzdC5qc29uCgp3b3JrbWVzaCBkZWxpdmVyIFwKICAtLXRhc2sgPHRhc2tJZD4gLS1jbGFpbSA8Y2xhaW1JZD4gLS1zbmFwc2hvdCA8c25hcHNob3RJZD4gXAogIC0tZXhwZWN0ZWQtdmVyc2lvbiA8dGFza1ZlcnNpb24+IFwKICAtLW1hbmlmZXN0IGRlbGl2ZXItbWFuaWZlc3QuanNvbgoKd29ya21lc2ggcmV2aWV3IC0tYXJ0aWZhY3Qtc2V0IDxhcnRpZmFjdFNldElkPiAtLWV4cGVjdGVkLXZlcnNpb24gPGFydGlmYWN0U2V0VmVyc2lvbj4KYGBgCgojIyBkZWxpdmVyIG1hbmlmZXN0IOimgeeCuQoKYGBganNvbgp7CiAgIndvcmtmbG93RGVmaW5pdGlvblJldmlzaW9uSWQiOiAiPHNuYXBzaG90IOmHjOiusOW9leeahCB3b3JrZmxvdyDkv67orqI+IiwKICAibG9jYWxSdW5JZCI6ICI85pys5Zyw5Y+v5aSN546w55qE6L+Q6KGM5qCH6K+GPiIsCiAgIml0ZW1zIjogWwogICAgewogICAgICAia2luZCI6ICJDQVNFUyIsCiAgICAgICJzdG9yYWdlIjogIkhPU1RFRCIsCiAgICAgICJtZWRpYVR5cGUiOiAidGV4dC9tYXJrZG93biIsCiAgICAgICJzaGEyNTYiOiAiPOato+aWhyBzaGEyNTY+IiwKICAgICAgImJ5dGVMZW5ndGgiOiAyMDQ4LAogICAgICAiYm9keUJhc2U2NCI6ICI8YmFzZTY0PiIsCiAgICAgICJzdW1tYXJ5IjogIjEyIOadoeeUqOS+i++8mjEwIOmAmui/h++8jDIg5aSx6LSl77yI6ZmE5aSN546w77yJIiwKICAgICAgImNoZWNrcyI6IFsKICAgICAgICB7ICJjb2RlIjogImNhc2VzLWV4ZWN1dGVkIiwgInBhc3NlZCI6IHRydWUgfSwKICAgICAgICB7ICJjb2RlIjogImFjY2VwdGFuY2UtY292ZXJlZCIsICJwYXNzZWQiOiB0cnVlIH0KICAgICAgXQogICAgfQogIF0KfQpgYGAKCueUqOS+i+ato+aWh+mHjOivt+WGmea4he+8mmBhY2NlcHRhbmNlLmtleWAg4oaSIOeUqOS+iyDihpIg5pyf5pybIOKGkiDlrp7pmYUg4oaSIOe7k+iuuuOAggoKIyMg56aB5q2iCgotIOS4jeimgeeUqCLkurrlt6XnnIvkuIDnnLzmsqHpl67popgi5Luj5pu/55So5L6L77yb6YKj5bGe5LqOIERFTU8g57G76aqM5pS277yM6ZyA6KaB5Zyo5q2j5paH6YeM5qCH5rOo44CCCi0g5LiN6KaB5Zyo5a6e546w5pyq5Lqk5LuY5pe25YWI57uZ6YCa6L+H57uT6K6644CCCi0g5LiN6KaB5Lyq6YCgIGBjaGVja3Ng44CCCgojIyDlpLHotKXkuI7ph43or5UKCi0g5YaZ5pON5L2c5LiN6Ieq5Yqo6YeN6K+V77yb6YeN5pS+5aSN55So5ZCM5LiA5LiqIGAtLW9wZXJhdGlvbiA8dXVpZD5g44CCCi0g57uT5p6c5LiN5piO77yaYHdvcmttZXNoIHJlY2VpcHQgc2hvdyAtLW9wZXJhdGlvbiA8dXVpZD5gIOKGkiBgd29ya21lc2ggcmVjZWlwdCByZWNvbmNpbGVg44CCCi0g5Y+R546w5a6e546w57y66Zm377ya5Lqk5LuY6YeM5piO56Gu5YaZ5Ye65aSN546w5q2l6aqk77yM55SxIEhVTUFOIOWGs+WumumAgOWbnui/mOaYr+aOpeWPl+OAggo="
      }
    ]
  },
  {
    "packageId": "workmesh.role.ops",
    "version": "1.0.0",
    "roleKey": "ops",
    "manifest": {
      "packageSchemaVersion": "1.0",
      "id": "workmesh.role.ops",
      "version": "1.0.0",
      "protocolVersion": "1.0",
      "title": "运维角色包",
      "roleKey": "ops",
      "compatibility": {
        "minCliVersion": "1.0.0",
        "maxCliVersionExclusive": "2.0.0",
        "contractVersion": "1.0"
      },
      "inputs": [
        {
          "key": "context-snapshot",
          "source": "platform",
          "kind": "json",
          "required": true,
          "contractVersion": "1.0"
        }
      ],
      "outputs": [
        {
          "key": "release",
          "channel": "artifact",
          "kind": "RELEASE",
          "contractVersion": "1.0"
        }
      ],
      "resources": [
        {
          "id": "guide",
          "kind": "prompt",
          "path": "roles/ops/guide.md",
          "sha256": "bfd9571000f4aa5eb7486d0e685e61b986b183bdfe5ab610e2ea8a28a7d47fe1",
          "byteLength": 2124,
          "mediaType": "text/markdown"
        }
      ],
      "agentEntries": [
        {
          "host": "codex",
          "type": "instructions",
          "resourceId": "guide",
          "adapterVersion": "1.0.0"
        },
        {
          "host": "claude-code",
          "type": "instructions",
          "resourceId": "guide",
          "adapterVersion": "1.0.0"
        }
      ]
    },
    "resources": [
      {
        "resourceId": "guide",
        "path": "roles/ops/guide.md",
        "mediaType": "text/markdown",
        "sha256": "bfd9571000f4aa5eb7486d0e685e61b986b183bdfe5ab610e2ea8a28a7d47fe1",
        "byteLength": 2124,
        "bodyBase64": "IyDov5Dnu7Top5LoibLvvIhvcHPvvIkKCuS9oOS6p+WHuiBgUkVMRUFTRWAg5bel5Lu277ya5Y+R5biD6K6w5b2V44CB546v5aKD5LiO6YWN572u5Y+Y5pu044CB5YaS54Of57uT5p6c44CB5Zue5rua54K544CCCuWPkeW4g+atpemqpOacrOi6q+S7jeeUseS6uuexu+WcqCBXZWIg5LiK5YGa5pyA57uI5pS+6KGM44CCCgojIyDovrnnlYwKCi0g5Y+q5Lqn5Ye6IGBSRUxFQVNFYO+8m+S4jeaUueWunueOsOOAgeS4jeaUuSBQUkTjgIHkuI3lj5HluIPmtYHnqIvlrprkuYnjgIHkuI3mibnlh4bor4TlrqHjgIIKLSDmr4/mrKHlj5HluIPlv4XpobvlhpnmmI4qKuWbnua7mueCuSoq77yI5LiK5LiA54mI5pys5qCH6K+G5oiW5Y+v5Zue5rua6L+B56e777yJ5LiOKirlhpLng5/nu5PmnpwqKuOAggotIOeUn+S6p+WPmOabtOeahOWunumZheaJp+ihjOadg+mZkOS4jeWcqOacrOW5s+WPsOWGhe+8m+i/memHjOiusOW9leeahOaYr+WPr+WkjeaguOeahOivgeaNruOAggoKIyMg5LiA5qyh5a6M5pW05b6q546vCgpgYGBiYXNoCndvcmttZXNoIGF1dGggbG9naW4KCndvcmttZXNoIGNsYWltIC0tdGFzayA8dGFza0lkPgp3b3JrbWVzaCBjb250ZXh0IC0tdGFzayA8dGFza0lkPiAtLWNsYWltIDxjbGFpbUlkPiAtLWV4cGVjdGVkLXZlcnNpb24gPHRhc2tWZXJzaW9uPiAtLW1hdGVyaWFsaXplCgp3b3JrbWVzaCBkZWxpdmVyIFwKICAtLXRhc2sgPHRhc2tJZD4gLS1jbGFpbSA8Y2xhaW1JZD4gLS1zbmFwc2hvdCA8c25hcHNob3RJZD4gXAogIC0tZXhwZWN0ZWQtdmVyc2lvbiA8dGFza1ZlcnNpb24+IFwKICAtLW1hbmlmZXN0IGRlbGl2ZXItbWFuaWZlc3QuanNvbgoKd29ya21lc2ggcmV2aWV3IC0tYXJ0aWZhY3Qtc2V0IDxhcnRpZmFjdFNldElkPiAtLWV4cGVjdGVkLXZlcnNpb24gPGFydGlmYWN0U2V0VmVyc2lvbj4KYGBgCgojIyBkZWxpdmVyIG1hbmlmZXN0IOimgeeCuQoKYGBganNvbgp7CiAgIndvcmtmbG93RGVmaW5pdGlvblJldmlzaW9uSWQiOiAiPHNuYXBzaG90IOmHjOiusOW9leeahCB3b3JrZmxvdyDkv67orqI+IiwKICAibG9jYWxSdW5JZCI6ICI85pys5Zyw5Y+v5aSN546w55qE6L+Q6KGM5qCH6K+GPiIsCiAgIml0ZW1zIjogWwogICAgewogICAgICAia2luZCI6ICJSRUxFQVNFIiwKICAgICAgInN0b3JhZ2UiOiAiSE9TVEVEIiwKICAgICAgIm1lZGlhVHlwZSI6ICJ0ZXh0L21hcmtkb3duIiwKICAgICAgInNoYTI1NiI6ICI85q2j5paHIHNoYTI1Nj4iLAogICAgICAiYnl0ZUxlbmd0aCI6IDEwMjQsCiAgICAgICJib2R5QmFzZTY0IjogIjxiYXNlNjQ+IiwKICAgICAgInN1bW1hcnkiOiAiY2hlY2tvdXQgMS40LjAg5bey5Y+R5biD77yb5YaS54Of6YCa6L+H77yb5Zue5rua54K5IDEuMy4yIiwKICAgICAgImNoZWNrcyI6IFsKICAgICAgICB7ICJjb2RlIjogInByZWZsaWdodCIsICJwYXNzZWQiOiB0cnVlIH0sCiAgICAgICAgeyAiY29kZSI6ICJzbW9rZSIsICJwYXNzZWQiOiB0cnVlIH0sCiAgICAgICAgeyAiY29kZSI6ICJyb2xsYmFjay1wbGFuIiwgInBhc3NlZCI6IHRydWUgfQogICAgICBdCiAgICB9CiAgXQp9CmBgYAoK5q2j5paH6YeM5YaZ5riF77ya54mI5pys5Y+344CB5Y+Y5pu056qX5Y+j44CB5omn6KGM5ZG95Luk44CB5YaS54Of5ZG95Luk5LiO6L6T5Ye65pGY6KaB44CB5Zue5rua5q2l6aqk44CCCgojIyDnpoHmraIKCi0g5LiN6KaB5Zyo5YaS54Of5pyq5omn6KGM5pe25Yu+6YCJIGBzbW9rZWDjgIIKLSDkuI3opoHnnIHnlaXlm57mu5rngrnvvJvkuI3lj6/lm57mu5ropoHmmL7lvI/lhpnmmI4i5LiN5Y+v5Zue5ruaIuWPiuWOn+WboOOAggotIOS4jeimgeWGmeWFpeS7u+S9leWvhumSpeOAgXRva2Vu44CB6K+B5Lmm56eB6ZKl44CCCgojIyDlpLHotKXkuI7ph43or5UKCi0g5YaZ5pON5L2c5LiN6Ieq5Yqo6YeN6K+V77yb6YeN5pS+5aSN55So5ZCM5LiA5LiqIGAtLW9wZXJhdGlvbiA8dXVpZD5g44CCCi0g57uT5p6c5LiN5piO77yaYHdvcmttZXNoIHJlY2VpcHQgc2hvdyAtLW9wZXJhdGlvbiA8dXVpZD5gIOKGkiBgd29ya21lc2ggcmVjZWlwdCByZWNvbmNpbGVg44CCCi0g5Y+R5biD6KKr6YCA5Zue77ya5L+d5oyB5ZCM5LiAIGNsYWlt77yM5L+u5q2j5ZCO6YeN5pawIGBkZWxpdmVyYCDlho0gYHJldmlld2DjgIIK"
      }
    ]
  }
];
