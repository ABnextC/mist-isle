# animforge — 모션 캡처를 게임 뼈대로

CMU 모션 캡처 데이터베이스(BVH 변환본)에서 동작을 골라 게임 뼈대(19개)로 옮겨
`client/assets/anim/clips.json`을 만든다. 게임은 이 파일만 읽는다(원본 BVH는 저장소에 넣지 않는다).

- `bvh.py`: BVH 읽기, 정운동학
- `retarget.py`: 팔다리는 뼈 방향 + 접힘 축(무릎·팔꿈치), 몸통·머리·발은 T자 기준 상대 회전으로 옮긴다
- `build.py`: 서기(77_02 standing), 걷기(35_01), 달리기(16_46 run/jog)를 고리로 자른다.
  - 걷기·달리기: 발이 가장 앞에 나간 순간부터 한 주기(위상 0 = 왼발). 600fps로 뽑아 다듬은 뒤 60fps로 낸다.
  - 고리 이음매: 회전 어긋남과 엉덩이 높이 어긋남을 한 바퀴에 고르게 나눠 지운다.
  - 달리기 위상 비틀기: 딛는 동안은 빠르게, 떠 있는 동안은 느리게 다시 나눠 보폭을 3.15m로 늘린다
    (게임 5m/s에서 1분 약 190걸음, 발 미끄럼 없음).
  - 발 붙이기: 딛는 발바닥(뒤꿈치·앞꿈치)이 y=0에 닿게 발마다 높이를 고치고 다리 두 마디 IK로 푼다.
  - 서기: 처음·끝이 닮고, 몸이 덜 돌고, 발이 안 움직이는 창을 고른 뒤 엉덩이 평균 방향을 +z로 돌린다
    (retarget의 heading은 몸통 기준 자세도 같이 돌려서 몸통 방향을 못 바꾼다).
  - 이동 거리(한 주기 보폭)를 함께 적는다. 게임은 이 값으로 걸음 위상을 나아가게 한다.
  - 환경 변수: RUN, RUN_FOOT, RUN_STRIDE, IDLE, IDLE_T0, IDLE_T1, OUT
- `check.py`: 소스와 게임 뼈대를 막대 사람으로 겹쳐 그린다

다시 만들기:

```
git clone --depth 1 --filter=blob:none --no-checkout https://github.com/meshula/cmu-mocap.git cmu
cd cmu && git checkout HEAD -- data/077/77_02.bvh data/035/35_01.bvh data/016/16_46.bvh
python3 tools/animforge/build.py <cmu>/data
```

출처: The data used in this project was obtained from mocap.cs.cmu.edu.
The database was created with funding from NSF EIA-0196217.
BVH 변환: Bruce Hahne(cgspeed). CMU와 변환자 모두 사용 제한을 두지 않는다.
