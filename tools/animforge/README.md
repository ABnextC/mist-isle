# animforge — 모션 캡처를 게임 뼈대로

CMU 모션 캡처 데이터베이스(BVH 변환본)에서 동작을 골라 게임 뼈대(19개)로 옮겨
`client/assets/anim/clips.json`을 만든다. 게임은 이 파일만 읽는다(원본 BVH는 저장소에 넣지 않는다).

- `bvh.py`: BVH 읽기, 정운동학
- `retarget.py`: 팔다리는 뼈 방향 + 접힘 축(무릎·팔꿈치), 몸통·머리·발은 T자 기준 상대 회전으로 옮긴다
- `build.py`: 서기(137_28 Normal Wait), 걷기(35_01), 달리기(127_06)를 고리로 자르고(뒤꿈치 닿는 순간 기준) 30fps로 낸다.
  발이 땅에 닿게 엉덩이 높이를 맞추고, 이동 거리(한 주기 보폭)를 함께 적는다.
- `check.py`: 소스와 게임 뼈대를 막대 사람으로 겹쳐 그린다

다시 만들기:

```
git clone --depth 1 --filter=blob:none --no-checkout https://github.com/meshula/cmu-mocap.git cmu
cd cmu && git checkout HEAD -- data/137/137_28.bvh data/035/35_01.bvh data/127/127_06.bvh
python3 tools/animforge/build.py <cmu>/data
```

출처: The data used in this project was obtained from mocap.cs.cmu.edu.
The database was created with funding from NSF EIA-0196217.
BVH 변환: Bruce Hahne(cgspeed). CMU와 변환자 모두 사용 제한을 두지 않는다.
