# 캐릭터 대장간(charforge)

게임 캐릭터(`client/assets/char/`)를 만드는 파이썬 생성기다. 기계 학습이 아니라, 실제 사람 몸 데이터에서 출발해 규칙으로 빚는다.

## 무엇을 하나

1. **몸**: MakeHuman(CC0) 기본 메시에 거시 표적(성별·나이·근육·체중·키·비율·인종)과 얼굴 표적을 섞는다. 가중치 공식은 MakeHuman과 같다.
2. **자세**: A자세를 게임 자세(팔 내림, 오른손 주먹, 왼손 편히)로 바꾼다. MakeHuman 뼈 163개의 가중치로 선형 혼합 스키닝.
3. **뼈**: 축이 세계축과 같은 게임 뼈 19개로 가중치를 모은다. 동작 코드(`actors-view.js`)가 예전 이름 그대로 쓴다.
4. **옷**: 몸 표면에서 영역(스칼라장)을 잘라 띄운 껍데기. 셔츠(걷은 소매)·조끼(여자는 코르셋 조끼)·바지·허리띠·목수건.
   장화는 종아리·발 거리장을 흐려 발가락을 지운 등위면이다. 겹침은 같은 몸 점 기준 높이로 정리한다.
5. **피부**: 보이는 곳(머리·목·손·팔뚝)만 남겨 아틀라스로 다시 묶고 굽는다. 바탕색·혈색·입술·눈썹·수염·두피 가면·땀구멍 법선·거칠기.
   입술·코·볼 같은 부위는 MakeHuman 표적이 움직이는 꼭짓점을 그대로 지도로 쓴다.
6. **눈·속눈썹**: MakeHuman 고해상 눈(CC0)과 기본 메시 속눈썹 띠. 눈 감기·미소 표정 단위는 모프 표적으로 내보낸다.
7. **머리카락**: 두피에서 뿌리를 고르게 뽑아 빗질 방향·길이·부피·중력으로 가닥을 기르고, 가닥마다 납작한 카드를 붙인다(남: 짧은 머리, 여: 단발).
8. **AO**: 몸·옷·머리카락을 복셀에 찍고 원뿔 추적으로 주변 가림을 굽는다.
9. **내보내기**: `pioneer_m|f.json + .bin`(메시·뼈·모프) + WebP 질감.
10. **옷 무게 마무리(v0.4.10)**: 사타구니 이음매는 좌우 다리 무게를 x로 매끈히 나누고(`crotch.py`),
    겉옷이 덮은 속옷은 겉옷 무게를 따른다(`layers.py`, 법선 반직선 2.5cm·가까운 점 2.2cm). `forge.py`가 묶음을 쓴 뒤 돌린다.
    이미 만든 묶음만 고칠 때는 `python3 fixweights.py ../../client/assets/char/pioneer_m.json …`(원본에 한 번만).

## 준비물

- 파이썬 3.11+, `numpy scipy pillow opencv-python scikit-image fast-simplification`
- MakeHuman 데이터(CC0, `MH_DATA` 경로, 기본은 이 폴더의 `data/`)
  - `3dobjs/base.obj` — makehuman 저장소 `makehuman/data/3dobjs/`
  - `targets.npz` — `pip download makehuman==1.3.2` 휠 안의 `makehuman/data/targets.npz`
  - `rigs/default.mhskel`, `rigs/default_weights.mhw`
  - `eyes/high-poly/high-poly.obj|.mhclo`, `eyes/materials/brown_eye.png`

## 실행

```
MH_DATA=/path/to/mh-data python3 forge.py        # 남·여 둘 다
python3 forge.py m                               # 남자만
```

한 벌에 30~40초(2코어). 결과는 `client/assets/char/`(바꾸려면 `CHAR_OUT`).

## 라이선스

MakeHuman 기본 메시·표적·뼈·눈은 CC0다. 나머지(옷·머리카락·질감·생성 코드)는 이 저장소 것이다.
