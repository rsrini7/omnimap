[English](./README.md) | [Türkçe](./README.tr.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [中文](./README.zh.md) | [தமிழ்](./README.ta.md)

> இந்த ஆவணம் ஆங்கில README-லிருந்து மொழிபெயர்க்கப்பட்டது. சில தொழில்நுட்பச் சொற்கள் இயந்திர மொழிபெயர்ப்பின் காரணமாக இயல்பாக இல்லாமல் இருக்கலாம்.

<p align="center">
  <img src="./docs/omnimap-trans.png" alt="omm logo" width="80"/>
</p>

<h1 align="center">OmniMap</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@rsrini/omnimap"><img src="https://img.shields.io/npm/v/@rsrini/omnimap" alt="npm version"/></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"/></a>
</p>

<p align="center">
  AI வினாடிகளில் குறியீட்டை எழுதுகிறது. மனிதர்கள் அதை புரிந்துகொள்ள மணிநேரம் ஆகும்.<br/>
  புரிந்துகொள்ளத் தவறினால், குறியீட்டுத் தளம் உங்களுக்கே ஒரு புரியாத புதிராக மாறும்.<br/><br/>
  <strong>omm இடைவெளியை மூடுகிறது — AI ஆல் உருவாக்கப்பட்ட, மனிதர்களுக்கான கட்டிடக்கலை ஆவணங்கள்.</strong><br/>
  <em>Mermaid, D3, PlantUML மற்றும் பல வரைபட வடிவங்களை ஆதரிக்கிறது.</em>
</p>

---

## விரைவு தொடக்கம்

உங்கள் டெர்மினலில் ஒட்டவும்:

```bash
npm install -g @rsrini/omnimap && omm setup
```

AI குறியீட்டு கருவியைத் திறந்து `/omm-scan` திறனைப் பயன்படுத்தவும்:

```
/omm-scan
```

முடிவைக் காணவும்:

```bash
omm view
```

## எடுத்துக்காட்டு

> omm தன்னையே ஸ்கேன் செய்தது. இது கண்டறிந்தது.

<table><tr>
<td width="50%"><img src="./docs/screenshot.png" alt="omm viewer"/></td>
<td width="50%"><img src="./docs/demo.gif" alt="omm scan demo"/></td>
</tr></table>

## இது எப்படி வேலை செய்கிறது

AI உங்கள் குறியீட்டுத் தளத்தை பகுப்பாய்வு செய்து **கண்ணோட்டங்களை** உருவாக்குகிறது — கட்டிடக்கலையின் வெவ்வேறு கண்ணோட்டங்கள். ஒவ்வொரு கண்ணோட்டமும் ஒரு வரைபடம் மற்றும் ஆவணப் புலங்களைக் கொண்டுள்ளது.

ஒவ்வொரு முனையும் **மீண்டும் மீண்டும் பகுப்பாய்வு** செய்யப்படுகிறது. சிக்கலானவை உள்ளமைக்கப்பட்ட குழந்தைகளாக மாறும். எளியவை இலைகளாக இருக்கும்.

```
.omm/
├── overall-architecture/           ← கண்ணோட்டம்
│   ├── description.md
│   ├── diagram.mmd
│   └── main-process/               ← உள்ளமைக்கப்பட்ட கூறு
│       └── auth-service/
├── data-flow/
└── external-integrations/
```

ஒவ்வொரு கூறும் 7 புலங்கள் வரை கொண்டுள்ளது: `description`, `diagram`, `context`, `constraint`, `concern`, `todo`, `note`.

## CLI

```bash
omm setup                          # AI கருவிகளுக்கான திறன்களைப் பதிவு செய்யவும்
omm view                           # ஊடாடும் காட்டியைத் திறக்கவும்
omm config language ta             # உள்ளடக்க மொழியை அமைக்கவும்
omm format <element>               # வரைபட வடிவத்தைக் காட்டவும் (mermaid/plantuml)
omm config plantuml-status         # PlantUML நிலையைச் சரிபார்க்கவும்
omm incremental                    # git diff அடிப்படையில் ஸ்கேன் திட்டமிடல்
omm update                         # சமீபத்திய பதிப்பிற்கு புதுப்பிக்கவும்
omm analyze [--format md|json]     # tree-sitter கட்டமைப்பு பகுப்பாய்வு
omm search <query>                 # கூறுகள் முழுவதும் தேடல்
omm tour [dir] [--limit n]         # வழிகாட்டப்பட்ட சுற்றுப்பயணம்
omm wiki                           # எளிதாக வலம்வரக்கூடிய markdown விக்கி
omm treecode                       # குறியீடு ↔ .omm/ கவரேஜ் மேப்
omm mcp [--port <port>]             # AI ஏஜென்ட்களுக்கான MCP சேவையகம்
```

முழு கட்டளை பட்டியலுக்கு `omm help` இயக்கவும்.

## திறன்கள்

திறன்கள் **AI குறியீட்டு கருவிக்குள்** இயக்கும் கட்டளைகள் (`/` உடன் தொடங்குகின்றன):

| திறன் | என்ன செய்கிறது |
| --- | --- |
| `/omm-scan` | குறியீட்டுத் தளத்தை பகுப்பாய்வு செய்து கட்டிடக்கலை ஆவணங்களை உருவாக்கவும் |
| `/omm-eval` | தரத்தை மதிப்பிட்டு ஆவணங்களை மேம்படுத்தவும் |
| `/omm-guide` | இருக்கும் கட்டிடக்கலையை ஆய்வு செய்யவும் |
| `/omm-push` | கட்டிடக்கலை ஆவணங்களை பகிரப்பட்ட களஞ்சியத்திற்கு அனுப்பவும் |

## ஆதரிக்கப்படும் AI கருவிகள்

| தளம் | அமைப்பு |
| --- | --- |
| Claude Code | `omm setup claude` |
| Codex | `omm setup codex` |
| Cursor | `omm setup cursor` |
| pi (pi.dev) | `omm setup pi` |
| எந்த AI கருவி | `omm setup` (தானாகக் கண்டறி) |

## சாலை வரைபடம்

[docs/ROADMAP.md](./docs/ROADMAP.md) காணவும்.

## மேம்பாடு & பங்களிப்பு

```bash
git clone https://github.com/rsrini7/omnimap.git
cd omnimap
npm install && npm run build
npm test
```

சிக்கல்கள் மற்றும் PRகள் வரவேற்கப்படுகின்றன. [Conventional Commits](https://www.conventionalcommits.org/) பயன்படுத்தவும்.

## உரிமம்

[MIT](./LICENSE)
