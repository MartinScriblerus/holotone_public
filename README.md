# holotone_public

Public AGPL face of **Holotone**: Hydra video synthesis, dual-canvas / iframe embed runtime, and notes on the no-code approach to ChucK (play · network · codegen · instrument flow).

| | |
|--|--|
| **License** | [AGPL-3.0](./LICENSE) — see [NOTICE](./NOTICE) |
| **Upstream** | [hydra-synth](https://github.com/hydra-synth/hydra-synth) (AGPL) · [Hydra editor license](https://github.com/hydra-synth/hydra/blob/main/LICENSE) |
| **Private instrument** | [StrangeLoop](https://github.com/MartinScriblerus/StrangeLoop) (audio stays private) |
| **Migration notes** | StrangeLoop `frontend/MIGRATION.md` on branch `copyleft-safe` |

## Why this repo exists

`hydra-synth` is AGPL-3.0. StrangeLoop uses it for visuals but must keep the WebChucK instrument private. This site is the **covered work**: Hydra host, media binding, projection/embed UI, and public documentation — so network users get Corresponding Source without AGPL-infecting the audio engine.

## Dual canvas + iframe (microservice)

Yes — treat this deploy as a small visual microservice:

| Mode | URL | Role |
|------|-----|------|
| **Integrated div** | `/embed` | iframe inside StrangeLoop or this marketing page |
| **Projection / wall** | `/projection/:target` or `/hydra/:target` | second canvas / popup / projector |
| **Docs home** | `/` | how-to-play, architecture, updates |

StrangeLoop (other Vercel origin) talks via **`postMessage`** — not `BroadcastChannel` (same-origin only). Protocol: `src/protocol.ts`.

```text
StrangeLoop parent  -- holotone:snapshot -->  iframe / projection
                  <-- holotone:ready -------
                  <-- holotone:error -------
```

## Free Vercel

1. Import this GitHub repo into Vercel (Hobby).
2. Framework preset: Vite. `vercel.json` already rewrites `/embed` and `/projection/:target`.
3. In StrangeLoop, set `VITE_HOLOTONE_PUBLIC_ORIGIN=https://<this-deployment>.vercel.app`.
4. Embed:

```html
<iframe
  src="https://<holotone-public>.vercel.app/embed?parent=1"
  allow="camera; fullscreen; autoplay"
  title="Holotone Hydra"
></iframe>
```

CSP `frame-ancestors` in `vercel.json` allows `*.vercel.app` and localhost. Tighten to your instrument hostname when stable.

## Local

```bash
npm install
npm run dev    # http://localhost:5174
```

## Roadmap (content + code)

- [ ] Port full StrangeLoop Hydra graph runtime / s0 media binder into this package
- [ ] How-to-play video on the home page
- [ ] Public notes: no-code ChucK flow, networking, codegen
- [ ] StrangeLoop iframe host + stop importing `hydra-synth` from the private bundle

## Source offer (AGPL §13)

Corresponding Source for the version running here:  
**https://github.com/MartinScriblerus/holotone_public**
