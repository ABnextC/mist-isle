# 기본 체형 두 가지(남·여). 얼굴은 정감 가게: 눈 조금 크게, 코끝 작게, 입꼬리 살짝 올림.
RACE = {'african': 0.04, 'asian': 0.62, 'caucasian': 0.34}

MALE = dict(gender=1.0, age=0.47, muscle=0.6, weight=0.47, height=0.55, proportions=0.8, **RACE, mods={
    'eyes/l-eye-scale-incr': 0.3, 'eyes/r-eye-scale-incr': 0.3, 'eyes/l-eye-height2-incr': 0.2, 'eyes/r-eye-height2-incr': 0.2,
    'nose/nose-scale-horiz-decr': 0.12, 'nose/nose-point-width-decr': 0.25, 'nose/nose-scale-vert-decr': 0.1,
    'mouth/mouth-angles-up': 0.35, 'mouth/mouth-scale-horiz-decr': 0.08,
    'chin/chin-width-decr': 0.12, 'head/head-fat-decr': 0.1,
    'head/head-scale-vert-incr': 0.12, 'head/head-scale-horiz-incr': 0.1, 'head/head-scale-depth-incr': 0.1,
    'neck/neck-scale-vert-decr': 0.15,
})

FEMALE = dict(gender=0.0, age=0.45, muscle=0.5, weight=0.45, height=0.6, proportions=0.85, breast_size=0.48, breast_firmness=0.75, **RACE, mods={
    'eyes/l-eye-scale-incr': 0.3, 'eyes/r-eye-scale-incr': 0.3,
    'nose/nose-scale-horiz-decr': 0.18, 'nose/nose-point-width-decr': 0.3, 'nose/nose-scale-vert-decr': 0.12,
    'mouth/mouth-angles-up': 0.35, 'mouth/mouth-upperlip-volume-incr': 0.15, 'mouth/mouth-lowerlip-volume-incr': 0.2,
    'chin/chin-width-decr': 0.2, 'cheek/l-cheek-volume-incr': 0.15, 'cheek/r-cheek-volume-incr': 0.15,
    'head/head-scale-vert-incr': 0.12, 'head/head-scale-horiz-incr': 0.1, 'head/head-scale-depth-incr': 0.1,
    'neck/neck-scale-vert-decr': 0.1,
})
