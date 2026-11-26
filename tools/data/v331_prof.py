# v3.3.1 숙련 계수: 장비 제작 점수의 재료 몫을 레시피 숙련도에 따라 깎는다.
import json, os
D = os.path.join(os.path.dirname(__file__), '..', '..', 'data')
p = os.path.join(D, 'config.json')
c = json.load(open(p))
c['craft']['proficiency'] = {'start': 0.55, 'perLevel': 0.03, 'max': 1.0}
c['dataVersion'] = max(c.get('dataVersion', 0), 37)
json.dump(c, open(p, 'w'), ensure_ascii=False, indent=2)
open(p, 'a').write('\n')
print('proficiency', c['craft']['proficiency'])
