# 안개섬 개척기 (가제)

지도에 없던 섬에 상륙한 개척자가 채집·정제·제작으로 섬의 경제를 세우고, 그 물건으로 싸우는 MMORPG 웹게임.
싱글플레이로 먼저 완성하고, 같은 규칙 위에 멀티플레이를 얹는다.

- **게임(3D)**: `index.html` — 깃허브 페이지를 켜면 https://abnextc.github.io/mist-isle/ 에서 열린다
- **엔진 점검판**: `debug.html` — 명령을 하나씩 눌러 보는 화면
- **패치노트**: `patchnotes.html` (페르소나 후기 포함)
- **진행 현황**: [`docs/progress.md`](docs/progress.md)
- **페르소나 플레이 원본**: [`docs/playtests/`](docs/playtests/)
- **설계 문서**: Claude 프로젝트 「게임 개발」의 `claude/life-mmo-design.md` (이 저장소에는 없다)

## 실행

```bash
node tools/test.js                                    # 테스트
node tools/personas.js --days 7 --seed 2026           # 페르소나 7명 자동 플레이 (--json 가능)
node tools/headless.js --days 3 --seed 42             # 화면 없이 게임 3일 돌리기
node tools/headless.js --days 10 --seed 7 --bots 3    # 봇 3명
python3 -m http.server 8000                           # http://localhost:8000 에서 게임 열기
```

Node 18 이상. 코어와 도구는 외부 패키지가 없다.
화면은 `vendor/three/`에 묶어 둔 Three.js r187(MIT)과 그 애드온(하늘·후처리)을 쓴다. 빌드 단계는 없다.
시험할 때는 `?seed=7&fresh`를 붙이면 세이브를 무시하고 정해진 섬을 새로 연다.
화질은 설정 창에서 자동·높음·중간·낮음을 고른다(브라우저에 기억한다).

## 조작

- PC: WASD 이동 · 마우스 끌기 시점 · 휠 거리 · E 상호작용 · H 귀환 · I 가방 · C 제작 · K 스킬 · L 기록 · Esc 닫기
- 모바일: 왼쪽 엄지로 이동 · 오른쪽 끌기로 시점 · 두 손가락으로 거리 · 손 단추로 상호작용

## 구조

```
core/          순수 시뮬레이션 (화면 코드 금지 · Math.random 금지)
  game.js      진입점: createGame / loadGame / dispatch / advance
  commands.js  명령 검증·실행 (MOVE MOVE_INPUT GATHER CRAFT EAT STORE TAKE SET_AUTOPILOT RECALL)
  terrain.js   절차 생성 지형 (코어와 화면이 같이 쓴다)
  formulas.js  산출·스탯 공식
  systems/     틱마다 도는 시스템 (이동·채집, 제작 대기열, 노드, 산지, 집중력, AI)
  ai/          AI 개척민 정책 (플레이어와 같은 명령만 쓴다)
data/          JSON 정의 (아이템·레시피·노드·스킬·지역·작업대·AI·페르소나·설정)
client/game/   3D 화면 (Three.js): 카메라·입력·HUD·미니맵, 노드·마을·캐릭터·효과 그리기
  gfx/         하늘·안개·후처리·화질 단계, 절차 생성 텍스처, 지형·바다·풀밭·장식 식물
  models/      모형 만들기(자원 노드·마을·캐릭터). 사람이 만든 3D 파일 없이 코드로 만든다
client/debug/  엔진 점검판
vendor/three/  Three.js 묶음 파일
tools/         테스트, 헤드리스 실행기, 페르소나 자동 플레이
docs/          진행 현황, 페르소나 플레이 원본
```

## 지키는 규칙

1. 모든 행동은 명령이다. 화면과 AI는 상태를 직접 고치지 않는다.
2. 상태는 그대로 JSON이 되는 순수 데이터다. 장애물 격자처럼 상태에서 나오는 값은 저장하지 않는다.
3. 난수는 코어의 시드 RNG만 쓴다. 시드가 같으면 결과도 같다.
4. 재료 차감과 결과 지급은 한 번에 끝낸다.
5. 데이터 구조가 바뀌면 `core/save.js`에 마이그레이션을 더한다.
6. 페이지는 검색에 노출하지 않는다. 새 HTML에도 `<meta name="robots" content="noindex, nofollow, noarchive">`를 넣는다.
   robots.txt로 막지 않는다. 막으면 검색엔진이 이 태그를 읽지 못한다.
7. 패치마다 페르소나 자동 플레이를 돌리고, 결과를 패치노트 후기와 `docs/playtests/`에 남긴다.
