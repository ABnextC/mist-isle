# 안개섬 개척기 (가제)

지도에 없던 섬에 상륙한 개척자가 채집·정제·제작으로 섬의 경제를 세우고, 그 물건으로 싸우는 MMORPG 웹게임.
싱글플레이로 먼저 완성하고, 같은 규칙 위에 멀티플레이를 얹는다.

- **점검판**: 저장소의 `index.html` (깃허브 페이지를 켜면 바로 열린다)
- **패치노트**: `patchnotes.html`
- **진행 현황**: [`docs/progress.md`](docs/progress.md)
- **설계 문서**: Claude 프로젝트 「게임 개발」의 `claude/life-mmo-design.md` (이 저장소에는 없다)

## 실행

```bash
node tools/test.js                                    # 테스트
node tools/headless.js --days 3 --seed 42             # 화면 없이 게임 3일 돌리기
node tools/headless.js --days 10 --seed 7 --bots 3    # 봇 3명
node tools/headless.js --days 3 --json                # 리포트를 JSON으로
python3 -m http.server 8000                           # 점검판을 로컬에서 열기
```

Node 18 이상. 외부 패키지는 없다.

## 구조

```
core/        순수 시뮬레이션 (화면 코드 금지 · Math.random 금지)
  game.js    진입점: createGame / loadGame / dispatch / advance
  commands.js 명령 검증·실행 (MOVE GATHER CRAFT EAT STORE TAKE SET_AUTOPILOT)
  formulas.js 산출·스탯 공식
  systems/   틱마다 도는 시스템 (이동·채집, 제작 대기열, 노드, 산지, 집중력, AI)
  ai/        AI 개척민 정책 (플레이어와 같은 명령만 쓴다)
data/        JSON 정의 (아이템·레시피·노드·스킬·지역·작업대·AI·설정)
client/      브라우저 전용 (v0.0은 점검판, v0.1부터 3D)
tools/       헤드리스 실행기, 테스트
```

## 지키는 규칙

1. 모든 행동은 명령이다. 화면과 AI는 상태를 직접 고치지 않는다.
2. 상태는 그대로 JSON이 되는 순수 데이터다.
3. 난수는 코어의 시드 RNG만 쓴다. 시드가 같으면 결과도 같다.
4. 재료 차감과 결과 지급은 한 번에 끝낸다.
5. 데이터 구조가 바뀌면 `core/save.js`에 마이그레이션을 더한다.
6. 페이지는 검색에 노출하지 않는다. 새 HTML에도 `<meta name="robots" content="noindex, nofollow, noarchive">`를 넣는다.
   robots.txt로 막지 않는다. 막으면 검색엔진이 이 태그를 읽지 못한다.
