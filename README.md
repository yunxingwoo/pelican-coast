# 鹈鹕海岸线 · Pelican Coast

**一款基于 Three.js 的浏览器 3D 海岸骑行游戏。**

一只系着珊瑚色围巾的白鹈鹕，骑着复古自行车，沿着被潮汐反复擦亮的环海公路骑两圈。海风、天气与光线一路变化，沿途收集海星贝壳，躲开浮木、落石和横穿公路的螃蟹。

**在线试玩：** https://yunxingwoo.github.io/pelican-coast/  
**源码仓库：** https://github.com/yunxingwoo/pelican-coast

![Pelican Coast](docs/screenshot.png)

## 中文介绍

《鹈鹕海岸线》不是一段预渲染动画：鹈鹕、自行车、公路、悬崖、海浪、棕榈、灯塔、天空和音效，全部在浏览器里由代码实时生成，不加载任何外部模型或贴图。

- **骑行与操控**：`W` / `↑` 蹬踏加速，`S` / `↓` 刹车，`A` `D` / `←` `→` 转向，`Shift` / `Space` 触发尾风冲刺；也可以直接拖动画面转向，移动端提供蹬踏/刹车按钮。
- **一条会呼吸的海岸公路**：0.96 公里的闭合赛道，两圈计时；风向与阵风、晴/阴/雨/风暴/海雾、12 分钟昼夜循环会同时影响视野、路面和骑行手感。
- **收集与挑战**：海星贝壳提升连击并补充冲刺，检查点与圈速奖励分数；撞上浮木、落石或螃蟹会损失爱心，三颗心用完结束本局。
- **鹈鹕本身**：程序化骨骼与 IK 踩踏，五种镜头（追随 / 侧面 / 正面 / 电影运镜 / 鹈鹕第一人称）；`T` 展开层叠飞羽，`B` 摇响车铃，`N` 快进 3 小时，`U` 隐藏界面。
- **技术栈**：Three.js r184、TypeScript、Vite；自定义天空/海洋 Shader、PMREM 海岸环境反射、程序化 WebAudio；项目通过 GitHub Actions 自动发布到 GitHub Pages。

![展翅](docs/wings.png)

## English overview

*Pelican Coast* is a stylized Three.js coastal cycling game. A pelican in a coral neckerchief pedals a vintage bicycle along a winding seaside road while wind, weather and the sun change around the ride. Everything — the rider, bicycle, road, sea, sky, props and audio — is generated procedurally in the browser, with no external models, fonts, images or runtime network calls.

## Quick start

```bash
npm install
npm run dev       # http://127.0.0.1:5199
npm run build     # production build in dist/
npm run preview   # http://127.0.0.1:5200
```

No external models, fonts, images or network calls are required at runtime. The pelican, bicycle, road, sea, sky, props and audio are built procedurally. Edge smoothing uses SMAA + 2× DPR on desktop, and the world uses smoother rock/cliff/tree geometry and a finer grain treatment.

## Controls

| Input | Action |
| --- | --- |
| `W` / `↑` | Pedal / accelerate |
| `S` / `↓` | Brake |
| `A` `D` / `←` `→` | Steer |
| `Shift` / `Space` | Tailwind boost (drains the boost meter) |
| Drag anywhere on the ride surface | Analog steering (mouse / touch) — no on-screen wheel |
| `C` / camera icon | Cycle chase → side → front → orbit → pelican POV cameras |
| On-screen pedals | Touch accelerate / brake |
| `P` / `Esc` | Pause / resume |
| `M` | Mute |
| `B` | Ring the handlebar bell |
| `T` | Spread / fold the pelican's wings |
| `N` | Fast-forward three hours |
| `U` | Hide / restore the interface |
| `R` | Restart after a finish or wipeout |
| Gamepad | Left stick steer, RT/LT throttle/brake, A boost, Start pause |

## The ride

- Two laps of a hand-built 0.96 km coastal circuit with headland bends, a lighthouse, checkpoint arch, start chequer and a finish line.
- **3 hearts.** Hit driftwood, rockfall or a crab and you lose speed, a heart and combo. Zero hearts ends the run; retry is instant.
- **Starfish shells** build a combo multiplier, recharge boost and add score. Laps award a split time and a bonus; final score is saved as your best.
- **Multiple showcase views:** `C` or the camera button cycles chase, side, front, slow cinematic orbit and a clean pelican POV. Press `U` to hide the whole interface for a cinematic view. There is no on-screen steering wheel; drag the road surface or use A/D.
- **Reference-inspired details:** `B` rings the bell, `N` jumps three hours through the day/night cycle, `T` spreads the wings while riding, and the POV camera hides the head/neck for a clean rider's-eye shot.
- **Wind** is simulated as a rotating bearing with layered gusts. It pushes you sideways, adds tailwind/headwind speed, and visibly bends grass, palms, flags and the windsock. The HUD compass, gust readout and warnings keep it legible.
- **Weather** transitions between clear, cloudy, rain, storm and sea fog. Rain reduces grip and darkens the road; storms add lightning, thunder, heavier seas and crosswind warnings; fog cuts visibility.
- **Day/night** runs on a 12-minute cycle from a warm afternoon through golden hour, sunset, night and dawn. Street lamps, the lighthouse beam, bike lamp and stars come up at dusk; the sun and moon move across a custom sky shader.
- **Procedural audio** (Web Audio): ocean ambience, speed-dependent wind, shell chimes, bell, wing whoosh, boost, crash impacts, thunder, checkpoint chords and a finish fanfare. The old chain tick has been removed.

## Deployment

The game is published to GitHub Pages at **https://yunxingwoo.github.io/pelican-coast/**.

Every push to `main` runs `.github/workflows/deploy.yml`, which installs dependencies, builds with Vite and deploys the `dist/` artifact using the official GitHub Pages actions. The build uses relative asset URLs (`base: './'`) so the same output also works under `npm run preview` locally.

![Spread wings](docs/wings.png)

## Architecture

```
src/
  game/Game.ts           run state, physics, input wiring, HUD snapshots, test hooks
  core/                  render pipeline (bloom + output), input, RAF loop
  entities/
    PelicanRider.ts      authored pelican + vintage bicycle rig and animation
    pelican/             shared materials and sweep/feather/part helpers
    TrackItems.ts        starfish shells, driftwood, rockfall, crabs
  world/
    TrackPath.ts         closed Catmull-Rom coast circuit
    Road.ts              asphalt ribbon, markings, guardrail, cliffs, terrain, hills
    Ocean.ts             tiled ocean shader with waves, foam and sun glitter
    Sky.ts               sky shader, sun/moon, stars, cloud sprites
    Environment.ts       day/night cycle, weather machine, wind model, lighting
    EnvironmentMap.ts    small painted PMREM environment for PBR reflections
    Props.ts             palms, cypress, grass, flowers, lighthouse, arch, signs, boats, gulls, windmill, windsock
    WeatherVfx.ts        rain, road splashes, lightning geometry
  systems/               camera rig, procedural audio
  ui/Hud.ts              data-driven HUD, screens, touch pads and drag steering
  styles.css             postcard × glass-cockpit design system
tests/gameplay.spec.ts   Playwright smoke tests (title → riding, HUD states)
```

## Verification

```bash
npx tsc --noEmit
npm run build
npx playwright test
npm run inspect:canvas -- --url http://127.0.0.1:5200 --state active-play --run-id pass-final
```

The test hooks used by the canvas inspector are exposed as `window.__THREE_GAME_TEST_HOOKS__` and diagnostics as `window.__THREE_GAME_DIAGNOSTICS__`.

## Known limitations

- Authored with procedural geometry, so surfaces are stylized rather than photoreal.
- The rig's folded feathers remain stylized; the spread wing uses layered primaries, secondaries, coverts and dark flight-feather tips without an underwing membrane.
- Mobile renders the same authored scene as desktop: it fits and runs, but the measurable draw-call/triangle budget is above the mobile starting budget.
- The chain line is static; lamps use emissive + bloom and only the bike headlamp is a real spotlight.
